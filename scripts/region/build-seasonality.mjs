/**
 * 021 M1：构建季节性数据 public/data/seasonality.json（schema v1，§2.3）。
 *
 * 月份来源（多源逐月取最大份额，见 seasonality-lib）：
 *  - manifest 媒体自带 month：XC date / iNat observed_on（build-bank 起捕获；
 *    旧 manifest 需重跑 bank 才有，此处有则用、无则跳过，不编造）
 *  - GBIF occurrence facet=month（taxonKey 优先复用 build-taxa 留下的
 *    data-cache/gbif/<taxonId>.json，缺则现场 species/match 并缓存）
 *
 * CLI：npm run region:build [-- --mock] [--ids id1,id2] [--limit N] [--refresh] [--out path] [--concurrency N]
 *  - --mock：读 tests/fixtures/region/（夹具 manifest + GBIF 响应），全链路不联网；
 *    默认输出 data-cache/region/out/seasonality.mock.json（绝不覆盖正式文件）
 *  - 正式输出 public/data/seasonality.json（提交入库，CI 用 check:region 校验）
 *  - --concurrency：在途请求上限（默认 6，GBIF 低并发礼貌值；qps 仍由 http.mjs 统一节流）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { loadEnv, mapPool, parseArgs, slug } from '../lib/util.mjs'
import { buildEntry, countsFromGbifFacet, countsFromMedia } from './seasonality-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const GBIF = 'https://api.gbif.org/v1'

const args = parseArgs(process.argv.slice(2))
const MOCK = !!args.mock
const CONCURRENCY = MOCK ? 1 : Math.max(1, Number(args.concurrency) || 6)
const OUT = args.out
  ? path.resolve(ROOT, args.out)
  : MOCK
    ? path.join(ROOT, 'data-cache/region/out/seasonality.mock.json')
    : path.join(ROOT, 'public/data/seasonality.json')

await loadEnv()

const manifestPath = MOCK
  ? path.join(ROOT, 'tests/fixtures/region/manifest-subset.json')
  : path.join(ROOT, 'public/data/manifest.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

let species = manifest.species || []
if (args.ids) {
  const want = new Set(String(args.ids).split(',').map((s) => s.trim()))
  species = species.filter((sp) => want.has(sp.id))
}
if (args.limit) species = species.slice(0, Number(args.limit))

// GBIF 响应夹具：tests/fixtures/region/gbif-month/<speciesId>.json
const fixtureDir = path.join(ROOT, 'tests/fixtures/region/gbif-month')
async function readGbifFixture(speciesId) {
  try {
    return JSON.parse(await fs.readFile(path.join(fixtureDir, `${speciesId}.json`), 'utf8'))
  } catch {
    return { facets: [] } // 夹具缺失 = 该种无 GBIF 响应（合法场景）
  }
}

const client = createClient({
  name: 'gbif',
  cacheDir: path.join(ROOT, 'data-cache/region/gbif-month'),
  qps: 5,
  timeoutMs: 60_000,
  retries: 4,
})

/** taxonomy key：优先复用 build-taxa 缓存（data-cache/gbif/<taxonId>.json），缺则现场 match */
async function resolveUsageKey(sp) {
  if (sp.taxonId) {
    try {
      const cached = JSON.parse(
        await fs.readFile(path.join(ROOT, `data-cache/gbif/${sp.taxonId}.json`), 'utf8'),
      )
      if (cached?.usageKey) return cached.usageKey
    } catch {
      /* 无缓存，走 match */
    }
  }
  const match = await client.getJson(`${GBIF}/species/match?name=${encodeURIComponent(sp.nameSci)}`, {
    cacheFile: `../gbif-match/${slug(sp.nameSci)}.json`,
    force: !!args.refresh,
  })
  if (!match || match.matchType === 'NONE' || !match.usageKey) return null
  return match.usageKey
}

async function gbifMonthCounts(sp) {
  const usageKey = await resolveUsageKey(sp)
  if (!usageKey) return null
  const url =
    `${GBIF}/occurrence/search?taxonKey=${usageKey}&facet=month&facetLimit=12&limit=0` +
    `&occurrenceStatus=PRESENT&notIssue=ESCAPED&notIssue=CULTIVATED`
  const payload = await client.getJson(url, {
    cacheFile: `${sp.id}.json`,
    force: !!args.refresh,
    timeout: 90_000,
  })
  return countsFromGbifFacet(payload)
}

/** 单物种失败不炸全程（021 §2.1：失败显式记录，最终汇总打印） */
async function gbifMonthCountsSafe(sp) {
  try {
    return await gbifMonthCounts(sp)
  } catch (e) {
    failedIds.push(`${sp.id}: ${e.message}`)
    return null
  }
}

/** manifest 媒体月份 → 按源分组计数（仅统计带 month 的素材，021「不知情不编造」） */
function mediaCountsBySource(sp) {
  const assets = [...(sp.images || []), ...(sp.audios || [])]
  const bySource = { xc: [], inat: [] }
  for (const a of assets) {
    if (a?.source === 'Xeno-canto') bySource.xc.push(a)
    else if (a?.source === 'iNaturalist') bySource.inat.push(a)
  }
  return { xc: countsFromMedia(bySource.xc), inat: countsFromMedia(bySource.inat) }
}

const bySpecies = {}
let gbifOk = 0
let gbifMiss = 0
let speciesWithMediaMonths = 0
const failedIds = []
let done = 0

/** 单物种：GBIF + manifest 媒体月份 → bySpecies 条目（并发池单元，保序返回） */
async function processSpecies(sp) {
  const gbif = MOCK ? countsFromGbifFacet(await readGbifFixture(sp.id)) : await gbifMonthCountsSafe(sp)
  const counts = {}
  if (gbif !== null) counts.gbif = gbif
  const media = mediaCountsBySource(sp)
  counts.xc = media.xc
  counts.inat = media.inat
  const hasMediaMonth = speciesOfAssets(sp).some((a) => a?.month >= 1 && a?.month <= 12)
  if (++done % 100 === 0) console.log(`  … ${done}/${species.length}`)
  return { id: sp.id, entry: buildEntry(counts), gbifOk: gbif !== null, hasMediaMonth }
}

for (const r of await mapPool(species, CONCURRENCY, processSpecies)) {
  if (r.gbifOk) gbifOk++
  else gbifMiss++
  if (r.hasMediaMonth) speciesWithMediaMonths++
  if (r.entry) bySpecies[r.id] = r.entry
}

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  // 口径说明（021 §2.5）：逐月份额多源取最大（iNat 记录亦进 GBIF，避免重复计数）
  method: 'max monthly share across sources (0-100); recordCount = max single-source total',
  sources: ['GBIF', 'Xeno-canto', 'iNaturalist'],
  speciesCount: Object.keys(bySpecies).length,
  bySpecies,
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out))
const sizeKb = Math.round((await fs.stat(OUT)).size / 1024)

console.log(
  `seasonality: 物种 ${species.length} → 有数据 ${Object.keys(bySpecies).length} ` +
    `(GBIF ok ${gbifOk} / miss ${gbifMiss}；媒体月份可用物种 ${speciesWithMediaMonths}) → ${OUT} (${sizeKb}KB)`,
)
if (failedIds.length) {
  console.error(`失败 ${failedIds.length} 条（可重跑续传）：`)
  for (const f of failedIds.slice(0, 20)) console.error('  -', f)
}

/** 该物种全部素材（images/audios + 兼容单数字段） */
function speciesOfAssets(sp) {
  return [...(sp.images || []), ...(sp.audios || []), sp.image, sp.audio].filter(Boolean)
}
