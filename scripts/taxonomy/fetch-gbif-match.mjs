/**
 * 023 P1-b:GBIF backbone 批量物种匹配 → data-cache/taxonomy/gbif-match/（gitignore，断点缓存）。
 * 对 species-index.json **全体**物种学名跑 GBIF v2 `POST /species/match`（50 名/批，按请求顺序对齐），
 * 产物由 `npm run species-index` 应用为 `species[].backboneTaxonId`（统一当前 backbone 键位）。
 *
 * 口径澄清（2026-10-03）：manifest/taxa.json 的 `taxonId` 是 iNaturalist taxon ID（非 GBIF 键），
 * P0 曾据此误填骨架 backboneTaxonId —— P1-b 起全量重填（见 gbif-match-lib.mjs 头注与 docs/023 §10）。
 *
 * CLI：npm run taxonomy:gbif-match [-- --refresh] [--limit N] [--batch 50] [--sleep 400]
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, sleep } from '../lib/util.mjs'
import { parseMatchBatch } from './gbif-match-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = path.join(ROOT, 'data-cache/taxonomy/gbif-match')
const API = 'https://api.gbif.org/v2/species/match'
const UA = 'UNiaoer-build/0.1 (open-source non-commercial bird quiz; https://github.com/zuoguyoupan/UNiaoer)'

const args = parseArgs(process.argv.slice(2))
const BATCH = Math.min(100, Math.max(5, Number(args.batch) || 50))
const SLEEP = Math.max(100, Number(args.sleep) || 400)
const LIMIT = Number(args.limit) || Infinity

const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
const names = index.species.map((e) => e.nameSci).sort()
console.log(`待匹配学名 ${names.length}（index ${index.species.length}）`)

await fs.mkdir(CACHE_DIR, { recursive: true })
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n))
const batches = chunk(names, BATCH)
const batchFile = (namesInBatch) =>
  path.join(CACHE_DIR, `batch-${crypto.createHash('sha1').update(JSON.stringify(namesInBatch)).digest('hex').slice(0, 10)}.json`)

async function matchBatch(titles) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(titles.map((n) => ({ scientificName: n }))),
        signal: AbortSignal.timeout(90_000),
      })
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || 10
        console.warn(`  429 限流，等 ${ra}s 重试…`)
        await sleep(ra * 1000)
        throw new Error('HTTP 429')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (String(e.message) !== 'HTTP 429' && attempt < 2) await sleep(3000 * (attempt + 1))
    }
  }
  throw lastErr
}

let done = 0
let skipped = 0
let fetched = 0
let matched = 0
const viaCount = {}
const mismatchSample = []
for (const namesInBatch of batches) {
  if (done >= LIMIT) break
  const file = batchFile(namesInBatch)
  const cached = !args.refresh && (await fs.stat(file).catch(() => null))
  let results
  if (cached) {
    skipped++
    results = JSON.parse(await fs.readFile(file, 'utf8')).results
  } else {
    const json = await matchBatch(namesInBatch)
    const { byName, mismatches } = parseMatchBatch(namesInBatch, json)
    results = namesInBatch.map((n) => byName[n])
    await fs.writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), names: namesInBatch, results }))
    fetched++
    for (const m of mismatches.slice(0, 3)) if (mismatchSample.length < 10) mismatchSample.push(m)
  }
  done++
  for (const r of results) {
    if (r.key != null) matched++
    viaCount[r.via] = (viaCount[r.via] || 0) + 1
  }
  if (fetched && done % 20 === 0) console.log(`  … ${done}/${batches.length} 批（命中 ${matched}/${done * BATCH > names.length ? names.length : done * BATCH}）`)
  if (!cached && done < batches.length) await sleep(SLEEP)
}

console.log(
  `✓ gbif-match：批次 ${batches.length}（新抓 ${fetched} · 缓存跳过 ${skipped}）· backbone 命中 ${matched}/${names.length}` +
    ` · via 分布 ${JSON.stringify(viaCount)} → ${path.relative(ROOT, CACHE_DIR)}`,
)
if (mismatchSample.length) {
  console.warn(`⚠ 正字法不一致 ${mismatchSample.length} 例（前 10，人工复核）：`)
  for (const m of mismatchSample) console.warn(`   - ${m.name} → ${m.canonicalName} (${m.key})`)
}
