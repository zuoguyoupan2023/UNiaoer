/**
 * 022 §2.6：抓 eBird 热点名录 + subnational1 区划，缓存到 data-cache/region/ebird/（gitignore）。
 * 供 `build-hotspots --ebird-names` 离线使用；非商业，需署名（docs/022 §2.5）。
 *
 * CLI：npm run region:ebird -- [--countries CN,US] [--refresh]
 *   --countries 缺省 = SUPPORTED_COUNTRIES
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { loadEnv, mapPool, parseArgs } from '../lib/util.mjs'
import { SUPPORTED_COUNTRIES } from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const API = 'https://api.ebird.org/v2'
const args = parseArgs(process.argv.slice(2))

await loadEnv(path.join(ROOT, '.env'))
const key = process.env.EBIRD_API_KEY
if (!key) throw new Error('缺少 EBIRD_API_KEY（见 .env.example；https://ebird.org/api/keygen）')

const countries = args.countries
  ? String(args.countries).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : SUPPORTED_COUNTRIES
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 2)

const client = createClient({
  name: 'ebird',
  cacheDir: path.join(ROOT, 'data-cache/region/ebird'),
  qps: 1,
  timeoutMs: 60_000,
  retries: 3,
  headers: { 'x-ebirdapitoken': key },
})

const failed = []
const rows = await mapPool(countries, CONCURRENCY, async (cc) => {
  try {
    const hotspots = await client.getJson(`${API}/ref/hotspot/${cc}?fmt=json`, {
      cacheFile: `hotspot-${cc}.json`,
      force: !!args.refresh,
    })
    const subs = await client.getJson(`${API}/ref/region/list/subnational1/${cc}`, {
      cacheFile: `subnational1-${cc}.json`,
      force: !!args.refresh,
    })
    return { cc, hotspots: Array.isArray(hotspots) ? hotspots.length : 0, subs: Array.isArray(subs) ? subs.length : 0 }
  } catch (e) {
    failed.push(`${cc}: ${e.message}`)
    return { cc, hotspots: 0, subs: 0 }
  }
})

await fs.mkdir(path.join(ROOT, 'data-cache/region/ebird'), { recursive: true })
const total = rows.reduce((s, r) => s + r.hotspots, 0)
console.log(`region:ebird：${countries.length} 国 → 热点 ${total} 个`)
for (const r of rows) console.log(`  ${r.cc}: hotspot ${r.hotspots} · subnational1 ${r.subs}`)
if (failed.length) {
  console.error(`失败 ${failed.length} 国（可 --refresh 重跑续传）：\n  - ${failed.join('\n  - ')}`)
  process.exitCode = 1
}
