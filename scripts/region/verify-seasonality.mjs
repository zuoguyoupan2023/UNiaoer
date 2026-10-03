/**
 * 022 §1.7：季节 month SQL（0008810）对照 public/data/seasonality.json（仅对照，不改产物）。
 * CLI：npm run region:verify-seasonality -- [--in path] [--out report.json]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { buildSpeciesMap } from './verify-provinces-lib.mjs'
import { aggregateSqlMonths, compareSeasonality } from './verify-sql-lib.mjs'

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

const sqlFile = await findSql('0008810')
const [manifest, seasonality, rows] = await Promise.all([
  readJson(path.join(ROOT, 'public/data/manifest.json')),
  readJson(path.join(ROOT, 'public/data/seasonality.json')),
  readJson(sqlFile),
])
const speciesMap = buildSpeciesMap(manifest.species)
const agg = aggregateSqlMonths(rows, speciesMap)
const stats = compareSeasonality(seasonality.bySpecies || {}, agg.bySpecies)
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)

console.log(`\nverify-seasonality（对照）`)
console.log(`  SQL: ${path.relative(ROOT, sqlFile)}（${rows.length} 行）`)
console.log(`  物种：existing ${stats.species.existing} · sql ${stats.species.sql} · both ${stats.species.both}`)
console.log(
  `  月份存在格（species×month）：existing ${stats.months.existing} · sql ${stats.months.sql} · ` +
    `both ${stats.months.both} · only-existing ${stats.months.onlyExisting} · only-sql ${stats.months.onlySql}`,
)
console.log(`  重合率：both 内命中 ${pct(stats.bothMonthsMatched, stats.bothMonthsTotal)}%`)
console.log(`  行映射：学名 ${pct(agg.mappedRows, agg.totalRows)}%（未匹配学名 ${agg.unmatchedNames.size} 个）`)
if (args.out) {
  const out = path.resolve(ROOT, args.out)
  await fs.writeFile(out, JSON.stringify({ sqlFile: path.relative(ROOT, sqlFile), stats }, null, 2))
  console.log(`  报告 → ${path.relative(ROOT, out)}`)
}
