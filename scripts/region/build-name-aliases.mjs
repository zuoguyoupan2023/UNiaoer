#!/usr/bin/env node
/**
 * P0-5 补漏（2026-10-23）：把 GBIF「物种 × 国家」矩阵里**没挂到权威层物种**的学名，
 * 解析成 `data/region-name-aliases.json`（提交物），让国家层记录数的覆盖率从 99.46% 往上走。
 *
 * ## 为什么要这一步
 * GBIF 的 occurrence 用**当时的分类**记录学名；AviList v2025b 又改了属/种。于是矩阵里有
 * 大量「GBIF 认为有效、我们的名录里没有」的旧组合名（`Carduelis chloris`、`Anas strepera`…）。
 * 直接把它们丢掉会让某些国家的记录数偏低（Carduelis chloris 一个国家就 71 万条）。
 *
 * ## 三级解析（越往后越保守，来源逐条留痕）
 *   ① `exact`        —— 学名（归一后）就是权威层物种名；
 *   ② `gbif-synonym` —— GBIF v2 批量 match 判为 SYNONYM，且**接受名**在权威层（`Carduelis chloris` → `Chloris chloris`）；
 *   ③ `epithet+family` —— GBIF 仍把旧属当有效名（`Accipiter gentilis` vs 我们的 `Astur gentilis`）：
 *      取种加词 + GBIF 分类里的科，在权威层里找**唯一**候选（同科 + 同种加词）才接受，否则放弃。
 *   都不中的（GBIF 独有分类、属/科/纲级行）**保持未匹配**——不猜。
 *
 * 数据源：GBIF v2 `POST /species/match`（匿名、批量 100 名/请求；CC0 元数据，无需 GBIF 账号）。
 * 缓存：`data-cache/region/name-alias-match.json`（gitignore，断点续跑）。
 *
 * CLI：npm run region:name-aliases [-- --refresh] [--limit N] [--dry]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs, sleep } from '../lib/util.mjs'
import { normBinomial } from './verify-provinces-lib.mjs'
import { COUNTRY_DENY } from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const API = 'https://api.gbif.org/v2/species/match'
const UA = 'UNiaoer-build/1.0 (non-commercial open-source bird quiz; https://github.com/zuoguyoupan2023/UNiaoer)'
const BATCH = 100
const LIMIT = Number(args.limit) || Infinity
const OUT = path.join(ROOT, 'data/region-name-aliases.json')
const CACHE = path.join(ROOT, 'data-cache/region/name-alias-match.json')
const SQL_GLOB = /^0009710-.*\.json$/

await loadEnv(path.join(ROOT, '.env'))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

// ── 1. 找出矩阵里所有「没挂到权威层」的学名 ──────────────────────────
const sqlDir = path.join(ROOT, 'data-cache/region/gbif-sql')
const sqlFile = (await fs.readdir(sqlDir)).filter((f) => SQL_GLOB.test(f)).sort().pop()
if (!sqlFile) throw new Error('找不到 data-cache/region/gbif-sql/0009710-*.json（物种×国家矩阵）')
const rows = await readJson(path.join(sqlDir, sqlFile))
const meta = await readJson(path.join(ROOT, 'public/data/manifest-meta.json'))
const index = await readJson(path.join(ROOT, 'public/data/species-index.json'))

const bySci = new Map() // 归一学名 → 物种 id（权威层）
for (const sp of meta.species || []) {
  const k = normBinomial(sp.nameSci)
  if (k && !bySci.has(k)) bySci.set(k, sp.id)
}
const knownIds = new Set((meta.species || []).map((sp) => sp.id))
const bridge = new Map() // 已有的桥接表（data-cache，上次 resolve-names 的成果）
try {
  const b = await readJson(path.join(ROOT, 'data-cache/region/name-bridge.json'))
  for (const [name, id] of Object.entries(b.map || {})) if (knownIds.has(id)) bridge.set(normBinomial(name), id)
} catch {
  /* 无桥接表 */
}

/** 物种 id → 科（**拉丁名**，来自骨架 species-index）与种加词，供 ③ 的 `epithet+family` 用。
 *  ⚠️ 权威层 manifest-meta 的 `family` 是**中文名**（鹰科/鸻科），与 GBIF 的拉丁科名对不上，
 *  所以科名一律从 species-index 取（taxonKey 对齐）。2026-10-23 修。 */
const familyByIdxKey = new Map()
for (const e of index.species || []) if (e.taxonKey && e.family) familyByIdxKey.set(e.taxonKey, String(e.family).toLowerCase())
const familyOf = new Map()
const epithetOf = new Map()
for (const sp of meta.species || []) {
  const e = String(sp.nameSci || '').trim().split(/\s+/)[1]?.toLowerCase()
  const fam = sp.taxonKey ? familyByIdxKey.get(sp.taxonKey) : null
  if (fam) familyOf.set(sp.id, fam)
  if (e) epithetOf.set(sp.id, e)
}
/** 同科 + 同种加词 → 候选物种 id（唯一时才可用） */
const byEpithetFamily = new Map()
for (const [id, epi] of epithetOf) {
  const fam = familyOf.get(id)
  if (!fam) continue
  const k = `${fam}|${epi}`
  if (!byEpithetFamily.has(k)) byEpithetFamily.set(k, [])
  byEpithetFamily.get(k).push(id)
}

/** 「属 种」形态判定（排除 `Corvus Linnaeus, 1758` 这类属级行与 `Aves`） */
function isBinomial(name) {
  const w = String(name || '').split(/\s+/)
  return /^[A-Z][a-z]+$/.test(w[0] || '') && /^[a-z][a-z-]+$/.test(w[1] || '')
}

const unmatched = new Map() // 原始学名 → 记录数
for (const r of rows) {
  const n = Number(r?.n) || 0
  if (n <= 0) continue
  const cc = String(r?.countrycode || '').toUpperCase()
  if (COUNTRY_DENY.has(cc)) continue
  const key = normBinomial(r?.scientificname)
  if (!key) continue
  if (bySci.has(key) || bridge.has(key)) continue
  if (!isBinomial(r?.scientificname)) continue // 属/科/纲级行：不是物种，永远不补
  unmatched.set(String(r.scientificname), (unmatched.get(String(r.scientificname)) || 0) + n)
}
const names = [...unmatched.keys()].sort()
console.log(
  `待解析双名 ${names.length} 个 / ${[...unmatched.values()].reduce((a, b) => a + b, 0).toLocaleString()} 条记录` +
    `（矩阵 ${sqlFile}）`,
)

// ── 2. GBIF v2 批量 match（缓存，断点续跑）──────────────────────────
let cache = { fetchedAt: null, results: {} }
try {
  cache = await readJson(CACHE)
} catch {
  /* 首次 */
}
if (args.refresh) cache = { fetchedAt: null, results: {} }

const missing = names.filter((n) => !cache.results[normBinomial(n)])
const batches = []
for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH))
console.log(`需要联网 match：${missing.length} 个（已缓存 ${names.length - missing.length}）→ ${batches.length} 批`)

let fetched = 0
for (const batch of batches.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)) {
  let ok = false
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((n) => ({ scientificName: n }))),
        signal: AbortSignal.timeout(90_000),
      })
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || 10
        console.warn(`  429 限流，等 ${ra}s…`)
        await sleep(ra * 1000)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const list = await res.json()
      batch.forEach((name, i) => {
        const e = list[i] || {}
        cache.results[normBinomial(name)] = {
          usage: e.usage?.canonicalName ?? null,
          accepted: e.acceptedUsage?.canonicalName ?? null,
          rank: e.usage?.rank ?? null,
          status: e.usage?.status ?? null,
          family: (e.classification || []).find((c) => c.rank === 'FAMILY')?.name ?? null,
          matchType: e.diagnostics?.matchType ?? null,
        }
      })
      ok = true
      fetched++
      if (fetched % 20 === 0) {
        await fs.writeFile(CACHE, JSON.stringify(cache))
        console.log(`  … ${fetched}/${batches.length} 批`)
      }
    } catch (e) {
      console.warn(`  批失败（${e.message}），重试…`)
      await sleep(2000 * (attempt + 1))
    }
  }
  await sleep(400)
}
cache.fetchedAt = new Date().toISOString()
await fs.mkdir(path.dirname(CACHE), { recursive: true })
await fs.writeFile(CACHE, JSON.stringify(cache))

// ── 3. 三级解析 ───────────────────────────────────────────────────
const map = {}
const stats = { gbifSynonym: 0, epithetFamily: 0, unresolved: 0 }
const unresolved = []
const viaEpithet = []
for (const name of names) {
  const key = normBinomial(name)
  if (map[key]) continue // 已解析（同归一名的多个原始写法只统计一次）
  if (bySci.has(key)) {
    map[key] = bySci.get(key)
    continue
  }
  const hit = cache.results[key]
  const accepted = hit?.accepted ? normBinomial(hit.accepted) : null
  const usage = hit?.usage ? normBinomial(hit.usage) : null
  // ② GBIF 判为同物异名，接受名在权威层
  if (hit?.status === 'SYNONYM' && accepted && bySci.has(accepted)) {
    map[key] = bySci.get(accepted)
    stats.gbifSynonym++
    continue
  }
  // ②b GBIF 把旧组合名当有效名，但接受名恰好也在权威层（少见但存在）
  if (accepted && bySci.has(accepted) && accepted !== key) {
    map[key] = bySci.get(accepted)
    stats.gbifSynonym++
    continue
  }
  // ③ 属变更：同科 + 同种加词，且唯一
  const epi = key.split(' ')[1]
  const fam = hit?.family ? String(hit.family).toLowerCase() : null
  if (fam && epi && usage === key) {
    const cands = byEpithetFamily.get(`${fam}|${epi}`) || []
    if (cands.length === 1) {
      map[key] = cands[0]
      stats.epithetFamily++
      viaEpithet.push(`${name} → ${cands[0]}`)
      continue
    }
  }
  stats.unresolved++
  unresolved.push({ name, records: unmatched.get(name) })
}

const resolvedNames = Object.keys(map).length
const resolvedRecords = names.filter((n) => map[normBinomial(n)]).reduce((a, n) => a + unmatched.get(n), 0)
console.log(
  `解析结果：${resolvedNames} 个学名 / ${resolvedRecords.toLocaleString()} 条记录` +
    `（gbif-synonym ${stats.gbifSynonym} · epithet+family ${stats.epithetFamily} · 放弃 ${stats.unresolved}）`,
)
if (viaEpithet.length) {
  console.log(`  epithet+family 抽样（请人工扫一眼）：`)
  for (const s of viaEpithet.slice(0, 15)) console.log(`    - ${s}`)
}
if (unresolved.length) {
  const top = unresolved.sort((a, b) => b.records - a.records).slice(0, 12)
  console.log(`  仍未匹配（保持未匹配，不猜）Top：`)
  for (const u of top) console.log(`    - ${u.name} (${u.records.toLocaleString()})`)
}

if (args.dry) {
  console.log('（--dry：未写产物）')
  process.exit(0)
}

// ── 4. 写提交物（带来源与统计，便于复查）───────────────────────────
const sortedMap = Object.fromEntries(Object.entries(map).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    '把 GBIF「物种×国家」矩阵里未挂到权威层的**旧组合名/异名**解析到权威层物种 id。' +
    '三级：① 归一学名直接命中；② GBIF v2 species/match 判 SYNONYM → 接受名在权威层；' +
    '③ 属变更（GBIF 仍用旧属）→ 同科 + 同种加词**唯一**候选才接受（否则放弃）。' +
    '属/科/纲级行（Aves、Corvus、Laridae）与 GBIF 独有分类**保持未匹配**，不猜。',
  source: {
    key: 'gbif-species-match-v2',
    name: 'GBIF species match API (v2, bulk)',
    url: 'https://techdocs.gbif.org/en/openapi/v2/species',
    license: 'CC0（GBIF 分类元数据）',
    attribution: 'GBIF Backbone Taxonomy — https://www.gbif.org/ (CC0)',
  },
  matrixFile: sqlFile,
  counts: { names: resolvedNames, records: resolvedRecords, ...stats },
  /** 归一学名 → 权威层物种 id */
  map: sortedMap,
}
await fs.writeFile(OUT, JSON.stringify(out))
console.log(`✓ 名称别名表：${resolvedNames} 条 → ${path.relative(ROOT, OUT)}`)
