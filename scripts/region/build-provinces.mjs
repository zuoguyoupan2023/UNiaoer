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
import { loadMetaSpecies } from './lib/meta-species.mjs'
import { loadEnv, mapPool, parseArgs, slug } from '../lib/util.mjs'
import { facetCounts } from './adapters/gbif.mjs'
import { buildIndex, displayName, matchSubdivision, NAME_ALIASES } from './adapters/iso3166.mjs'
import { GBIF_SOURCE, SUBDIVISION_SOURCE, SUPPORTED_COUNTRIES } from './config.mjs'
import fsSync from 'node:fs'
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
// 051 S3：`--source meta` 改读权威层（10,844 种，含回填 taxonId）；
// 分发判定从 `distribution.bySpecies`（只覆盖核心库）换成 `species-distribution.byCountry`（249 国短码）。
const SOURCE = args.source === 'meta' ? 'meta' : 'manifest'
let manifest = SOURCE === 'meta' ? null : await readJson(
  path.join(ROOT, MOCK ? 'tests/fixtures/region/manifest-subset.json' : 'public/data/manifest.json'),
)
if (SOURCE === 'meta') {
  manifest = { species: await loadMetaSpecies(ROOT, { withMedia: false }) }
  console.log(`· 数据源：权威层 manifest-meta.json（${manifest.species.length} 种）`)
}
// ⚠️ 语义分叉（051 S3，必须显式选择，不能默认切换）
//   · `--dist manifest`（**默认，沿用旧口径**）：`data/distribution.json`，IUCN 分布，只覆盖核心库 1,299 种。
//     "某国可能有这个种"用的是**权威分布**，保守、不臆造。
//   · `--dist global`：`species-distribution.json`，GBIF occurrence 矩阵，覆盖 10,821 种，
//     但它的"某国有记录"包含**迷鸟/笼养逃逸/博物馆记录**，范围明显更宽
//     （实测：与旧口径的核心种只有 17/1186 国家集合完全一致）。
//     真正的过滤交给查询本身（occurrenceStatus=PRESENT 且排除 ESCAPED/CULTIVATED），
//     代价是**候选任务数暴涨**（15,717 次），换来的是覆盖全球种。
const DIST = args.dist === 'global' ? 'global' : 'manifest'
const distribution =
  DIST === 'global'
    ? { bySpecies: buildDistFromGlobal(manifest.species) }
    : await readJson(
        path.join(ROOT, MOCK ? 'tests/fixtures/region/distribution-subset.json' : 'public/data/distribution.json'),
      )
if (SOURCE === 'meta' && DIST === 'manifest') {
  console.log(
    '⚠ --source meta + --dist manifest：该分布表只覆盖核心库 1,299 种 → 省级层仍只有核心种。' +
      '要扩到全球种请加 --dist global（语义更宽，详见脚本注释）。',
  )
}
const subsRaw = await readJson(
  path.join(ROOT, MOCK ? 'tests/fixtures/region/iso3166-2.json' : 'data-cache/region/iso3166-2/subs.json'),
)
const subdivisions = MOCK ? subsRaw : subsRaw.subdivisions
const COUNTRIES = String(args.countries || (MOCK ? Object.keys(subdivisions) : SUPPORTED_COUNTRIES).join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

/**
 * 051 S3：权威层 → 「物种 → 国家列表」。
 * `species-distribution.json` 是「国家 → taxonKey 短码[]」，这里反向索引成「物种 → 国家[]」，
 * 与 `distribution.bySpecies` 同构，从而复用既有的 `speciesForCountry()`。
 */
function buildDistFromGlobal(species) {
  const bySpecies = {}
  const short = (k) => String(k || '').replace(/^avibase-/, '')
  const keyBySci = new Map()
  const idx = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  for (const e of idx.species) if (e.taxonKey) keyBySci.set(e.nameSci, short(e.taxonKey))
  const dist = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'public/data/species-distribution.json'), 'utf8'))
  for (const sp of species) {
    const code = keyBySci.get(sp.nameSci)
    if (!code) continue
    const countries = []
    for (const [cc, codes] of Object.entries(dist.byCountry || {})) {
      if ((codes || []).map(short).includes(code)) countries.push(cc)
    }
    if (countries.length) bySpecies[sp.id] = countries
  }
  return bySpecies
}

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

/** 物种 → 解析结果（预解析一次，任务与冲突消解共用；见 resolveTaxon / resolveCollisions） */
const resolvedById = new Map()

/**
 * P0-0（2026-10-23）：解析「物种 → 用哪种方式在 GBIF 上计数」。
 *
 * 背景（docs/075 §5）：`species/match` 对 AviList 新拆分/新组合的学名（GBIF 骨架上还没有）会返回
 *   { matchType: 'HIGHERRANK', rank: 'GENUS' | 'KINGDOM', usageKey: <属key> 或 1 }
 * 旧实现只判 `matchType !== 'NONE'` 就采信 → `usageKey = 1` 是**根节点**，查出来的是「该国全部类群」。
 * 实测：`anarhynchus-dealbatus` 的 CN-11 = 809,195 = 北京全部类群（真值 486），US 合计虚高 7 倍。
 *
 * 现在分两路：
 *   · `taxonKey`  —— 只有 EXACT/FUZZY + rank=SPECIES + usageKey>1 + confidence≥90 才采信（SYNONYM 取 acceptedUsageKey）；
 *   · `verbatim`  —— 其余一律改为按**学名字面**计数（`verbatimScientificName=`）。这是 GBIF 上对
 *                    「骨架上还没有的名字」能拿到的最准口径（与 SQL 名册矩阵逐物种吻合）。
 *   · `null`      —— 无学名，跳过（不臆造）。
 */
async function resolveTaxon(sp) {
  // 本地 build-taxa 缓存：只在**带 rank 且为 SPECIES**时采信（该缓存里存在 usageKey=1 的脏条目）
  if (sp.taxonId) {
    try {
      const cached = await readJson(path.join(ROOT, `data-cache/gbif/${sp.taxonId}.json`))
      if (cached?.rank === 'SPECIES' && Number(cached?.usageKey) > 1) {
        return { mode: 'taxonKey', key: cached.usageKey, src: 'local-cache', name: sp.nameSci }
      }
    } catch {
      /* 无缓存 */
    }
  }
  const m = await client.getJson(`${GBIF}/species/match?name=${encodeURIComponent(sp.nameSci)}`, {
    cacheFile: `match/${slug(sp.nameSci)}.json`,
    force: !!args.refresh,
  })
  const ok =
    m &&
    (m.matchType === 'EXACT' || m.matchType === 'FUZZY') &&
    m.rank === 'SPECIES' &&
    Number(m.usageKey) > 1 &&
    Number(m.confidence ?? 0) >= 90 &&
    // 必须落在动物界：`Astur cooperii` 曾 FUZZY 命中植物（kingdom=Plantae/class=Magnoliopsida，置信 84）
    m.kingdom === 'Animalia'
  if (ok) {
    const key = m.status === 'SYNONYM' ? (m.acceptedUsageKey ?? m.usageKey) : m.usageKey
    return {
      mode: 'taxonKey',
      key,
      src: 'match',
      name: sp.nameSci,
      canonicalName: m.canonicalName ?? null,
      status: m.status ?? null,
      usageKey: m.usageKey,
    }
  }
  if (!sp.nameSci) return null
  return {
    mode: 'verbatim',
    name: sp.nameSci,
    usageKey: m?.usageKey ?? null,
    rejected: { matchType: m?.matchType ?? '(无响应)', rank: m?.rank ?? '-', usageKey: m?.usageKey ?? '-' },
  }
}

/** GBIF facet 响应 → { 省码: 记录数 }（未映射的省名计入 unmatched，不臆造） */
function facetToCounts(payload, cc) {
  const counts = {}
  for (const { name, count } of facetCounts(payload, 'stateProvince')) {
    const code = matchSubdivision(index, cc, name)
    if (code) counts[code] = (counts[code] || 0) + count
    else unmatched.set(`${cc}\t${name}`, (unmatched.get(`${cc}\t${name}`) || 0) + count)
  }
  return counts
}

/**
 * P0-0 补充（2026-10-23 扩国实测）：**两个 AviList 物种不得共用同一份 GBIF 数据**。
 *
 * 扩国时抓到 2 组"省份向量完全相同"（同一个 fallback key 的指纹）：
 *   · `Phylloscopus poliocephalus` 是 `P. maforensis` 的 SYNONYM → accepted key 相同；
 *   · `Pycnonotus conradi` 的 accepted key 是**亚种** `P. blanfordi conradi`（GBIF 会展开成整种）。
 * 两者都导致两个物种拿到一模一样的数字（对其中一个必然错）。
 *
 * 规则：每个"重复向量组"里挑一个**名字所有者**（`matchType` 命中且 `status=ACCEPTED` 且
 * canonicalName === AviList 学名），其余改走 `verbatimScientificName`（按字面学名计数）重查；
 * 重查为空 → 该 (物种,国家) 直接丢弃（宁缺勿错）。仍无法消解 → 交给后面的不变量硬失败。
 */
async function resolveCollisions(results) {
  const vecKey = (cc, counts) => {
    const codes = Object.keys(counts)
    if (codes.length < 2) return null
    const sum = Object.values(counts).reduce((a, b) => a + b, 0)
    if (sum <= 1000) return null
    return `${cc}|${[...codes].sort().map((c) => `${c}:${counts[c]}`).join(',')}`
  }
  /** 按字面学名重查（带缓存；同一 (物种,国家) 只查一次） */
  const verbatimCache = new Map()
  async function verbatim(sp, cc) {
    const k = `${cc}/${sp.id}`
    if (verbatimCache.has(k)) return verbatimCache.get(k)
    const url =
      `${GBIF}/occurrence/search?verbatimScientificName=${encodeURIComponent(sp.nameSci)}&country=${cc}` +
      `&facet=stateProvince&facetLimit=200&limit=0&occurrenceStatus=PRESENT`
    const payload = await client.getJson(url, { cacheFile: `${cc}/${sp.id}.verbatim.json`, timeout: 90_000 })
    const counts = facetToCounts(payload, cc)
    verbatimCache.set(k, counts)
    return counts
  }
  /** 找出当前 results 里所有重复向量组 */
  function findGroups() {
    const byKey = new Map()
    results.forEach((r, i) => {
      if (!r) return
      const k = vecKey(r.cc, r.counts)
      if (!k) return
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push({ i, spId: r.sp.id })
    })
    return [...byKey.values()].filter((g) => g.length > 1)
  }

  let fixed = 0
  for (let round = 1; round <= 2; round++) {
    const groups = findGroups()
    if (!groups.length) break
    for (const g of groups) {
      // 第 1 轮：只把"非名字所有者"改成按字面学名计数；第 2 轮：整组都改（应对 GBIF 把两个种当成同一 taxon 的情况）
      const owner = g.find((x) => {
        const t = resolvedById.get(x.spId)
        return t?.mode === 'taxonKey' && t.status === 'ACCEPTED' && t.canonicalName === t.name
      })
      const ownerId = owner?.spId ?? g[0].spId
      const targets = round === 1 ? g.filter((x) => x.spId !== ownerId) : g
      if (!targets.length) continue
      for (const x of targets) {
        const { sp, cc, counts: before } = results[x.i]
        const after = await verbatim(sp, cc)
        const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
        if (sum(after) === sum(before) && JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort())) {
          continue // 字面计数与原来一致 → 换了也没用，留给下一轮/不变量
        }
        console.log(
          `· 冲突消解（第 ${round} 轮）：${sp.nameSci} / ${cc}` +
            `${x.spId === ownerId ? '（名字所有者，但 GBIF 把近缘种并入同一 taxon）' : `（与 ${ownerId} 共用数据）`}` +
            ` → 改按字面学名计数：${sum(before).toLocaleString()} → ${sum(after).toLocaleString()}`,
        )
        results[x.i] = { ...results[x.i], counts: after, mode: 'verbatim' }
        fixed++
      }
    }
  }
  return fixed
}

/** P0-0 不变量：同国内不得有两个物种的省份向量完全相同（合计 > 1,000）——那是"同一个 fallback key"的指纹 */
function findDuplicateVectors(bySpecies) {
  const seen = new Map()
  const dup = []
  for (const [spId, byCc] of Object.entries(bySpecies)) {
    for (const [cc, cells] of Object.entries(byCc)) {
      const codes = Object.keys(cells)
      const sum = Object.values(cells).reduce((a, b) => a + b, 0)
      if (codes.length < 2 || sum <= 1000) continue
      const key = `${cc}|${codes.sort().map((k) => `${k}:${cells[k]}`).join(',')}`
      if (seen.has(key)) dup.push(`${cc}: ${seen.get(key)} ↔ ${spId}（省份向量完全相同，合计 ${sum.toLocaleString()}）`)
      else seen.set(key, spId)
    }
  }
  return dup
}

const byCountry = {}
const bySpecies = {}
const unmatched = new Map()
const failed = []
/** P0-0 观测：走了哪条计数路径 / 被降级（verbatim）的物种清单 */
const modeStats = { taxonKey: 0, verbatim: 0, skipped: 0 }
const fallbacks = new Map()
let done = 0

const tasks = COUNTRIES.flatMap((cc) => speciesForCountry(cc).map((sp) => ({ cc, sp })))
console.log(`region-provinces: ${COUNTRIES.length} 国 × 相关物种 = ${tasks.length} 次查询`)

// 预解析（每个物种一次；match 缓存是热的 → 秒级），冲突消解与任务共用这张表
const speciesList = [...new Map(tasks.map((t) => [t.sp.id, t.sp])).values()]
await mapPool(speciesList, CONCURRENCY, async (sp) => {
  resolvedById.set(sp.id, await resolveTaxon(sp))
})
{
  const vals = [...resolvedById.values()]
  const nTaxon = vals.filter((r) => r?.mode === 'taxonKey').length
  const nVerbatim = vals.filter((r) => r?.mode === 'verbatim').length
  console.log(`解析：${speciesList.length} 物种 · taxonKey ${nTaxon} · verbatim ${nVerbatim} · 跳过 ${vals.filter((r) => !r).length}`)
}

const results = await mapPool(tasks, CONCURRENCY, async ({ cc, sp }) => {
  try {
    let payload
    if (MOCK) {
      payload = await readJson(path.join(FIX, `gbif-province/${cc}/${sp.id}.json`)).catch(() => ({}))
    } else {
      const t = resolvedById.get(sp.id)
      if (!t) {
        modeStats.skipped++
        return null
      }
      modeStats[t.mode]++
      if (t.mode === 'verbatim' && !fallbacks.has(sp.id)) {
        fallbacks.set(sp.id, { name: sp.nameSci, ...t.rejected })
      }
      const url =
        t.mode === 'taxonKey'
          ? `${GBIF}/occurrence/search?taxonKey=${t.key}&country=${cc}` +
            `&facet=stateProvince&facetLimit=200&limit=0&occurrenceStatus=PRESENT`
          : `${GBIF}/occurrence/search?verbatimScientificName=${encodeURIComponent(t.name)}&country=${cc}` +
            `&facet=stateProvince&facetLimit=200&limit=0&occurrenceStatus=PRESENT`
      payload = await client.getJson(url, {
        // P0-0：两种模式的缓存键必须分开，否则 verbatim 会命中旧 taxonKey 的坏响应
        cacheFile: t.mode === 'taxonKey' ? `${cc}/${sp.id}.json` : `${cc}/${sp.id}.verbatim.json`,
        force: !!args.refresh,
        timeout: 90_000,
      })
    }
    const counts = facetToCounts(payload, cc)
    if (++done % 200 === 0) console.log(`  … ${done}/${tasks.length}`)
    return { cc, sp, counts }
  } catch (e) {
    failed.push(`${cc}/${sp.id}: ${e.message}`)
    return null
  }
})

// P0-0 补充：消解"两个物种共用同一份 GBIF 数据"（扩国实测 2 组，见 resolveCollisions 注释）
const collisionFixed = await resolveCollisions(results)
if (collisionFixed) console.log(`冲突消解完成：${collisionFixed} 个 (物种,国家) 改按字面学名计数`)

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

/** P0-0 不变量（2026-10-23）：同国出现"省份向量完全相同"的物种 = 解析缺陷指纹 → 宁可不出产物，也不出错数字 */
const dupVectors = findDuplicateVectors(bySpecies)
if (dupVectors.length) {
  console.error(`\n✗ P0-0 不变量失败：发现 ${dupVectors.length} 组"省份向量完全相同"的物种（同一个 fallback key 的指纹）`)
  for (const d of dupVectors.slice(0, 20)) console.error(`  - ${d}`)
  console.error('  排查：resolveTaxon() 的 rank/matchType 校验是否失效（见 docs/075 §5）')
  process.exit(1)
}

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    'GBIF facet=stateProvince；自由文本经 ISO 3166-2 名称归一化映射到 code；count=GBIF 该国该省记录数。' +
    'P0-0（2026-10-23）：物种解析只在 matchType=EXACT/FUZZY 且 rank=SPECIES 且 confidence>=90 时用 taxonKey；' +
    'AviList 新拆分/新组合的学名（GBIF 骨架上还没有）改用 verbatimScientificName 按学名计数（此前会落到根节点 usageKey=1，' +
    '把"该国全部类群"当成该物种记录数，见 docs/075 §5）。' +
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
console.log(
  `计数路径：taxonKey ${modeStats.taxonKey} · verbatim（按学名兜底）${modeStats.verbatim} · 跳过 ${modeStats.skipped}` +
    (fallbacks.size ? ` · 兜底物种 ${fallbacks.size}` : ''),
)
if (fallbacks.size) {
  console.log('  verbatim 兜底物种（GBIF 骨架无该学名，多为 AviList 新拆分/新组合）：')
  for (const [id, f] of [...fallbacks.entries()].slice(0, 80)) {
    console.log(`  - ${f.name} (${id}) ← match=${f.matchType}/rank=${f.rank}/usageKey=${f.usageKey}`)
  }
  if (fallbacks.size > 80) console.log(`  … 其余 ${fallbacks.size - 80} 个见产物 method 说明`)
}
