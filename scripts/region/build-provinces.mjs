/**
 * 021 M2：构建外国省级数据 public/data/region-provinces.json。
 *
 * 数据链：manifest（species/taxonId）+ distribution.json（物种→国家）
 *        → GBIF occurrence facet=stateProvince（按国家查）
 *        → adapters/iso3166 把自由文本映射为 ISO 3166-2 code
 *        → byCountry（code→名）+ bySpecies（物种→国家→{code: count}）。
 *
 * CLI：npm run region:provinces -- [--mock] [--countries US,CA] [--min 1]
 *        [--concurrency 6] [--refresh] [--ids id1,id2] [--limit N] [--out path]
 *  - --mock：读 tests/fixtures/region/，全链路不联网；默认输出
 *    data-cache/region/out/region-provinces.mock.json（绝不覆盖正式文件）
 *  - 正式输出 public/data/region-provinces.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { loadEnv, mapPool, parseArgs, slug } from '../lib/util.mjs'
import { facetCounts } from './adapters/gbif.mjs'
import { buildIndex, displayName, matchSubdivision, NAME_ALIASES } from './adapters/iso3166.mjs'
import { GBIF_SOURCE, SUBDIVISION_SOURCE, SUPPORTED_COUNTRIES } from './config.mjs'
import { CN_PROVINCES, CN_SPECIAL_COUNTRY } from './cn-provinces.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const GBIF = 'https://api.gbif.org/v1'
const FIX = path.join(ROOT, 'tests/fixtures/region')

const args = parseArgs(process.argv.slice(2))
const MOCK = !!args.mock
const CONCURRENCY = MOCK ? 1 : Math.max(1, Number(args.concurrency) || 6)
const MIN = Math.max(0, Number(args.min) || 1)
const OUT = args.out
  ? path.resolve(ROOT, args.out)
  : MOCK
    ? path.join(ROOT, 'data-cache/region/out/region-provinces.mock.json')
    : path.join(ROOT, 'public/data/region-provinces.json')

await loadEnv()

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const manifest = await readJson(
  path.join(ROOT, MOCK ? 'tests/fixtures/region/manifest-subset.json' : 'public/data/manifest.json'),
)
const distribution = await readJson(
  path.join(ROOT, MOCK ? 'tests/fixtures/region/distribution-subset.json' : 'public/data/distribution.json'),
)
const subsRaw = await readJson(
  path.join(ROOT, MOCK ? 'tests/fixtures/region/iso3166-2.json' : 'data-cache/region/iso3166-2/subs.json'),
)
const subdivisions = MOCK ? subsRaw : subsRaw.subdivisions
const COUNTRIES = String(args.countries || (MOCK ? Object.keys(subdivisions) : SUPPORTED_COUNTRIES).join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

const index = buildIndex(subdivisions, COUNTRIES)
const distBySpecies = distribution.bySpecies || {}

/** 该国可能出现的物种（distribution 反查；未知分布的物种跳过，不臆造） */
function speciesForCountry(cc) {
  return (manifest.species || []).filter((sp) => (distBySpecies[sp.id] || []).includes(cc))
}

const client = createClient({
  name: 'gbif-province',
  cacheDir: path.join(ROOT, 'data-cache/region/gbif-province'),
  qps: 5,
  timeoutMs: 90_000,
  retries: 4,
})

/** taxonomy key：优先复用 build-taxa 缓存，缺则 species/match */
async function resolveUsageKey(sp) {
  if (sp.taxonId) {
    try {
      const cached = await readJson(path.join(ROOT, `data-cache/gbif/${sp.taxonId}.json`))
      if (cached?.usageKey) return cached.usageKey
    } catch {
      /* 无缓存 */
    }
  }
  const m = await client.getJson(`${GBIF}/species/match?name=${encodeURIComponent(sp.nameSci)}`, {
    cacheFile: `match/${slug(sp.nameSci)}.json`,
    force: !!args.refresh,
  })
  return m && m.matchType !== 'NONE' ? (m.usageKey ?? null) : null
}

const byCountry = {}
const bySpecies = {}
const unmatched = new Map()
const failed = []
let done = 0

const tasks = COUNTRIES.flatMap((cc) => speciesForCountry(cc).map((sp) => ({ cc, sp })))
console.log(`region-provinces: ${COUNTRIES.length} 国 × 相关物种 = ${tasks.length} 次查询`)

const results = await mapPool(tasks, CONCURRENCY, async ({ cc, sp }) => {
  try {
    let payload
    if (MOCK) {
      payload = await readJson(path.join(FIX, `gbif-province/${cc}/${sp.id}.json`)).catch(() => ({}))
    } else {
      const key = await resolveUsageKey(sp)
      if (!key) return null
      const url =
        `${GBIF}/occurrence/search?taxonKey=${key}&country=${cc}` +
        `&facet=stateProvince&facetLimit=200&limit=0&occurrenceStatus=PRESENT`
      payload = await client.getJson(url, {
        cacheFile: `${cc}/${sp.id}.json`,
        force: !!args.refresh,
        timeout: 90_000,
      })
    }
    const counts = {}
    for (const { name, count } of facetCounts(payload, 'stateProvince')) {
      const code = matchSubdivision(index, cc, name)
      if (code) counts[code] = (counts[code] || 0) + count
      else unmatched.set(`${cc}\t${name}`, (unmatched.get(`${cc}\t${name}`) || 0) + count)
    }
    if (++done % 200 === 0) console.log(`  … ${done}/${tasks.length}`)
    return { cc, sp, counts }
  } catch (e) {
    failed.push(`${cc}/${sp.id}: ${e.message}`)
    return null
  }
})

/** 日本：优先用赫本式别名做展示名（ISO 原名为训令式，如 Aiti/Hukusima） */
const JP_DISPLAY = {}
for (const [k, code] of Object.entries(NAME_ALIASES)) {
  if (code.startsWith('JP-')) JP_DISPLAY[code] = k.charAt(0).toUpperCase() + k.slice(1)
}

/** ISO code → 展示名（byCountry 用；找不到回退 code） */
function nameOf(cc, code) {
  if (cc === 'JP' && JP_DISPLAY[code]) return JP_DISPLAY[code]
  const raw = index[cc]?.divisions.find((d) => d.code === code)?.name
  return raw ? displayName(raw) : code
}

for (const r of results) {
  if (!r) continue
  const entries = Object.entries(r.counts).filter(([, n]) => n >= MIN)
  if (!entries.length) continue
  ;(bySpecies[r.sp.id] ??= {})[r.cc] = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]))
  byCountry[r.cc] ??= {}
  for (const [code] of entries) byCountry[r.cc][code] = nameOf(r.cc, code)
}

/**
 * M3 中国省级层：
 * - 内地 31 省 = GBIF 记录数（与外国同管线，上方 results 已含 CN）；
 * - 港澳台 = GBIF 里是独立国家码（TW/HK/MO），按铁律 6 并入 CN 省级层并标注
 *   「中国台湾／中国香港／中国澳门」；count 用 distribution.json 国家层存在性（1），
 *   不臆造记录数（birdreport.cn 授权后可换真值，见 021 §5）。
 */
const cnKey = 'CN'
let cnSpecialSpecies = 0
if (byCountry.CN) {
  for (const [spId, ccs] of Object.entries(distBySpecies)) {
    let touched = false
    for (const [cc3, code] of Object.entries(CN_SPECIAL_COUNTRY)) {
      if (!ccs.includes(cc3)) continue
      touched = true
      const byCc = ((bySpecies[spId] ??= {})[cnKey] ??= {})
      byCc[code] ??= 1
    }
    if (touched) cnSpecialSpecies++
  }
  // byCountry.CN = zh 展示名（34 区划全量：无记录的省也列出，省级 UI 完整呈现官方清单）
  byCountry.CN = Object.fromEntries(CN_PROVINCES.map((p) => [p.code, p.zh]))
}

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    'GBIF facet=stateProvince；自由文本经 ISO 3166-2 名称归一化映射到 code；count=GBIF 该国该省记录数。' +
    'CN：内地 31 省=GBIF 记录数；港澳台（CN-71/91/92）由 distribution.json 国家层存在性并入（count=1），显示名按铁律 6 标注',
  sources: [GBIF_SOURCE, SUBDIVISION_SOURCE],
  countries: COUNTRIES,
  byCountry: Object.fromEntries(Object.entries(byCountry).map(([cc, m]) => [cc, Object.fromEntries(Object.entries(m).sort())])),
  // 英文展示名（provincesOf 按 locale 取用）；仅 CN 与 byCountry（zh）不同
  byCountryAlt:
    byCountry.CN && Object.keys(byCountry.CN).length
      ? { CN: Object.fromEntries(CN_PROVINCES.map((p) => [p.code, p.en])) }
      : undefined,
  bySpecies,
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out))
const sizeKb = Math.round((await fs.stat(OUT)).size / 1024)
const speciesN = Object.keys(bySpecies).length
const countryN = Object.keys(byCountry).length
console.log(`\nregion-provinces: ${countryN} 国 / ${speciesN} 物种 → ${OUT} (${sizeKb}KB)` +
  (cnSpecialSpecies ? `（CN 港澳台并入物种 ${cnSpecialSpecies}）` : ''))
if (unmatched.size) {
  const top = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`未映射 stateProvince 名 ${unmatched.size} 个（已丢弃，不臆造），Top：`)
  for (const [k, n] of top) console.log(`  - ${k.replace('\t', ' / ')} (${n})`)
}
if (failed.length) console.error(`失败 ${failed.length} 条（可重跑续传）：\n  - ${failed.slice(0, 10).join('\n  - ')}`)
