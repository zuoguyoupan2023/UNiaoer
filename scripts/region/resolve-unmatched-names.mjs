#!/usr/bin/env node
/**
 * 036 分类学桥接：把**未匹配**的 GBIF 记录名解析成骨架物种。
 *
 * 背景（2026-10-08 实测）：GBIF SQL 结果里的物种名可能是**旧分类组合**
 * （如 `Parus caeruleus`、`Picoides pubescens`、`Charadrius mongolus`），
 * 而我们的骨架用 AviList v2025b 的**当前**学名（`Cyanistes caeruleus`、
 * `Dryobates pubescens`、`Anarhynchus mongolus`）。直接字符串匹配会漏掉
 * 15% 左右的记录（4,725 个双名 / 其中约 3,167 个属名仍在骨架中）。
 *
 * 做法：把这些名字喂给 GBIF **v2 `POST /species/match`**（该 API 本身就是为
 * "旧名→当前接受名"设计的），拿到**整数 backbone key**，再经骨架的
 * `backboneTaxonId` 映射回 manifest 物种 id。
 *
 * 为什么不用"种加词匹配"（实测否决）：`parus caeruleus` 会同时命中
 * `Elanus caeruleus`（黑翅鸢）与 `Hydrornis caeruleus`（一种八色鸫）——
 * 属名不同的同名种加词会导致**错误归并**，宁缺毋滥。
 *
 * 产物：`data-cache/region/name-bridge.json`（gitignore；断点续跑）
 *   { "resolvedAt": …, "map": { "<原记录名>": "<manifest id>" }, "unresolved": ["…"] }
 *
 * CLI：
 *   npm run region:resolve-names                 # 从最近一次构建的 report 里取未匹配名
 *   npm run region:resolve-names -- --limit 200  # 冒烟
 *   npm run region:resolve-names -- --refresh    # 忽略缓存重跑
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, sleep } from '../lib/util.mjs'
import { parseMatchBatch } from '../taxonomy/gbif-match-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const REFRESH = !!args.refresh
const LIMIT = Number(args.limit) || Infinity
const BATCH = Math.min(100, Math.max(5, Number(args.batch) || 50))
const SLEEP_MS = Math.max(100, Number(args.sleep) || 350)

const CACHE = path.join(ROOT, 'data-cache/region/name-bridge.json')
const GBIF_MATCH = 'https://api.gbif.org/v2/species/match'
const UA = 'UNiaoer-build/0.1 (open-source non-commercial bird quiz; https://github.com/zuoguyoupan2023/UNiaoer)'

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')

// ── 待解析名单：优先取最近一次构建产物 report 里的未匹配名 ────────────
const product = await readJson(path.join(ROOT, 'public/data/province-commonness.json'))
const report = product.report || {}
/** report.unmatchedNamesTop 若存在则用它；否则从原始 SQL 反查（见下） */
let names = (report.unmatchedNamesTop || []).map((x) => String(x.name || '')).filter(Boolean)

if (!names.length) {
  // 回退：直接从最新的省级 SQL 缓存里找出"与骨架匹配不上"的名字
  const idx = await readJson(path.join(ROOT, 'public/data/species-index.json'))
  const core = await readJson(path.join(ROOT, 'public/data/manifest-core.json'))
  const globalPool = await readJson(path.join(ROOT, 'public/data/manifest-global.min.json'))
  const idByTk = new Map()
  for (const s of core.species || []) if (s.taxonKey) idByTk.set(s.taxonKey, s.id)
  for (const s of globalPool.species || []) if (s.taxonKey && !idByTk.has(s.taxonKey)) idByTk.set(s.taxonKey, s.id)
  const knownNames = new Set()
  for (const s of idx.species) if (idByTk.has(s.taxonKey)) knownNames.add(norm(s.nameSci))

  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const cands = (await fs.readdir(dir))
    .filter((f) => /^00(08688|16494|16654)/.test(f) && f.endsWith('.json'))
    .sort()
  const rows = await readJson(path.join(dir, cands[cands.length - 1]))
  const seen = new Map()
  for (const r of rows) {
    if (!r.scientificname) continue
    const k = norm(r.scientificname)
    if (!k || knownNames.has(k)) continue
    seen.set(k, (seen.get(k) || 0) + (Number(r.n) || 0))
  }
  names = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  console.log(`（report 无未匹配名清单，改从 ${cands[cands.length - 1]} 反查）`)
}
names = names.slice(0, LIMIT)
console.log(`待解析未匹配名：${names.length}`)

// ── 桥接表：整数 backbone key → manifest id ─────────────────────────
const idx = await readJson(path.join(ROOT, 'public/data/species-index.json'))
const core = await readJson(path.join(ROOT, 'public/data/manifest-core.json'))
const globalPool = await readJson(path.join(ROOT, 'public/data/manifest-global.min.json'))
const idByTk = new Map()
for (const s of core.species || []) if (s.taxonKey) idByTk.set(s.taxonKey, s.id)
for (const s of globalPool.species || []) if (s.taxonKey && !idByTk.has(s.taxonKey)) idByTk.set(s.taxonKey, s.id)
const idByBackbone = new Map()
for (const s of idx.species) {
  const id = idByTk.get(s.taxonKey)
  if (id && Number.isInteger(s.backboneTaxonId)) idByBackbone.set(s.backboneTaxonId, id)
}
console.log(`骨架 backbone key → manifest id：${idByBackbone.size} 条`)

// ── 缓存（断点续跑）──────────────────────────────────────────────────
let cache = { resolvedAt: null, map: {}, unresolved: [] }
if (!REFRESH) {
  try {
    cache = await readJson(CACHE)
  } catch {
    /* 首次 */
  }
}
const map = { ...cache.map }
const unresolved = new Set(cache.unresolved || [])
const todo = names.filter((n) => !(n in map) && !unresolved.has(n))
console.log(`缓存已有 ${Object.keys(map).length} 命中 / ${unresolved.size} 未解；本次待查 ${todo.length}`)

/**
 * 一批名字 → POST /species/match（v2 批量，按请求顺序对齐）。
 * body 契约是 `[{ scientificName }]`（**不是** `{ names: [...] }`——后者实测 HTTP 400）；
 * 响应解析复用 taxonomy 侧的 `parseMatchBatch`/`pickBackboneKey`（同口径，勿重复实现）。
 */
async function matchBatch(batch) {
  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(GBIF_MATCH, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch.map((n) => ({ scientificName: n }))),
        signal: AbortSignal.timeout(90_000),
      })
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || 10
        await sleep(ra * 1000)
        throw new Error('HTTP 429')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const results = await res.json()
      return parseMatchBatch(batch, results).byName
    } catch (e) {
      lastErr = e
      if (attempt < 3) await sleep(1500 * attempt)
    }
  }
  console.warn(`  ⚠ 批次失败：${lastErr?.message}`)
  return {}
}

const chunks = Array.from({ length: Math.ceil(todo.length / BATCH) }, (_, i) => todo.slice(i * BATCH, (i + 1) * BATCH))
let hit = 0
for (const [i, batch] of chunks.entries()) {
  const byName = await matchBatch(batch)
  for (const name of batch) {
    const key = byName[name]?.key ?? null
    const id = key != null ? idByBackbone.get(Number(key)) : null
    if (id) {
      map[name] = id
      hit++
    } else {
      unresolved.add(name)
    }
  }
  process.stdout.write(`  [${i + 1}/${chunks.length}] 命中 ${hit} / 已查 ${(i + 1) * BATCH}\r`)
  await sleep(SLEEP_MS)
}
process.stdout.write(' '.repeat(60) + '\r')

await fs.mkdir(path.dirname(CACHE), { recursive: true })
await fs.writeFile(
  CACHE,
  JSON.stringify({ resolvedAt: new Date().toISOString(), map, unresolved: [...unresolved] }),
)
console.log(`✓ 分类学桥接表 → ${path.relative(ROOT, CACHE)}`)
console.log(`  本次新增命中 ${hit} · 累计命中 ${Object.keys(map).length} · 仍未解析 ${unresolved.size}`)
console.log('  下一步：npm run region:province-commonness（构建脚本会自动读取本表）')
