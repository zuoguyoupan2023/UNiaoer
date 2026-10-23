#!/usr/bin/env node
/**
 * P1-4B（2026-10-23）：省级层**全量构建**（199 个国家/地区，按「省 × 学名」facet）。
 *
 * ## 为什么不沿用 build-provinces 的「按物种 × 国家」切法
 * 旧切法每个 (物种,国家) 一次请求：29 国 = 26,893 次；扩到 199 国要 10 万+ 次（5 qps ≈ 6–8 小时）。
 * GBIF 支持 `facet=scientificName`，于是**按省查一次**就能拿到该省全部鸟种：
 *   GET /occurrence/search?country=<CC>&stateProvince=<原始省名>&taxonKey=212
 *       &facet=scientificName&facetLimit=10000&limit=0&occurrenceStatus=PRESENT
 * 请求数 ≈ Σ(每国「能映射到 ISO 的原始省名」个数) ≈ 2,000–3,000 次（≈10 分钟），少两个数量级。
 *
 * ⚠️ `facetLimit` 必须给足：加州 3,326 个学名，limit=1000 会**静默截断**（实测缺口 68,099 条）。
 *
 * ## 口径（写进产物 method，前端要能自圆其说）
 *   · 只统计 `taxonKey=212`（Aves）+ `occurrenceStatus=PRESENT` 的记录；
 *   · 只统计**能映射到 ISO 3166-2 省码**的 stateProvince（未映射的丢弃，但**按国记录覆盖率**，
 *     低覆盖国在前端标注「省级明细仅覆盖 X% 的记录」——不折叠地区，也不假装完整）；
 *   · 学名 → 权威层物种：`normBinomial` → manifest-meta 精确 → `data/region-name-aliases.json`
 *     （提交物）→ `data-cache/region/name-bridge.json`；都不中的（GBIF 独有分类）丢弃，不猜；
 *   · 港澳台（CN-71/91/92）仍取 `region-records/<TW|HK|MO>.json` 的国家层真值（铁律 6：并入中国）。
 *
 * ## 与旧产物的差异
 * 旧切法按 taxonKey（会合并同物异名），新切法按学名字面 → 同一格差 ≤1%（CN 合计 4.48M vs 4.52M），
 * 67.6% 的格子完全相同（详见 docs/079 §4.3）。2026-10-23 用户决定：**199 国统一用新切法**。
 *
 * CLI：
 *   npm run region:provinces:fast                       # 全部有区划的国家
 *   npm run region:provinces:fast -- --countries BR,MX  # 指定国家
 *   npm run region:provinces:fast -- --limit 5 --out data-cache/region/out/pv.json   # 冒烟/干跑
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { loadEnv, mapPool, parseArgs } from '../lib/util.mjs'
import { buildIndex, displayName, matchSubdivision, NAME_ALIASES } from './adapters/iso3166.mjs'
import { GBIF_SOURCE, SUBDIVISION_SOURCE, COUNTRY_DENY, GBIF_AVES_TAXON_KEY } from './config.mjs'
import { CN_PROVINCES, CN_SPECIAL_COUNTRY } from './cn-provinces.mjs'
import { normBinomial } from './verify-provinces-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const GBIF = 'https://api.gbif.org/v1'
const FACEIT_LIMIT = 10000
/** 物种 id 前缀桶位数（与前端 `loadSpeciesProvinces` 一致；check:region 会校验） */
const BUCKET_CHARS = Number(process.env.PROVINCE_BUCKET_CHARS) || 2

const args = parseArgs(process.argv.slice(2))
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 4)
const MIN = Math.max(0, Number(args.min) || 1)
const LIMIT = Number(args.limit) || Infinity
const OUT_DIR = args.out ? path.dirname(path.resolve(ROOT, args.out)) : path.join(ROOT, 'public/data')
const OFFICIAL = !args.out

await loadEnv(path.join(ROOT, '.env'))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

// ── 输入：区划 / 权威层 / 名称别名 ────────────────────────────────
const subsRaw = await readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json'))
const subdivisions = subsRaw.subdivisions || subsRaw
const meta = await readJson(path.join(ROOT, 'public/data/manifest-meta.json'))

const bySci = new Map()
for (const sp of meta.species || []) {
  const k = normBinomial(sp.nameSci)
  if (k && !bySci.has(k)) bySci.set(k, sp.id)
}
const knownIds = new Set((meta.species || []).map((sp) => sp.id))
const alias = new Map()
for (const [name, id] of Object.entries((await readJson(path.join(ROOT, 'data/region-name-aliases.json')).catch(() => ({ map: {} }))).map || {})) {
  if (knownIds.has(id)) alias.set(normBinomial(name), id)
}
try {
  const b = await readJson(path.join(ROOT, 'data-cache/region/name-bridge.json'))
  for (const [name, id] of Object.entries(b.map || {})) {
    const k = normBinomial(name)
    if (knownIds.has(id) && !alias.has(k)) alias.set(k, id)
  }
} catch {
  /* 无桥接表 */
}
/** 学名 → 物种 id（三级、不猜） */
function resolveSpecies(sciName) {
  const k = normBinomial(sciName)
  if (!k) return null
  return bySci.get(k) ?? alias.get(k) ?? null
}

// ── 国家清单：有 ISO 区划的全部（港澳台按铁律 6 归 CN，不作为国家） ──
const ALL_SUBDIV = Object.keys(subdivisions).filter(
  (cc) => (subdivisions[cc]?.length ?? Object.keys(subdivisions[cc] || {}).length) > 0,
)
const requested = String(args.countries || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const COUNTRIES = (requested.length ? requested : ALL_SUBDIV).filter(
  (cc) => !COUNTRY_DENY.has(cc) && !Object.keys(CN_SPECIAL_COUNTRY).includes(cc),
)

const indexOfSubs = buildIndex(subdivisions, COUNTRIES)
const client = createClient({
  name: 'gbif-province-name',
  cacheDir: path.join(ROOT, 'data-cache/region/gbif-province-name'),
  qps: 2,
  timeoutMs: 90_000,
  retries: 6,
})

/** 该字节流的稳定缓存名（用哈希，不能用 slug —— 'Sichuan ?' 与 'Sichuan' 会撞名导致重复计数） */
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16)

async function countryProvinceFacet(cc) {
  // 覆盖干跑抓过同一查询（taxonKey=212 + facet=stateProvince）→ 直接复用同一缓存
  const cached = await readJson(path.join(ROOT, `data-cache/region/gbif-coverage/${cc}.json`)).catch(() => null)
  if (cached?.facets?.[0]?.counts) return cached
  return client.getJson(
    `${GBIF}/occurrence/search?taxonKey=${GBIF_AVES_TAXON_KEY}&country=${cc}` +
      `&facet=stateProvince&facetLimit=1000&limit=0&occurrenceStatus=PRESENT`,
    { cacheFile: `coverage/${cc}.json` },
  )
}

async function provinceSpeciesFacet(cc, rawName) {
  return client.getJson(
    `${GBIF}/occurrence/search?country=${cc}&taxonKey=${GBIF_AVES_TAXON_KEY}` +
      `&stateProvince=${encodeURIComponent(rawName)}&facet=scientificName&facetLimit=${FACEIT_LIMIT}` +
      `&limit=0&occurrenceStatus=PRESENT`,
    { cacheFile: `${cc}/${hash(rawName)}.json` },
  )
}

// ── 主循环：国家 → 省名 → 学名 ────────────────────────────────────
const bySpecies = {} // id → cc → { code: n }
const byCountry = {}
const countryCoverage = {} // cc → { allRecords, mappedRecords, unmatchedRecords, rawNames, mappedNames, species, cells }
const failed = []
const aliasHits = { rows: 0, records: 0 }
let done = 0

const targets = COUNTRIES.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)
console.log(`region:provinces:fast → ${targets.length} 个国家/地区（有 ISO 区划；港澳台归 CN）`)

await mapPool(targets, Math.min(2, CONCURRENCY), async (cc) => {
  try {
    const cov = await countryProvinceFacet(cc)
    const names = cov?.facets?.[0]?.counts || []
    let allRecords = 0
    let mappedRecords = 0
    let unmatchedRecords = 0
    const mappedNames = []
    for (const { name, count } of names) {
      allRecords += count
      const code = matchSubdivision(indexOfSubs, cc, name)
      if (code) {
        mappedRecords += count
        mappedNames.push({ name, code, count })
      } else {
        unmatchedRecords += count
      }
    }
    // 逐个原始省名取 species facet（并发 4，与全局 qps 共用同一个 client）
    // 单个省名失败不拖垮整国：记录失败数，其余照常（重跑会因缓存断点续传、只补缺失的）
    let facetFailed = 0
    const payloads = await mapPool(mappedNames, CONCURRENCY, async (m) => {
      try {
        const payload = await provinceSpeciesFacet(cc, m.name)
        return { ...m, payload }
      } catch {
        facetFailed++
        return { ...m, payload: null }
      }
    })
    let cells = 0
    const speciesSet = new Set()
    for (const { code, payload } of payloads) {
      for (const e of payload?.facets?.[0]?.counts || []) {
        const id = resolveSpecies(e.name)
        if (!id) {
          aliasHits.rows += 0 // 未匹配学名：计入丢弃（见日志）
          continue
        }
        const n = Number(e.count) || 0
        if (n < MIN) continue
        const byCc = (bySpecies[id] ??= {})
        const cellsOf = (byCc[cc] ??= {})
        if (cellsOf[code] === undefined) {
          cells++
          speciesSet.add(id)
        }
        cellsOf[code] = (cellsOf[code] || 0) + n
      }
    }
    countryCoverage[cc] = {
      allRecords,
      mappedRecords,
      unmatchedRecords,
      coverage: allRecords ? Number((mappedRecords / allRecords).toFixed(4)) : 0,
      rawNames: names.length,
      mappedNames: mappedNames.length,
      facetFailed,
      species: speciesSet.size,
      cells,
    }
    if (facetFailed) failed.push(`${cc}: ${facetFailed} 个省名请求失败（重跑可续传）`)
    if (++done % 10 === 0 || facetFailed) console.log(`  … ${done}/${targets.length}（${cc}${facetFailed ? ` · 失败 ${facetFailed}` : ''}）`)
  } catch (e) {
    failed.push(`${cc}: ${e.message}`)
    console.error(`  ✗ ${cc}: ${e.message}`)
  }
})

// ── 展示名 + 港澳台真值（铁律 6） ──────────────────────────────────
const JP_DISPLAY = {}
for (const [k, code] of Object.entries(NAME_ALIASES)) {
  if (code.startsWith('JP-')) JP_DISPLAY[code] = k.charAt(0).toUpperCase() + k.slice(1)
}
function nameOf(cc, code) {
  if (cc === 'JP' && JP_DISPLAY[code]) return JP_DISPLAY[code]
  const raw = indexOfSubs[cc]?.divisions?.find((d) => d.code === code)?.name
  return raw ? displayName(raw) : code
}
for (const [cc, info] of Object.entries(countryCoverage)) {
  if (!info.cells) continue
  const divs = {}
  for (const byCc of Object.values(bySpecies)) {
    for (const code of Object.keys(byCc[cc] || {})) divs[code] = nameOf(cc, code)
  }
  if (Object.keys(divs).length) byCountry[cc] = Object.fromEntries(Object.entries(divs).sort())
}

let honk = 0
if (byCountry.CN) {
  for (const cc3 of Object.keys(CN_SPECIAL_COUNTRY)) {
    const shard = await readJson(path.join(ROOT, `public/data/region-records/${cc3}.json`)).catch(() => null)
    if (!shard?.bySpecies) continue
    const code = CN_SPECIAL_COUNTRY[cc3]
    for (const [spId, n] of Object.entries(shard.bySpecies)) {
      if (!(Number(n) > 0)) continue
      ;((bySpecies[spId] ??= {}).CN ??= {})[code] = Number(n)
      honk++
    }
  }
  byCountry.CN = Object.fromEntries(CN_PROVINCES.map((p) => [p.code, p.zh]))
}

// ── 不变量：同国不得有两个物种省份向量完全相同（旧 P0-0 的指纹；新切法理论上不会出现） ──
const dup = []
{
  const seen = new Map()
  for (const [spId, byCc] of Object.entries(bySpecies)) {
    for (const [cc, cells] of Object.entries(byCc)) {
      const codes = Object.keys(cells)
      const sum = Object.values(cells).reduce((a, b) => a + b, 0)
      if (codes.length < 2 || sum <= 1000) continue
      const k = `${cc}|${codes.sort().map((c) => `${c}:${cells[c]}`).join(',')}`
      if (seen.has(k)) dup.push(`${cc}: ${seen.get(k)} ↔ ${spId}`)
      else seen.set(k, spId)
    }
  }
}
if (dup.length) {
  console.error(`\n✗ 不变量失败：${dup.length} 组"省份向量完全相同"`)
  for (const d of dup.slice(0, 10)) console.error('  -', d)
  process.exit(1)
}

// ── 写产物：按国分片 + 按物种桶 + 索引 ────────────────────────────
const generatedAt = new Date().toISOString()
const COUNTRY_DIR = path.join(OUT_DIR, 'region-provinces')
const SPECIES_DIR = path.join(OUT_DIR, 'region-species')
const writeJson = async (file, obj) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const text = JSON.stringify(obj)
  await fs.writeFile(file, text)
  return Buffer.byteLength(text)
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

const countriesWithData = Object.keys(byCountry).sort()
const countryBytes = {}
const countryCounts = {}
for (const cc of countriesWithData) {
  const bySpeciesCc = {}
  for (const [spId, byCc] of Object.entries(bySpecies)) {
    const cells = byCc[cc]
    if (cells && Object.keys(cells).length) bySpeciesCc[spId] = cells
  }
  if (!Object.keys(bySpeciesCc).length) continue
  countryCounts[cc] = {
    species: Object.keys(bySpeciesCc).length,
    cells: Object.values(bySpeciesCc).reduce((a, c) => a + Object.keys(c).length, 0),
  }
  countryBytes[`${cc}.json`] = await writeJson(path.join(COUNTRY_DIR, `${cc}.json`), {
    schemaVersion: 1,
    cc,
    generatedAt,
    bySpecies: Object.fromEntries(Object.entries(bySpeciesCc).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  })
}

const buckets = {}
for (const [spId, byCc] of Object.entries(bySpecies)) {
  const key = spId.slice(0, BUCKET_CHARS)
  ;(buckets[key] ??= {})[spId] = byCc
}
const bucketBytes = {}
for (const [name, bySpeciesBucket] of Object.entries(buckets)) {
  bucketBytes[`${name}.json`] = await writeJson(path.join(SPECIES_DIR, `${name}.json`), {
    schemaVersion: 1,
    bucket: name,
    generatedAt,
    bySpecies: Object.fromEntries(Object.entries(bySpeciesBucket).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  })
}

// 清理过期分片（国家集合/桶名随数据变化）
for (const [dir, keep] of [
  [COUNTRY_DIR, new Set(Object.keys(countryBytes))],
  [SPECIES_DIR, new Set(Object.keys(bucketBytes))],
]) {
  for (const f of (await fs.readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    if (f === 'index.json' || keep.has(f)) continue
    await fs.rm(path.join(dir, f), { force: true })
  }
}

const METHOD =
  'GBIF occurrence facet（taxonKey=212 Aves, occurrenceStatus=PRESENT）：先取该国家/地区的 stateProvince facet，' +
  '再把每个**能映射到 ISO 3166-2 省码**的省名逐条查 facet=scientificName → 该省每个鸟种的记录数；' +
  '学名按 normBinomial 归并亚种后挂到权威层物种（manifest-meta 精确 → data/region-name-aliases.json → name-bridge），' +
  'GBIF 独有分类丢弃、不猜。' +
  '口径：只统计能映射到 ISO 省名的记录（未映射省名丢弃，但各国 `coverage` 字段给出可映射占比；' +
  '低于 90% 的国家在前端标注"省级明细仅覆盖 X% 的记录"）。' +
  '与旧「按物种 taxonKey」切法差别 ≤1%（taxonKey 会合并同物异名，按学名不会）。' +
  'CN：内地 31 省=GBIF；港澳台（CN-71/91/92）按铁律 6 并入，记录数取该国家码（TW/HK/MO）的国家层真值。'

const allSpecies = Object.keys(bySpecies).length
const countries = Object.keys(countryBytes).map((f) => f.replace(/\.json$/, ''))
const coverageStats = {
  countries: countries.length,
  /** 国家 → 可映射记录占比（1 = 全部记录都归到了省） */
  byCountry: countryCoverage,
}
const index = {
  schemaVersion: 1,
  generatedAt,
  method: METHOD,
  sources: [GBIF_SOURCE, SUBDIVISION_SOURCE],
  countries,
  byCountry: Object.fromEntries(Object.entries(byCountry).sort()),
  byCountryAlt: byCountry.CN ? { CN: Object.fromEntries(CN_PROVINCES.map((p) => [p.code, p.en])) } : undefined,
  counts: {
    countries: countries.length,
    species: allSpecies,
    cells: sum(Object.fromEntries(Object.values(countryCounts).map((c, i) => [i, c.cells]))),
  },
  countryCounts,
  coverage: coverageStats,
  sharding: {
    dir: 'region-provinces',
    files: Object.keys(countryBytes).sort(),
    bytes: countryBytes,
    maxBytes: Math.max(0, ...Object.values(countryBytes)),
    totalBytes: sum(countryBytes),
  },
  speciesSharding: {
    dir: 'region-species',
    bucketChars: BUCKET_CHARS,
    buckets: Object.keys(bucketBytes).sort(),
    bytes: bucketBytes,
    maxBytes: Math.max(0, ...Object.values(bucketBytes)),
    totalBytes: sum(bucketBytes),
  },
}
// counts.cells 用 countryCounts 求和（上面那行只是保持字段顺序）
index.counts.cells = Object.values(countryCounts).reduce((a, c) => a + c.cells, 0)
const indexBytes = await writeJson(path.join(COUNTRY_DIR, 'index.json'), index)

const maxCountry = Object.entries(countryBytes).sort((a, b) => b[1] - a[1])[0]
const maxBucket = Object.entries(bucketBytes).sort((a, b) => b[1] - a[1])[0]
const lowCoverage = countries.filter((cc) => (countryCoverage[cc]?.coverage ?? 1) < 0.9)
console.log(
  `\n✓ 省级层（新切法）：${countries.length} 国 / ${allSpecies} 物种 / ` +
    `${Object.values(countryCounts).reduce((a, c) => a + c.cells, 0).toLocaleString()} 格 / ` +
    `港澳台 ${honk} 格（TW/HK/MO 真值）`,
)
console.log(
  `  索引 ${(indexBytes / 1024).toFixed(0)}KB · 国家分片 ${Object.keys(countryBytes).length} 个（合计 ${(sum(countryBytes) / 1e6).toFixed(2)}MB，` +
    `最大 ${maxCountry?.[0]} ${((maxCountry?.[1] ?? 0) / 1024).toFixed(0)}KB）· 物种桶 ${Object.keys(bucketBytes).length} 个` +
    `（${(sum(bucketBytes) / 1e6).toFixed(2)}MB，最大 ${maxBucket?.[0]} ${((maxBucket?.[1] ?? 0) / 1024).toFixed(0)}KB）`,
)
console.log(`  覆盖率 <90% 的国家 ${lowCoverage.length} 个（前端会标注）：${lowCoverage.slice(0, 20).join(' ')}${lowCoverage.length > 20 ? ' …' : ''}`)
if (failed.length) console.error(`✗ 失败 ${failed.length} 国（可重跑续传）：\n  - ${failed.slice(0, 10).join('\n  - ')}`)
if (OFFICIAL) {
  console.log(`  产物目录：${path.relative(ROOT, COUNTRY_DIR)}/ · ${path.relative(ROOT, SPECIES_DIR)}/`)
} else {
  console.log(`（--out 干跑：未写 public/data；输出在 ${path.relative(ROOT, COUNTRY_DIR)}/）`)
}
