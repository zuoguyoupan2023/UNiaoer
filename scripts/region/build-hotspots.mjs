/**
 * 021 M4 腿 B：把带坐标的观测按网格聚合为「统计意义上的观鸟点」→ public/data/hotspots.json（§2.3）。
 *
 * 两个坐标源（`--source`）：
 *  - `gbif`（默认）：GBIF occurrence/search（class Aves、带坐标、近 N 年、按国家分页）
 *    —— 无需 key、许可干净，但 GBIF occurrence 响应体积大、广查询慢，正式跑前先确认网络。
 *  - `xc`：本地 `data-cache/xc/*.json`（build-bank 已抓的 Xeno-canto 响应：lat/lon/loc/date/rec/lic）
 *    —— 完全离线、可复现；覆盖率随 XC 选材（每物种少量录音），点位稀疏但真实。
 *
 * 归一化后统一走 hotspots-lib.aggregateHotspots（去重 + 阈值 + 代表鸟种）。
 *
 * CLI：npm run region:hotspots -- [--source gbif|xc] [--mock] [--countries US,CN]
 *        [--grid 0.1] [--min-records 20] [--min-species 5] [--min-observers 3]
 *        [--max-pages 10] [--years 2021,2026] [--concurrency 4] [--dir path] [--refresh] [--out path]
 *  - --mock：gbif 读 tests/fixtures/region/gbif-hotspots/<CC>.json；xc 读 tests/fixtures/region/xc/
 *    默认输出 data-cache/region/out/hotspots.mock.json（绝不覆盖正式文件）
 *  - 正式输出 public/data/hotspots.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { loadEnv, mapPool, parseArgs, slug } from '../lib/util.mjs'
import { occurrencePoints } from './adapters/gbif.mjs'
import { aggregateHotspots } from './hotspots-lib.mjs'
import {
  GBIF_AVES_TAXON_KEY,
  GBIF_SOURCE,
  HOTSPOT_DEFAULTS,
  SUPPORTED_COUNTRIES,
  XC_SOURCE,
  XC_COUNTRY_ISO,
} from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const GBIF = 'https://api.gbif.org/v1'
const D = HOTSPOT_DEFAULTS

const args = parseArgs(process.argv.slice(2))
const MOCK = !!args.mock
const SOURCE = String(args.source || 'gbif')
const num = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
const GRID = num(args.grid, D.grid)
// mock 用最低阈值（夹具只有少数物种），保证本地走查有产物；正式跑用参数/默认
const MIN_RECORDS = MOCK ? 1 : num(args['min-records'], D.minRecords)
const MIN_SPECIES = MOCK ? 1 : num(args['min-species'], D.minSpecies)
const MIN_OBSERVERS = MOCK ? 0 : num(args['min-observers'], D.minObservers)
const MAX_PAGES = MOCK ? 1 : Math.max(1, Number(args['max-pages']) || D.maxPages)
const PAGE_SIZE = D.pageSize
const CONCURRENCY = MOCK ? 1 : Math.max(1, Number(args.concurrency) || 4)
const YEARS = String(args.years || `${new Date().getFullYear() - D.years},${new Date().getFullYear()}`)
const OUT = args.out
  ? path.resolve(ROOT, args.out)
  : MOCK
    ? path.join(ROOT, 'data-cache/region/out/hotspots.mock.json')
    : path.join(ROOT, 'public/data/hotspots.json')

await loadEnv()

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const manifest = await readJson(
  path.join(ROOT, MOCK ? 'tests/fixtures/region/manifest-subset.json' : 'public/data/manifest.json'),
)

/** 支持国过滤（可选；xc 未给则全部映射到支持国的记录） */
const COUNTRY_FILTER = args.countries
  ? new Set(String(args.countries).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  : null

/** 学名归一化（去作者/标点、小写、取前两词）——GBIF `species` / XC `gen sp` 与 manifest nameSci 对齐 */
function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
}

const nameMap = new Map()
for (const sp of manifest.species || []) {
  const n = normName(sp.nameSci)
  if (n) nameMap.set(n, sp.id)
}

/** 真实 gbif：从 build-taxa / provinces 缓存建立「GBIF usageKey → manifest id」映射（不联网） */
async function buildKeyMap() {
  const map = new Map()
  const cacheDir = path.join(ROOT, 'data-cache/region/gbif-match')
  await Promise.all(
    (manifest.species || []).map(async (sp) => {
      const put = (k) => {
        if (k) map.set(Number(k), sp.id)
      }
      try {
        const m = await readJson(path.join(cacheDir, `${slug(sp.nameSci)}.json`))
        put(m.usageKey)
        put(m.acceptedUsageKey)
      } catch {
        /* 无 match 缓存 */
      }
      if (sp.taxonId) {
        try {
          const g = await readJson(path.join(ROOT, `data-cache/gbif/${sp.taxonId}.json`))
          put(g.usageKey)
        } catch {
          /* 无 build-taxa 缓存 */
        }
      }
    }),
  )
  return map
}

const keyMap = SOURCE === 'gbif' && !MOCK ? await buildKeyMap() : new Map()

function resolveSpeciesId({ speciesKey, sci }) {
  if (speciesKey && keyMap.has(Number(speciesKey))) return keyMap.get(Number(speciesKey))
  return nameMap.get(normName(sci)) || null
}

/** 把「原始 source 记录」补上 speciesId / country，过滤无坐标/无国家 */
function normalize(records) {
  const out = []
  for (const r of records) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue
    if (!r.country) continue
    if (COUNTRY_FILTER && !COUNTRY_FILTER.has(r.country)) continue
    out.push({ ...r, speciesId: resolveSpeciesId(r) || undefined })
  }
  return out
}

/** ---- GBIF 源 ---- */
const client = createClient({
  name: 'gbif-hotspot',
  cacheDir: path.join(ROOT, 'data-cache/region/gbif-hotspots'),
  qps: 5,
  timeoutMs: 90_000,
  retries: 4,
})

const failed = []
let pagesDone = 0

async function fetchGbifCountry(cc) {
  if (MOCK) {
    const payload = await readJson(path.join(ROOT, `tests/fixtures/region/gbif-hotspots/${cc}.json`)).catch(
      () => ({ results: [] }),
    )
    return occurrencePoints(payload)
  }
  const records = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${GBIF}/occurrence/search?country=${cc}&taxonKey=${GBIF_AVES_TAXON_KEY}` +
      `&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT` +
      `&notIssue=ESCAPED&notIssue=CULTIVATED&year=${YEARS}` +
      `&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
    const payload = await client.getJson(url, {
      cacheFile: `${cc}/page-${page}.json`,
      force: !!args.refresh,
      timeout: 90_000,
    })
    records.push(...occurrencePoints(payload))
    pagesDone++
    if ((payload?.results || []).length < PAGE_SIZE || payload?.endOfRecords) break
  }
  return records
}

async function gatherGbif() {
  const FIX_COUNTRIES = MOCK
    ? (await fs.readdir(path.join(ROOT, 'tests/fixtures/region/gbif-hotspots')).catch(() => []))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
    : []
  const countries = COUNTRY_FILTER
    ? [...COUNTRY_FILTER]
    : MOCK
      ? FIX_COUNTRIES
      : SUPPORTED_COUNTRIES
  console.log(
    `region-hotspots[gbif]: ${countries.length} 国 · grid=${GRID} · 阈值 rec≥${MIN_RECORDS}/sp≥${MIN_SPECIES}/obs≥${MIN_OBSERVERS}` +
      (MOCK ? '（mock）' : ` · 近 ${YEARS} · 每国 ≤${MAX_PAGES} 页`),
  )
  const per = await mapPool(countries, CONCURRENCY, async (cc) => {
    try {
      const records = (await fetchGbifCountry(cc)).map((r) => ({ ...r, country: r.country || cc }))
      return records
    } catch (e) {
      failed.push(`${cc}: ${e.message}`)
      return []
    }
  })
  return per.flat()
}

/** ---- XC 源（本地 data-cache/xc） ---- */
async function gatherXc() {
  const dir = args.dir
    ? path.resolve(ROOT, args.dir)
    : MOCK
      ? path.join(ROOT, 'tests/fixtures/region/xc')
      : path.join(ROOT, 'data-cache/xc')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'))
  const records = []
  let skippedCountry = 0
  for (const f of files) {
    let payload
    try {
      payload = await readJson(path.join(dir, f))
    } catch {
      continue
    }
    for (const r of payload?.recordings || []) {
      const country = XC_COUNTRY_ISO[String(r.cnt || '').trim()]
      const lat = Number(r.lat)
      const lng = Number(r.lon)
      // XC 缺失坐标常写成 0/0（或空串）→ 丢弃，避免聚出 (0,0) 假点
      if (lat === 0 && lng === 0) continue
      if (!country) {
        skippedCountry++
        continue
      }
      records.push({
        key: `xc:${r.id}`,
        sci: `${r.gen || ''} ${r.sp || ''}`.trim(),
        lat,
        lng,
        country,
        place: r.loc || null,
        observer: r.rec || null,
        date: r.date || null,
        source: 'xeno-canto',
      })
    }
  }
  console.log(
    `region-hotspots[xc]: ${files.length} 文件 → 可用 ${records.length} 条` +
      (skippedCountry ? `（非支持国/无国名丢弃 ${skippedCountry}）` : '') +
      ` · grid=${GRID} · 阈值 rec≥${MIN_RECORDS}/sp≥${MIN_SPECIES}/obs≥${MIN_OBSERVERS}`,
  )
  return records
}

const raw = SOURCE === 'xc' ? await gatherXc() : await gatherGbif()
const allRecords = normalize(raw)
const hotspots = aggregateHotspots(allRecords, {
  grid: GRID,
  minRecords: MIN_RECORDS,
  minSpecies: MIN_SPECIES,
  minObservers: MIN_OBSERVERS,
})

const srcObj = SOURCE === 'xc' ? XC_SOURCE : GBIF_SOURCE
const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    SOURCE === 'xc'
      ? `Xeno-canto 录音坐标（data-cache/xc，含 lat/lon/loc/date/rec）；${GRID}° 网格聚合，` +
        `同 observer 同日同格去重；阈值 recordCount≥${MIN_RECORDS} 且 speciesCount≥${MIN_SPECIES} 且 observerCount≥${MIN_OBSERVERS}`
      : `GBIF occurrence/search（class Aves，带坐标，近 ${YEARS}，按国家分页 ≤${MAX_PAGES} 页/国，` +
        `pageSize=${PAGE_SIZE}）抽样；${GRID}° 网格聚合，同 observer 同日同格去重；` +
        `阈值 recordCount≥${MIN_RECORDS} 且 speciesCount≥${MIN_SPECIES} 且 observerCount≥${MIN_OBSERVERS}`,
  source: SOURCE,
  grid: GRID,
  thresholds: { minRecords: MIN_RECORDS, minSpecies: MIN_SPECIES, minObservers: MIN_OBSERVERS },
  sources: [srcObj],
  countries: [...new Set(hotspots.map((h) => h.country))].sort(),
  hotspotCount: hotspots.length,
  hotspots,
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out))
const sizeKb = Math.round((await fs.stat(OUT)).size / 1024)
const withSpp = hotspots.filter((h) => h.topSpecies.some((s) => s.id)).length
const withName = hotspots.filter((h) => h.name).length
console.log(
  `\nregion-hotspots[${SOURCE}]: 记录 ${allRecords.length}${pagesDone ? `（${pagesDone} 页）` : ''} → ` +
    `观鸟点 ${hotspots.length}（有名 ${withName} · 含可链接鸟种 ${withSpp}）→ ${OUT} (${sizeKb}KB)`,
)
if (failed.length) console.error(`失败 ${failed.length} 国（可重跑续传）：\n  - ${failed.join('\n  - ')}`)
