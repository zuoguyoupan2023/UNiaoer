/**
 * 022 §1.7：热点网格 SQL（0008811）对照 public/data/hotspots.json（仅对照，不改产物）。
 * CLI：npm run region:verify-hotspots -- [--in path] [--out report.json]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { HOTSPOT_DEFAULTS } from './config.mjs'
import { compareHotspotSets, sqlCellsToHotspots } from './verify-sql-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

async function findSql(prefix) {
  if (args.in) return path.resolve(ROOT, args.in)
  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => new RegExp(`^${prefix}-.*\\.json$`).test(f)).sort()
  if (!files.length) throw new Error(`找不到 SQL 结果（先 npm run region:gbif-sql -- --key ${prefix}-…）`)
  return path.join(dir, files[files.length - 1])
}

const sqlFile = await findSql('0008811')
const [hotspots, rows] = await Promise.all([
  readJson(path.join(ROOT, 'public/data/hotspots.json')),
  readJson(sqlFile),
])
const { grid, minRecords, minSpecies, minObservers } = HOTSPOT_DEFAULTS
const sqlHotspots = sqlCellsToHotspots(rows, { grid, minRecords, minSpecies, minObservers })
const stats = compareHotspotSets(hotspots.hotspots || [], sqlHotspots, { grid })

console.log(`\nverify-hotspots（对照）`)
console.log(`  SQL: ${path.relative(ROOT, sqlFile)}（${rows.length} 个网格行）`)
console.log(`  阈值 grid=${grid} rec≥${minRecords}/sp≥${minSpecies}/obs≥${minObservers}`)
console.log(
  `  观鸟点：existing ${stats.counts.existing} · sql ${stats.counts.sql} · 同格 both ${stats.counts.both} · ` +
    `only-existing ${stats.counts.onlyExisting} · only-sql ${stats.counts.onlySql}`,
)
console.log('  按国家（existing/sql）：')
for (const [cc, c] of Object.entries(stats.byCountry).sort()) {
  console.log(`    ${cc}: ${c.existing}/${c.sql}`)
}
if (args.out) {
  const out = path.resolve(ROOT, args.out)
  await fs.writeFile(out, JSON.stringify({ sqlFile: path.relative(ROOT, sqlFile), stats }, null, 2))
  console.log(`  报告 → ${path.relative(ROOT, out)}`)
}
