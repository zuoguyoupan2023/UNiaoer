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
/**
 * 数据源 = alexander-schranz/iso-3166-2（MIT，见 config.mjs SUBDIVISION_SOURCE）。
 * 2026-10-23：本机 `cdn.jsdelivr.net` 与 `raw.githubusercontent.com` 常年超时（curl 000），
 * 故按**同一份数据**的多个 jsDelivr CNAME 依次回退（内容一致，仅 CDN 入口不同）。
 */
const BASES = [
  'https://cdn.jsdelivr.net/gh/alexander-schranz/iso-3166-2@master/subdivisions',
  'https://fastly.jsdelivr.net/gh/alexander-schranz/iso-3166-2@master/subdivisions',
  'https://gcore.jsdelivr.net/gh/alexander-schranz/iso-3166-2@master/subdivisions',
  'https://testingcf.jsdelivr.net/gh/alexander-schranz/iso-3166-2@master/subdivisions',
]
let BASE = BASES[0]

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
/**
 * 数据集补丁（2026-10-24，081 §6.1）：上游 alexander-schranz/iso-3166-2@master 的 NP 仍是
 * 2015 年前的 5 个发展大区（Madhyamanchal…），而现行 ISO 3166-2:NP 与 GBIF 记录早已是
 * **7 个省**（NP-P1..P7，宪法顺序；P1 已由「Province No. 1」改名 Koshi）。本地覆盖为现行口径，
 * 上游修复后可移除。`buildIndex` 会校验 province-to-region 的目标码存在，数据集过时会硬失败。
 */
const DATASET_OVERRIDES = {
  NP: {
    'NP-P1': 'Koshi',
    'NP-P2': 'Madhesh',
    'NP-P3': 'Bagmati',
    'NP-P4': 'Gandaki',
    'NP-P5': 'Lumbini',
    'NP-P6': 'Karnali',
    'NP-P7': 'Sudurpashchim',
  },
}
// 合并基础 = 现有 subs.json（部分国家重跑不清掉其他国；踩坑：--countries CN 曾覆盖成只剩 CN，
// 导致 build-provinces 把 12 国数据全部当 unmatched 丢弃）
try {
  const prev = JSON.parse(await fs.readFile(OUT, 'utf8'))
  Object.assign(merged, prev.subdivisions || {})
} catch {
  /* 无旧文件 */
}
/** 依次尝试各 jsDelivr CNAME（首个成功后固定用它，避免每次都重试坏入口） */
async function fetchOne(cc) {
  let lastErr = null
  for (const base of [BASE, ...BASES.filter((b) => b !== BASE)]) {
    try {
      const data = await client.getJson(`${base}/${cc.toLowerCase()}.json`, {
        cacheFile: `${cc.toLowerCase()}.json`,
        force: !!args.refresh,
      })
      if (BASE !== base) {
        console.log(`· 入口回退到 ${new URL(base).host}（${new URL(BASE).host} 不通）`)
        BASE = base
      }
      return data
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('无可用入口')
}

for (const cc of COUNTRIES) {
  try {
    merged[cc] = await fetchOne(cc)
  } catch (e) {
    failed.push(`${cc}: ${e.message}`)
  }
}

// 已知过时的国家数据就地覆盖（无论本次是否抓取——合并自旧 subs.json 的也要补丁）
const patchedOverrides = []
for (const [cc, divs] of Object.entries(DATASET_OVERRIDES)) {
  if (merged[cc] && JSON.stringify(merged[cc]) !== JSON.stringify(divs)) {
    merged[cc] = divs
    patchedOverrides.push(cc)
  }
}
if (patchedOverrides.length) console.log(`· 数据集补丁：${patchedOverrides.join(', ')}（见 DATASET_OVERRIDES）`)

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
