/**
 * 039 P1：把 eBird 热点缓存编译成「附近观鸟点」站点产物。
 *
 * 输入：data-cache/region/ebird/hotspot-<CC>.json（`npm run region:ebird` 抓的 15 国 357,094 点）
 * 输出：public/data/hotspots-ebird/index.json + <CC>.json（按国懒加载）
 *
 * ## 两条硬约束同时成立（缺一不可）
 *  ① **体积**：全量 357,094 点 ≈ 67MB（US 一国 30MB），浏览器端不可用；
 *  ② **条款**：eBird ToU 禁止再分发原始数据（`docs/022` §2.5 明示"上线前须评估"）。
 * 故产物是**双重派生的子集**：
 *  - **质量门槛** `--min-species 6`（2026-10-09 从 50 下调）：只留"至少记录过 6 种"的点位，
 *    滤掉"只去过一次、记录了 1–5 种"的偶发记录。**不再要求 50 种**——实测被 50 挡掉的多是
 *    "少人去过但真实存在"的目的地（卧牛山森林公园、阿尔山杜鹃湖、敬亭山…），在欠开发地区
 *    这恰恰是最需要被列出的点（用户实测反馈：安徽只剩 36 个太少）；
 *  - **空间去重** `--cell-deg 0.25`（≈28km）每格只留物种数最多的 `--per-cell 1` 个。
 *    **体积与"派生"性质主要由这条保证**：每格只出一个，且**纯加性**——下调门槛只会填补
 *    原先空着的格，绝不会把同一格里更好的点位挤掉（格内仍取物种数最多者）。
 * 实测（15 国）：357,094 → 31,279 点（8.8%），合计 ≈5.5MB；25km 半径召回率 ≥92%，
 * CN 1,929 点（安徽 69）。
 *
 * ## 三层结构（去重：GBIF 网格统计按 id 只存一份）
 * ```jsonc
 * {
 *   "cc": "CN", "count": 1171,
 *   "grids": { "CN-g1-39_116": { "r": 28504, "s": 320, "top": [...] } },  // GBIF 1° 网格统计，共享
 *   "spots": [{ "i": "L4140689", "n": "九连山", "lat": 24.5, "lng": 114.5,
 *               "sub": "CN-36", "p": 180, "o": "2026-09-20", "grid": "CN-g1-24_114", "km": 12 }]
 * }
 * ```
 * 字段短名是**刻意的**（US 那个文件 1.1 万点，长名多出 ~15% 体积）；映射见下方 JSDoc 与
 * `src/core/nearbySpots.ts` 的接口定义，两处必须同步。
 *   i=locId（eBird 热点 id，可派生 https://ebird.org/hotspot/<i>）
 *   n=名称 · lat/lng=坐标 · sub=省码 · p=该点记录过的鸟种数 · o=最近记录日期
 *   grid/km=最近的 GBIF 1° 网格 id 与其中心距离（km，用于"这一带有什么"）
 *
 * CLI：npm run region:nearby-spots -- [--min-species 6] [--cell-deg 0.25] [--per-cell 1]
 *        [--countries CN,US] [--out dir] [--no-gbif]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { distanceKm, hotspotRecords } from './adapters/ebird.mjs'
import { EBIRD_SOURCE, GBIF_SQL_SOURCE, SUPPORTED_COUNTRIES } from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

const MIN_SPECIES = Math.max(0, num(args['min-species'], 6))
const CELL_DEG = Math.max(0, num(args['cell-deg'], 0.25))
const PER_CELL = Math.max(1, num(args['per-cell'], 1))
/** 与 GBIF 网格中心的最大挂接距离（km）；超出则视作"附近没有网格统计" */
const GRID_MAX_KM = Math.max(1, num(args['grid-max-km'], 120))
const USE_GBIF = !args['no-gbif']
const WANT = String(args.countries || SUPPORTED_COUNTRIES.join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

/** 一个网格的代表点：按物种数降序取前 perCell（并列按 locId 定序，保证确定性） */
function pickRepresentatives(spots, { cellDeg, perCell, minSpecies }) {
  const kept = spots.filter((h) => (h.speciesCount ?? 0) >= minSpecies && Number.isFinite(h.lat) && Number.isFinite(h.lng))
  if (!cellDeg) return kept
  const cells = new Map()
  for (const h of kept) {
    const key = `${Math.floor(h.lat / cellDeg)}_${Math.floor(h.lng / cellDeg)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(h)
  }
  const out = []
  for (const list of cells.values()) {
    list.sort((a, b) => (b.speciesCount ?? 0) - (a.speciesCount ?? 0) || a.id.localeCompare(b.id))
    out.push(...list.slice(0, perCell))
  }
  return out
}

const dir = path.join(ROOT, 'data-cache/region/ebird')
const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^hotspot-.*\.json$/.test(f))
if (!files.length) throw new Error('找不到 eBird 热点缓存（先跑 npm run region:ebird）')

// GBIF 网格统计（可选）：按国家分组，供"这一带有什么"
let gbifByCountry = new Map()
if (USE_GBIF) {
  try {
    const g = await readJson(path.join(ROOT, 'public/data/hotspots.json'))
    for (const h of g.hotspots ?? []) {
      if (!gbifByCountry.has(h.country)) gbifByCountry.set(h.country, [])
      gbifByCountry.get(h.country).push(h)
    }
    console.log(`region-nearby-spots: GBIF 网格 ${g.hotspots?.length ?? 0} 点作"这一带有什么"补充`)
  } catch (e) {
    console.warn(`region-nearby-spots: 跳过 GBIF 补充（${e.message}）`)
  }
}

const OUT_DIR = path.resolve(ROOT, args.out || 'public/data/hotspots-ebird')
await fs.mkdir(OUT_DIR, { recursive: true })

const countries = []
let totalKept = 0
let totalRaw = 0
for (const cc of WANT) {
  const file = files.find((f) => f === `hotspot-${cc}.json`)
  if (!file) continue
  const raw = hotspotRecords(await readJson(path.join(dir, file)))
  const kept = pickRepresentatives(raw, {
    cellDeg: CELL_DEG,
    perCell: PER_CELL,
    minSpecies: MIN_SPECIES,
  })
  totalRaw += raw.length
  totalKept += kept.length

  const gbif = gbifByCountry.get(cc) ?? []
  const grids = {}
  const spots = []
  for (const h of kept) {
    // 最近的 GBIF 网格（同国；无则不带 —— 不臆造"附近统计"）
    let near = null
    for (const x of gbif) {
      const d = distanceKm(h.lat, h.lng, x.lat, x.lng)
      if (!near || d < near.d) near = { x, d }
    }
    const o = {
      i: h.id,
      n: h.name ?? null,
      lat: Math.round(h.lat * 1e5) / 1e5,
      lng: Math.round(h.lng * 1e5) / 1e5,
    }
    if (h.subnational1) o.sub = h.subnational1
    if (h.speciesCount != null) o.p = h.speciesCount
    if (h.latestObsDt) o.o = String(h.latestObsDt).slice(0, 10)
    if (near && near.d <= GRID_MAX_KM) {
      o.grid = near.x.id
      o.km = Math.round(near.d)
      if (!grids[near.x.id]) {
        grids[near.x.id] = {
          r: near.x.recordCount,
          s: near.x.speciesCount,
          top: (near.x.topSpecies ?? []).slice(0, 3),
        }
      }
    }
    spots.push(o)
  }
  spots.sort((a, b) => (b.p ?? 0) - (a.p ?? 0) || a.i.localeCompare(b.i))

  // 分片只带 schemaVersion + 数据；口径/署名集中在 index.json（15 份重复没有意义）
  const payload = { schemaVersion: 1, cc, count: spots.length, grids, spots }
  const text = JSON.stringify(payload)
  await fs.writeFile(path.join(OUT_DIR, `${cc}.json`), text)
  countries.push({ cc, count: spots.length, grids: Object.keys(grids).length, bytes: Buffer.byteLength(text) })
  console.log(
    `region-nearby-spots: ${cc} 原始 ${raw.length} → 保留 ${spots.length} 点 / ${Object.keys(grids).length} 网格 ` +
      `(${(Buffer.byteLength(text) / 1024).toFixed(0)}KB)`,
  )
}

const index = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    `eBird 热点名录 → 派生子集：仅取 numSpeciesAllTime≥${MIN_SPECIES} 的成熟观鸟点，` +
    `并按 ${CELL_DEG}°（≈${Math.round(CELL_DEG * 111)}km）网格每格保留物种数最多的 ${PER_CELL} 个` +
    `（体积与"不得再分发原始名录"双重约束，见 docs/022 §2.5 / docs/039 §2.2）` +
    (gbifByCountry.size ? `；spot.grid/km 指向该点 ${GRID_MAX_KM}km 内最近的 GBIF 1° 网格统计（口径见 hotspots.json）` : ''),
  sources: gbifByCountry.size ? [EBIRD_SOURCE, GBIF_SQL_SOURCE] : [EBIRD_SOURCE],
  minSpecies: MIN_SPECIES,
  cellDeg: CELL_DEG,
  perCell: PER_CELL,
  gridMaxKm: GRID_MAX_KM,
  rawTotal: totalRaw,
  total: totalKept,
  countries,
}
await fs.writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(index))
console.log(
  `region-nearby-spots: ${countries.length} 国 · ${totalRaw} → ${totalKept} 点 ` +
    `(保留 ${((totalKept / totalRaw) * 100).toFixed(1)}%) → ${path.relative(ROOT, OUT_DIR)}`,
)
