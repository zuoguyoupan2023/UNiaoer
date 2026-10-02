/**
 * 021 M2 试点（R-021-1）：GBIF occurrence `facet=stateProvince` 各国填写率。
 * 目的：在投入 region-provinces.json 全量构建前，量化「物种×国家」的省级字段覆盖，
 * 区分「物种不在该国」与「在但省级缺失」，据此决定默认国家清单与是否上 eBird 双源。
 *
 * CLI：node scripts/region/pilot-provinces.mjs
 *      [--countries US,AU,GB,JP,CN] [--sample 40] [--concurrency 6] [--refresh]
 * 缓存：data-cache/region/gbif-province/<CC>/<speciesId>.json（断点续跑）
 * 输出：data-cache/region/out/provinces-pilot.json（报表，不入库）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { loadEnv, mapPool, parseArgs, slug } from '../lib/util.mjs'
import { fillSummary, provinceRecords } from './adapters/gbif.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const GBIF = 'https://api.gbif.org/v1'

const args = parseArgs(process.argv.slice(2))
const COUNTRIES = String(args.countries || 'US,AU,GB,JP,CN')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const SAMPLE = Math.max(1, Number(args.sample) || 40)
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 6)

await loadEnv()

const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest.json'), 'utf8'))
const all = manifest.species || []
// 等距抽样，避免只取字母序前段（物种清单按科/名字排序会偏斜）
const step = Math.max(1, Math.floor(all.length / SAMPLE))
const species = []
for (let i = 0; i < all.length && species.length < SAMPLE; i += step) species.push(all[i])

const client = createClient({
  name: 'gbif-province',
  cacheDir: path.join(ROOT, 'data-cache/region/gbif-province'),
  qps: 5,
  timeoutMs: 90_000,
  retries: 4,
})

/** taxonomy key：优先复用 build-taxa 缓存（data-cache/gbif/<taxonId>.json），缺则 species/match */
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
  const m = await client.getJson(
    `${GBIF}/species/match?name=${encodeURIComponent(sp.nameSci)}`,
    { cacheFile: `match/${slug(sp.nameSci)}.json`, force: !!args.refresh },
  )
  return m && m.matchType !== 'NONE' ? (m.usageKey ?? null) : null
}

const failed = []
let done = 0
const tasks = COUNTRIES.flatMap((cc) => species.map((sp) => ({ cc, sp })))

const results = await mapPool(tasks, CONCURRENCY, async ({ cc, sp }) => {
  try {
    const key = await resolveUsageKey(sp)
    if (!key) return { cc, sp, present: false, provinceCount: 0, records: 0, provinceNames: [] }
    const url =
      `${GBIF}/occurrence/search?taxonKey=${key}&country=${cc}` +
      `&facet=stateProvince&facetLimit=100&limit=0&occurrenceStatus=PRESENT`
    const payload = await client.getJson(url, {
      cacheFile: `${cc}/${sp.id}.json`,
      force: !!args.refresh,
      timeout: 90_000,
    })
    const recs = provinceRecords(payload, { speciesId: sp.id, country: cc })
    if (++done % 50 === 0) console.log(`  … ${done}/${tasks.length}`)
    return {
      cc,
      sp,
      present: (payload?.count || 0) > 0,
      provinceCount: recs.length,
      records: payload?.count || 0,
      provinceNames: recs.map((r) => r.region.subnational1),
    }
  } catch (e) {
    failed.push(`${cc}/${sp.id}: ${e.message}`)
    return null
  }
})

const ok = results.filter(Boolean)
const summary = fillSummary(
  ok.map((r) => ({ country: r.cc, present: r.present, provinceCount: r.provinceCount, records: r.records })),
)
// 每国出现过的省级名去重计数（衡量行政单元覆盖广度）
const provinceUniverse = {}
for (const r of ok) {
  const set = (provinceUniverse[r.cc] ??= new Set())
  for (const n of r.provinceNames) set.add(n)
}
for (const cc of Object.keys(summary)) summary[cc].distinctProvinces = provinceUniverse[cc]?.size || 0

const out = {
  generatedAt: new Date().toISOString(),
  source: 'GBIF occurrence/search facet=stateProvince',
  method: 'presence = payload.count>0；provinceFillRate = 有 stateProvince 的物种 / 该国出现物种',
  sample: { species: species.length, countries: COUNTRIES, ofTotal: all.length },
  summary,
  failed,
}
const OUT = path.join(ROOT, 'data-cache/region/out/provinces-pilot.json')
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out, null, 2))

console.log(`\nGBIF stateProvince 试点：抽样 ${species.length} 种 × ${COUNTRIES.length} 国`)
console.log('国家  出现率  省级填率  行政单元  记录量')
for (const [cc, s] of Object.entries(summary)) {
  console.log(
    `${cc}    ${String(s.presenceRate).padStart(3)}%   ${String(s.provinceFillRate).padStart(4)}%   ` +
      `${String(s.distinctProvinces).padStart(4)}   ${s.totalRecords}`,
  )
}
if (failed.length) console.error(`\n失败 ${failed.length} 条：\n  - ${failed.slice(0, 10).join('\n  - ')}`)
console.log(`\n→ ${OUT}`)
