/**
 * 021 M2：抓取 ISO 3166-2 省级清单（每国 <cc>.json = { code: name }），合并缓存。
 * 基准数据集见 config.mjs；本脚本只做获取+合并，映射逻辑在 adapters/iso3166.mjs。
 *
 * CLI：node scripts/region/fetch-subdivisions.mjs [--refresh] [--countries US,GB,...]
 * 缓存：data-cache/region/iso3166-2/subs.json（合并；断点续跑，--refresh 强制重拉）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { parseArgs } from '../lib/util.mjs'
import { SUPPORTED_COUNTRIES } from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const BASE = 'https://cdn.jsdelivr.net/gh/alexander-schranz/iso-3166-2@master/subdivisions'

const args = parseArgs(process.argv.slice(2))
const COUNTRIES = String(args.countries || SUPPORTED_COUNTRIES.join(',')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const OUT = path.join(ROOT, 'data-cache/region/iso3166-2/subs.json')

const client = createClient({
  name: 'iso3166-2',
  cacheDir: path.join(ROOT, 'data-cache/region/iso3166-2/raw'),
  qps: 5,
  timeoutMs: 60_000,
})

const merged = {}
const failed = []
// 合并基础 = 现有 subs.json（部分国家重跑不清掉其他国；踩坑：--countries CN 曾覆盖成只剩 CN，
// 导致 build-provinces 把 12 国数据全部当 unmatched 丢弃）
try {
  const prev = JSON.parse(await fs.readFile(OUT, 'utf8'))
  Object.assign(merged, prev.subdivisions || {})
} catch {
  /* 无旧文件 */
}
for (const cc of COUNTRIES) {
  try {
    const data = await client.getJson(`${BASE}/${cc.toLowerCase()}.json`, {
      cacheFile: `${cc.toLowerCase()}.json`,
      force: !!args.refresh,
    })
    merged[cc] = data
  } catch (e) {
    failed.push(`${cc}: ${e.message}`)
  }
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), subdivisions: merged }))
console.log(
  `subdivisions: ${Object.keys(merged).length}/${COUNTRIES.length} 国 → ${OUT}` +
    `（${COUNTRIES.map((c) => `${c}:${Object.keys(merged[c] || {}).length}`).join(' ')}）`,
)
if (failed.length) {
  console.error(`失败 ${failed.length} 条：\n  - ${failed.join('\n  - ')}`)
  process.exit(1)
}
