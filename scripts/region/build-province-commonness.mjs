#!/usr/bin/env node
/**
 * 036：构建**省级地区常见度**产物 `public/data/province-commonness.json`。
 *
 * 数据源（按优先级，取第一个可用）：
 *   1. `--sql <file>` 指定的 GBIF SQL 结果（形态二选一，自动识别）：
 *      a) { countrycode, stateprovince, specieskey, n } —— 用 **GBIF backbone id** 匹配骨架（覆盖更全）
 *      b) { countrycode, stateprovince, scientificname, n } —— 用**学名**匹配（回退路径）
 *      默认按 key 自动找 data-cache/region/gbif-sql 下最新的一份（`0008688` / `0016494`）。
 *   2. `--from-provinces`：直接用现有 `public/data/region-provinces.json`（仅核心库 1,186 种；
 *      `--mock` 离线自检用）。
 *
 * 处理链（详见 docs/036 §2.2 与 lib 注释）：
 *   ISO 省名消化 → 骨架物种匹配 → 份额归一 → 异常守卫 → 分位分档 → 人工覆盖 → 产物
 *
 * 留痕（用户 2026-10-08 要求"做好工作留痕，方便后续数据更新后再次迭代"）：
 *   产物内嵌 `provenance`（数据源文件/时间/行数、匹配率、守卫阈值、各档数量、命中统计）
 *   + `report`（每省的 total/matched/trusted/档位分布/守卫命中数，含被跳过的省及原因）。
 *   → 数据更新后重跑本脚本即可，产物自带可比对的"上次口径"。
 *
 * CLI：
 *   npm run region:province-commonness                 # 用最新的 SQL 缓存
 *   npm run region:province-commonness -- --sql <f>    # 指定 SQL 结果
 *   npm run region:province-commonness -- --from-provinces   # 用 region-provinces.json（1,186 种）
 *   npm run region:province-commonness -- --out <f>    # 指定输出（默认写 public/data/）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { buildIndex, matchSubdivision } from './adapters/iso3166.mjs'
import { normBinomial } from './verify-provinces-lib.mjs'
import { SUPPORTED_COUNTRIES, GBIF_SQL_SOURCE, SUBDIVISION_SOURCE } from './config.mjs'
import {
  DEFAULT_GUARDS,
  applyOverrides,
  buildRegionTiers,
  summarize,
} from './province-commonness-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const FROM_PROVINCES = !!args['from-provinces']
const SQL_FILE = args.sql ? path.resolve(ROOT, args.sql) : null
const OUT = args.out
  ? path.resolve(ROOT, args.out)
  : path.join(ROOT, 'public/data/province-commonness.json')
const OVERRIDES_FILE = path.join(ROOT, 'data/region-commonness-overrides.json')

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const round = (x, d = 4) => Number(Number(x).toFixed(d))

// ── 输入：ISO 省名索引 + 骨架 + 现有省级产物 ──────────────────────────
const subsRaw = await readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json'))
const index = buildIndex(subsRaw.subdivisions, SUPPORTED_COUNTRIES)
const speciesIndex = await readJson(path.join(ROOT, 'public/data/species-index.json'))
const core = await readJson(path.join(ROOT, 'public/data/manifest-core.json'))
const globalPool = await readJson(path.join(ROOT, 'public/data/manifest-global.min.json'))

/**
 * 产物键统一为 **manifest 物种 id（slug）**——因为出题/D1/前端画廊都以它为主键。
 * 映射链：GBIF backboneTaxonId → 骨架 taxonKey（AvibaseID）→ manifest id。
 * （骨架自身只有 taxonKey；manifest 核心层 + 全球池提供 taxonKey → id。）
 */
const idByTaxonKey = new Map()
for (const s of core.species || []) if (s.taxonKey) idByTaxonKey.set(s.taxonKey, s.id)
for (const s of globalPool.species || []) {
  if (s.taxonKey && !idByTaxonKey.has(s.taxonKey)) idByTaxonKey.set(s.taxonKey, s.id)
}
/** GBIF backbone id → manifest id（specieskey 形态） */
const byBackbone = new Map()
for (const s of speciesIndex.species) {
  if (!Number.isInteger(s.backboneTaxonId)) continue
  const id = idByTaxonKey.get(s.taxonKey)
  if (id) byBackbone.set(s.backboneTaxonId, id)
}
/**
 * 分类学桥接表（可选；由 `npm run region:resolve-names` 生成）：
 * 旧分类组合名 → manifest id（经 GBIF v2 match 解析再映射 backbone id）。
 * 缺表时静默跳过（覆盖略低但流程照常）。
 */
const bridge = new Map()
try {
  const b = await readJson(path.join(ROOT, 'data-cache/region/name-bridge.json'))
  for (const [name, id] of Object.entries(b.map || {})) bridge.set(normBinomial(name), id)
} catch {
  /* 无桥接表 */
}

/** 归一化学名 → manifest id（学名回退形态） */
const bySci = new Map()
for (const s of speciesIndex.species) {
  const id = idByTaxonKey.get(s.taxonKey)
  if (!id) continue
  const k = normBinomial(s.nameSci)
  if (k && !bySci.has(k)) bySci.set(k, id)
}

// ── 取原始行 ─────────────────────────────────────────────────────────
let rows = []
let sourceInfo = null

if (FROM_PROVINCES) {
  // region-provinces.json 的 bySpecies 结构是 **三层**：speciesId → cc → { code: n }；
  // 且物种已按 id 归一（无需再走匹配，故带上 speciesId 直通）。
  const p = await readJson(path.join(ROOT, 'public/data/region-provinces.json'))
  for (const [speciesId, byCc] of Object.entries(p.bySpecies || {})) {
    for (const [cc, byCode] of Object.entries(byCc || {})) {
      for (const [code, n] of Object.entries(byCode || {})) {
        if (Number(n) > 0) rows.push({ speciesId, cc, code, n: Number(n) })
      }
    }
  }
  sourceInfo = { kind: 'region-provinces.json', file: 'public/data/region-provinces.json', rawRows: rows.length }
} else {
  let file = SQL_FILE
  if (!file) {
    const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
    const cands = (await fs.readdir(dir).catch(() => []))
      .filter((f) => /^00(08688|16494)/.test(f) && f.endsWith('.json'))
      .sort()
    if (!cands.length) throw new Error('找不到 SQL 结果（先 npm run region:gbif-sql，或用 --from-provinces）')
    file = path.join(dir, cands[cands.length - 1])
  }
  const raw = await readJson(file)
  rows = raw
  sourceInfo = { kind: 'gbif-sql', file: path.relative(ROOT, file), rawRows: raw.length }
  if (raw[0]) sourceInfo.shape = 'specieskey' in raw[0] ? 'specieskey' : 'scientificname'
}

// ── 归一化：省名消化 + 物种匹配 + 累计（含未匹配，供份额归一） ────────
const matched = [] // { speciesId, cc, code, n }
const provinceTotals = new Map() // `${cc}|${code}` → 该省**全部**记录数
const countryTotals = new Map() // cc → 该国**全部**记录数
const unmatchedProvince = new Map()
const unmatchedName = new Map()
let matchedRows = 0

for (const r of rows) {
  const n = Number(r.n) || 0
  if (n <= 0) continue
  const cc = String(r.countrycode || r.cc || '').toUpperCase()
  if (!SUPPORTED_COUNTRIES.includes(cc)) continue
  // 两种输入形态：GBIF SQL 给**原始省名**（需 ISO 归一）；region-provinces 已给 **ISO 码**（直通）
  const code =
    r.code && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(String(r.code))
      ? String(r.code)
      : matchSubdivision(index, cc, r.stateprovince)
  if (!code) {
    unmatchedProvince.set(`${cc}\t${r.stateprovince}`, (unmatchedProvince.get(`${cc}\t${r.stateprovince}`) || 0) + n)
    continue
  }
  const key = `${cc}|${code}`
  provinceTotals.set(key, (provinceTotals.get(key) || 0) + n)
  countryTotals.set(cc, (countryTotals.get(cc) || 0) + n)

  // 物种匹配：优先 backbone id（覆盖更全），回退学名
  let speciesId = null
  if (r.speciesId) speciesId = r.speciesId // --from-provinces 已是骨架 id
  else if (r.specieskey != null) speciesId = byBackbone.get(Number(r.specieskey))
  if (!speciesId && r.scientificname) {
    const k = normBinomial(r.scientificname)
    // 三级匹配：骨架学名 → 分类学桥接（旧组合名，如 Parus caeruleus → Cyanistes caeruleus）
    speciesId = bySci.get(k) ?? bridge.get(k)
  }
  if (!speciesId) {
    // 未匹配物种仍计入省总量（份额归一的分母），但不参与分档
    const nm = r.scientificname ?? `key:${r.specieskey}`
    unmatchedName.set(String(nm), (unmatchedName.get(String(nm)) || 0) + n)
    continue
  }
  matched.push({ speciesId, cc, code, n })
  matchedRows++
}

// ── 月度覆盖（spike 守卫；缺失则该守卫自动跳过） ─────────────────────
let monthsCount = null
let monthsInfo = null
try {
  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const cands = (await fs.readdir(dir)).filter((f) => f.startsWith('0008810') && f.endsWith('.json')).sort()
  if (cands.length) {
    const raw = await readJson(path.join(dir, cands[cands.length - 1]))
    const m = new Map()
    for (const r of raw) {
      const id = bySci.get(normBinomial(r.scientificname))
      if (!id) continue
      const cur = m.get(id) ?? new Set()
      cur.add(Number(r.month))
      m.set(id, cur)
    }
    monthsCount = new Map([...m.entries()].map(([k, v]) => [k, v.size]))
    monthsInfo = { file: cands[cands.length - 1], species: monthsCount.size }
  }
} catch {
  monthsCount = null
}

// ── 分档 + 人工覆盖 ──────────────────────────────────────────────────
const guards = { ...DEFAULT_GUARDS }
const { tiers, countryTiers, stats } = buildRegionTiers(
  matched,
  provinceTotals,
  countryTotals,
  monthsCount,
  guards,
)

let overrides = {}
try {
  const o = await readJson(OVERRIDES_FILE)
  overrides = o.overrides || {}
} catch {
  overrides = {}
}
const ov = applyOverrides(tiers, overrides)
const ovCountry = applyOverrides(countryTiers, overrides)

// ── 产物 ────────────────────────────────────────────────────────────
const coverage = summarize(tiers, countryTiers)
const bySpeciesSort = (obj) => {
  const out = {}
  for (const k of Object.keys(obj).sort()) {
    const inner = obj[k]
    out[k] = Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
  }
  return out
}

const product = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    'province share (n / province total) → dominance & seasonal-spike guards → quantile banding (1 most common … 5 rarest) → manual overrides',
  sources: [GBIF_SQL_SOURCE, SUBDIVISION_SOURCE],
  scope: { countries: SUPPORTED_COUNTRIES, levels: ['province', 'country'] },
  guards,
  provenance: {
    ...sourceInfo,
    matchedRows,
    speciesMatched: new Set(matched.map((r) => r.speciesId)).size,
    unMatchedNames: unmatchedName.size,
    unMatchedProvinceNames: unmatchedProvince.size,
    months: monthsInfo,
    nameBridge: { file: 'data-cache/region/name-bridge.json', entries: bridge.size },
    overrides: { file: 'data/region-commonness-overrides.json', applied: ov.applied, appliedCountry: ovCountry.applied },
    stats: {
      provinces: {
        total: stats.provinces.total,
        trusted: stats.provinces.trusted,
        skippedSmall: stats.provinces.skippedSmall,
        skippedFew: stats.provinces.skippedFew,
        guardsHit: stats.provinces.guardsHit,
      },
      countries: {
        total: stats.countries.total,
        trusted: stats.countries.trusted,
        skippedSmall: stats.countries.skippedSmall,
        skippedFew: stats.countries.skippedFew,
        guardsHit: stats.countries.guardsHit,
      },
    },
  },
  coverage,
  /** 省码 → 物种 id → 档位（1 最常见 … 5 稀有） */
  tiers: bySpeciesSort(tiers),
  /** 国家码 → 物种 id → 档位（省级不可信时的降级层） */
  countryTiers: bySpeciesSort(countryTiers),
  /** 逐省诊断（留痕：为什么某省没有档位/守卫剔了多少） */
  report: {
    provinces: stats.provinceReport,
    countries: stats.countryReport,
    unmatchedProvincesTop: [...unmatchedProvince.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([k, n]) => ({ name: k, records: n })),
    overridesUnknown: [...ov.unknown, ...ovCountry.unknown].slice(0, 30),
  },
}

/**
 * 分片输出（docs/021 §2.3：单文件 > 2MB 就按国家拆分；对 Worker 也更友好——
 * 查 region=CN-11 只需加载 CN 分片，不必解析全球矩阵）。
 * 布局（`<out>` 为 .json 路径时，分片写到同名目录）：
 *   province-commonness.json          —— 索引 + 元数据（轻量：counts/provenance/不含 tiers）
 *   province-commonness/CN.json       —— { country, tiers: {speciesId: tier} }（省级）
 *   province-commonness/CN.country.json —— 国家级降级层
 */
const writeJson = async (file, obj) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(obj))
  await fs.rename(tmp, file)
  return (await fs.stat(file)).size
}

/**
 * 把 { speciesId: { code: tier } } 切成按国家分组的**两级**结构：
 *   { cc: { code: { speciesId: tier } } }
 *
 * ⚠️ 必须保留 code 这一层：同一个物种在该国的**每个省档位都不同**
 * （喜鹊 CN-11=1 / CN-62=1 / …）。早期版本把 code 层压掉（`shards[cc][speciesId] = tier`），
 * 导致同一物种的多省档位互相覆盖、只剩最后一个省的值——**静默数据丢失**，已修。
 */
function shardByCountry(tierMap) {
  /** cc → code → { speciesId: tier } */
  const shards = {}
  for (const [speciesId, codes] of Object.entries(tierMap)) {
    for (const [code, tier] of Object.entries(codes)) {
      const cc = code.includes('-') ? code.split('-')[0] : code
      const byCode = (shards[cc] ??= {})
      ;(byCode[code] ??= {})[speciesId] = tier
    }
  }
  return shards
}

const shardDir = OUT.replace(/\.json$/, '')
// 清理旧分片：国家集合/结构可能变化（曾因 tiersByCode 结构升级留下旧文件的混盘，
// 被 check:region 当场抓到——见 docs/036 实施记录）。只删本目录下的 .json，不递归。
await fs.mkdir(shardDir, { recursive: true })
for (const f of await fs.readdir(shardDir).catch(() => [])) {
  if (f.endsWith('.json')) await fs.rm(path.join(shardDir, f), { force: true })
}
const provinceShards = shardByCountry(product.tiers)
const countryShards = shardByCountry(product.countryTiers)
const shardBytes = {}
for (const [cc, byCode] of Object.entries(provinceShards)) {
  shardBytes[`${cc}.json`] = await writeJson(path.join(shardDir, `${cc}.json`), {
    schemaVersion: 1,
    country: cc,
    level: 'province',
    generatedAt: product.generatedAt,
    /** 省码 → { 物种 id: 档位 }（保留 code 层，勿压平——见 shardByCountry 注释） */
    tiersByCode: byCode,
  })
}
for (const [cc, byCode] of Object.entries(countryShards)) {
  // 国家级档位只有一层（cc 本身即 code）
  const flat = byCode[cc] ?? Object.values(byCode)[0] ?? {}
  shardBytes[`${cc}.country.json`] = await writeJson(path.join(shardDir, `${cc}.country.json`), {
    schemaVersion: 1,
    country: cc,
    level: 'country',
    generatedAt: product.generatedAt,
    tiers: flat,
  })
}
const maxShard = Math.max(0, ...Object.values(shardBytes))
const totalShardBytes = Object.values(shardBytes).reduce((a, b) => a + b, 0)

// 索引：不含 tiers（供前端/Worker 发现分片与读元数据）
const indexProduct = { ...product, tiers: undefined, countryTiers: undefined }
indexProduct.sharding = {
  dir: path.basename(shardDir),
  files: Object.keys(shardBytes).sort(),
  bytes: shardBytes,
  maxBytes: maxShard,
  totalBytes: totalShardBytes,
}
await fs.mkdir(path.dirname(OUT), { recursive: true })
const indexBytes = await writeJson(OUT, indexProduct)
console.log(`✓ province-commonness 索引：${(indexBytes / 1e6).toFixed(2)}MB → ${path.relative(ROOT, OUT)}`)
console.log(
  `  分片 ${Object.keys(shardBytes).length} 个 → ${path.relative(ROOT, shardDir)}/（合计 ${(totalShardBytes / 1e6).toFixed(2)}MB，最大单片 ${(maxShard / 1e3).toFixed(0)}KB）`,
)

const bytes = indexBytes
const MB = (bytes / 1e6).toFixed(2)
console.log(`✓ province-commonness：索引 ${MB}MB`)
console.log(
  `  来源 ${sourceInfo.kind}（${sourceInfo.file}）· 原始 ${sourceInfo.rawRows} 行 · ` +
    `匹配物种行 ${matchedRows} · 匹配物种 ${coverage.species}`,
)
console.log(
  `  省级 ${coverage.provinceCodes} 个码 · ${coverage.pairs} 组（可信省 ${stats.provinces.trusted}/${stats.provinces.total}，` +
    `小样本跳过 ${stats.provinces.skippedSmall}，可信物种不足跳过 ${stats.provinces.skippedFew}）`,
)
console.log(
  `  守卫命中：dominance ${stats.provinces.guardsHit.dominance} · spike ${stats.provinces.guardsHit.spike}` +
    `　国家层 ${coverage.countryPairs} 组（可信 ${stats.countries.trusted}/${stats.countries.total}）`,
)
console.log(`  档位分布（省）: ${JSON.stringify(coverage.tierHist)}　人工覆盖 ${ov.applied} 条`)
console.log(`  未识别省名 ${unmatchedProvince.size} 种 / 未匹配学名 ${unmatchedName.size} 个（详见产物 report）`)
const over = bytes > 2_000_000
console.log(over ? `⚠ 超过 2MB 预算（${MB}MB）——建议按国家分片` : `  体积 ${MB}MB ≤ 2MB 预算 ✓`)
if (round(bytes / 1e6, 2) > 2) process.exitCode = 3
