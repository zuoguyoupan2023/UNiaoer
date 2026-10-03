/**
 * 022 §1.7 / 021 M4 腿 B：用 **GBIF SQL 网格**（0008811）作 GBIF 坐标源构建观鸟点候选，
 * 并用 eBird 热点就近命名（--ebird-names）。因 occurrence/search 宽查询极慢，这是 GBIF 源的高效替代。
 *
 * 产物是**候选**（默认 data-cache/region/out/hotspots.gbif-sql.json，绝不覆盖正式 hotspots.json）：
 * SQL 网格只有 cell 级 records/species/observers，**无 topSpecies**（需另查），故仅作评估。
 *
 * CLI：npm run region:hotspots-sql -- [--in path] [--ebird-names] [--ebird-max-km 3] [--out path]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { hotspotRecords } from './adapters/ebird.mjs'
import { applyEbirdNames } from './hotspots-lib.mjs'
import { EBIRD_SOURCE, GBIF_SQL_SOURCE, HOTSPOT_DEFAULTS } from './config.mjs'
import { sqlCellsToHotspots } from './verify-sql-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

async function findSql(prefix) {
  if (args.in) return path.resolve(ROOT, args.in)
  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => new RegExp(`^${prefix}-.*\\.json$`).test(f)).sort()
  if (!files.length) throw new Error(`找不到 SQL 网格（先 npm run region:gbif-sql -- --key ${prefix}-…）`)
  return path.join(dir, files[files.length - 1])
}

const sqlFile = await findSql('0008811')
const rows = await readJson(sqlFile)
const D = HOTSPOT_DEFAULTS
let hotspots = sqlCellsToHotspots(rows, {
  grid: D.grid,
  minRecords: D.minRecords,
  minSpecies: D.minSpecies,
  minObservers: D.minObservers,
}).map((h) => ({ ...h, topSpecies: [], sources: ['gbif'] }))

let ebirdNamed = 0
if (args['ebird-names']) {
  const dir = path.join(ROOT, 'data-cache/region/ebird')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^hotspot-.*\.json$/.test(f))
  const spots = []
  for (const f of files) {
    try {
      for (const r of hotspotRecords(await readJson(path.join(dir, f)))) spots.push(r)
    } catch (e) {
      console.error(`region-hotspots-sql: eBird 读取失败 ${f}：${e.message}`)
    }
  }
  hotspots = applyEbirdNames(hotspots, spots, { maxKm: Number(args['ebird-max-km']) || 3 })
  ebirdNamed = hotspots.filter((h) => h.ebirdId).length
  console.log(`region-hotspots-sql: eBird 名录 ${spots.length} · 命名 ${ebirdNamed} 个 cell`)
}

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    `GBIF SQL 网格（${path.basename(sqlFile)}，class='Aves'，近 ${new Date().getFullYear() - 2020}+ 年，` +
    `${D.grid}° 网格）；阈值 records≥${D.minRecords} 且 species≥${D.minSpecies} 且 observers≥${D.minObservers}` +
    (ebirdNamed ? `；${ebirdNamed} 个 cell 由 eBird 热点就近命名` : '') +
    '。候选：cell 级聚合，**无 topSpecies**。',
  source: 'gbif-sql',
  grid: D.grid,
  thresholds: { minRecords: D.minRecords, minSpecies: D.minSpecies, minObservers: D.minObservers },
  sources: ebirdNamed > 0 ? [GBIF_SQL_SOURCE, EBIRD_SOURCE] : [GBIF_SQL_SOURCE],
  countries: [...new Set(hotspots.map((h) => h.country))].sort(),
  hotspotCount: hotspots.length,
  hotspots,
}
const OUT = args.out
  ? path.resolve(ROOT, args.out)
  : path.join(ROOT, 'data-cache/region/out/hotspots.gbif-sql.json')
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out))
const sizeKb = Math.round((await fs.stat(OUT)).size / 1024)
const named = hotspots.filter((h) => h.name).length
console.log(
  `region-hotspots-sql: 网格 ${rows.length} → 观鸟点 ${hotspots.length}` +
    `（有名 ${named} · eBird 命名 ${ebirdNamed} · ${out.countries.length} 国）→ ${path.relative(ROOT, OUT)} (${sizeKb}KB)`,
)
