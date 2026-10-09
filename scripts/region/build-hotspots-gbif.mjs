/**
 * 022 §1.7.4：用 **GBIF SQL 1° 网格**（cell `0008819` + species `0008820`）替换正式
 * `public/data/hotspots.json`，并用 eBird 热点就近命名（可选）。
 *
 * 数据链：cell 聚合（records/species/observers，精确 distinct）+ species 明细（topSpecies）
 *        → 阈值过滤 → 物种学名映射 manifest id → eBird 就近命名/补 subnational1
 *        → 041 A2：GBIF 网格×stateProvince 补省码（eBird 命名覆盖不到的格）
 * 体积：1° 网格 + 阈值，控制在 021 §2.3 的 2MB 内。
 *
 * CLI：npm run region:hotspots-gbif -- [--ebird-names] [--grid 1] [--top 5]
 *        [--min-records 5] [--min-species 3] [--min-observers 3] [--cell in.json] [--sp in.json] [--out path]
 *        [--cell-provinces in.json] [--min-province-share 0.5]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { hotspotRecords } from './adapters/ebird.mjs'
import { buildIndex } from './adapters/iso3166.mjs'
import { applyEbirdNames, fillSubnationalFromCells } from './hotspots-lib.mjs'
import { normBinomial } from './verify-provinces-lib.mjs'
import { EBIRD_SOURCE, GBIF_SQL_SOURCE, HOTSPOT_DEFAULTS, SUBDIVISION_SOURCE, SUPPORTED_COUNTRIES } from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

const GRID = num(args.grid, 1)
const MIN_RECORDS = num(args['min-records'], HOTSPOT_DEFAULTS.minRecords)
const MIN_SPECIES = num(args['min-species'], HOTSPOT_DEFAULTS.minSpecies)
const MIN_OBSERVERS = num(args['min-observers'], HOTSPOT_DEFAULTS.minObservers)
const TOP = Math.max(1, num(args.top, 3))

async function findSql(prefix, explicit) {
  if (explicit) {
    // 允许「下载 key」或相对仓库根的路径（与 region:gbif-sql 落盘位置一致）
    const direct = path.resolve(ROOT, explicit)
    if (await fs.stat(direct).then(() => true).catch(() => false)) return direct
    const byKey = path.join(ROOT, 'data-cache/region/gbif-sql', `${explicit}.json`)
    if (await fs.stat(byKey).then(() => true).catch(() => false)) return byKey
    return direct // 交给 readFile 报错（路径更直观）
  }
  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => new RegExp(`^${prefix}-.*\\.json$`).test(f)).sort()
  if (!files.length) throw new Error(`找不到 SQL 结果（先 npm run region:gbif-sql -- --key ${prefix}-…）`)
  return path.join(dir, files[files.length - 1])
}

const [cellFile, spFile] = await Promise.all([findSql('0008819', args.cell), findSql('0008820', args.sp)])
const [cells, spRows, manifest] = await Promise.all([
  readJson(cellFile),
  readJson(spFile),
  readJson(path.join(ROOT, 'public/data/manifest.json')),
])

const speciesMap = new Map()
for (const sp of manifest.species || []) {
  const k = normBinomial(sp.nameSci)
  if (k && !speciesMap.has(k)) speciesMap.set(k, sp.id)
}

const cellKey = (r) => `${String(r.countrycode).toUpperCase()}|${r.latb}|${r.lngb}`

// 物种明细按 cell 归集 → topSpecies
const byCell = new Map()
for (const r of spRows) {
  const id = speciesMap.get(normBinomial(r.scientificname))
  const key = cellKey(r)
  if (!byCell.has(key)) byCell.set(key, new Map())
  const m = byCell.get(key)
  const sk = id || `sci:${normBinomial(r.scientificname)}`
  m.set(sk, (m.get(sk) || 0) + (Number(r.n) || 0))
}

const hotspots = []
for (const c of cells) {
  const records = Number(c.records) || 0
  const species = Number(c.species) || 0
  const observers = Number(c.observers) || 0
  const country = String(c.countrycode).toUpperCase()
  if (records < MIN_RECORDS || species < MIN_SPECIES || observers < MIN_OBSERVERS) continue
  const latb = Number(c.latb)
  const lngb = Number(c.lngb)
  if (!Number.isFinite(latb) || !Number.isFinite(lngb)) continue
  const topSpecies = [...(byCell.get(cellKey(c)) || new Map()).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP)
    .map(([sk, count]) => (sk.startsWith('sci:') ? { sci: sk.slice(4), count } : { id: sk, count }))
  hotspots.push({
    id: `${country}-g${GRID}-${latb}_${lngb}`.replace(/[^a-zA-Z0-9._-]+/g, '-'),
    lat: Math.round((latb + 0.5) * GRID * 10000) / 10000,
    lng: Math.round((lngb + 0.5) * GRID * 10000) / 10000,
    country,
    speciesCount: species,
    recordCount: records,
    observerCount: observers,
    topSpecies,
    sources: ['gbif'],
  })
}

let ebirdNamed = 0
if (args['ebird-names']) {
  const dir = path.join(ROOT, 'data-cache/region/ebird')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^hotspot-.*\.json$/.test(f))
  const spots = []
  for (const f of files) {
    try {
      for (const r of hotspotRecords(await readJson(path.join(dir, f)))) spots.push(r)
    } catch (e) {
      console.error(`region-hotspots-gbif: eBird 读取失败 ${f}：${e.message}`)
    }
  }
  const named = applyEbirdNames(hotspots, spots, { maxKm: num(args['ebird-max-km'], 30) })
  hotspots.length = 0
  hotspots.push(...named)
  ebirdNamed = hotspots.filter((h) => h.ebirdId).length
  console.log(`region-hotspots-gbif: eBird 名录 ${spots.length} · 命名 ${ebirdNamed} 个 cell`)
}

// 041 A2：eBird 命名覆盖不到的格，用 GBIF「网格 × stateProvince」多数票补省码。
// 输入 SQL（DOI 另记）：SELECT countrycode, stateprovince, FLOOR(decimallatitude) latb,
//   FLOOR(decimallongitude) lngb, COUNT(*) n ... WHERE class='Aves' AND stateprovince IS NOT NULL
//   AND countrycode IN (15 国) AND "year">=2021 GROUP BY countrycode, stateprovince, FLOOR(lat), FLOOR(lng)
let cellProvinces = { filled: 0, skipped: 0 }
const MIN_PROVINCE_SHARE = num(args['min-province-share'], 0.5)
if (args['cell-provinces']) {
  const cellProvinceFile = path.resolve(ROOT, String(args['cell-provinces']))
  const resolved = await fs.stat(cellProvinceFile).then(() => cellProvinceFile)
    .catch(() => path.join(ROOT, 'data-cache/region/gbif-sql', `${args['cell-provinces']}.json`))
  const rows = await readJson(resolved)
  const subsRaw = await readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json'))
  const index = buildIndex(subsRaw.subdivisions || subsRaw, SUPPORTED_COUNTRIES)
  const res = fillSubnationalFromCells(hotspots, rows, index, { grid: GRID, minShare: MIN_PROVINCE_SHARE })
  hotspots.length = 0
  hotspots.push(...res.hotspots)
  cellProvinces = { filled: res.filled, skipped: res.skipped }
  console.log(
    `region-hotspots-gbif: 网格×省聚合 ${rows.length} 行 → 补省码 ${res.filled} 个 cell` +
      `（份额不足放弃 ${res.skipped}；来源 ${path.relative(ROOT, resolved)}）`,
  )
}

const sources = new Set([GBIF_SQL_SOURCE])
if (ebirdNamed > 0) sources.add(EBIRD_SOURCE)
if (cellProvinces.filled > 0) sources.add(SUBDIVISION_SOURCE)

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    `GBIF SQL ${GRID}° 网格（class='Aves'，近 ${new Date().getFullYear() - 2020}+ 年，` +
    `countrycode ∈ ${SUPPORTED_COUNTRIES.length} 国）；cell=records/species/observers（精确 distinct），` +
    `topSpecies 取网格内记录数前 ${TOP}；阈值 records≥${MIN_RECORDS} 且 species≥${MIN_SPECIES} 且 observers≥${MIN_OBSERVERS}` +
    (ebirdNamed ? `；${ebirdNamed} 个 cell 由 eBird 热点就近命名` : '') +
    (cellProvinces.filled
      ? `；${cellProvinces.filled} 个无省码的 cell 按 GBIF 网格内 stateProvince 多数票（份额≥${MIN_PROVINCE_SHARE}）补省码`
      : ''),
  source: 'gbif-sql',
  grid: GRID,
  thresholds: { minRecords: MIN_RECORDS, minSpecies: MIN_SPECIES, minObservers: MIN_OBSERVERS },
  sources: [...sources],
  countries: [...new Set(hotspots.map((h) => h.country))].sort(),
  hotspotCount: hotspots.length,
  hotspots,
}

const OUT = args.out ? path.resolve(ROOT, args.out) : path.join(ROOT, 'public/data/hotspots.json')
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out))
const sizeKb = Math.round((await fs.stat(OUT)).size / 1024)
const named = hotspots.filter((h) => h.name).length
const withSpp = hotspots.filter((h) => h.topSpecies.some((s) => s.id)).length
console.log(
  `region-hotspots-gbif: cell ${cells.length} → 观鸟点 ${hotspots.length}` +
    `（有名 ${named} · eBird 命名 ${ebirdNamed} · 含可链接鸟种 ${withSpp} · ${out.countries.length} 国）` +
    `→ ${path.relative(ROOT, OUT)} (${sizeKb}KB)`,
)
