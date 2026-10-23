#!/usr/bin/env node
/**
 * P1-4B 收尾（2026-10-23）：**低覆盖国家的省名别名自动候选**。
 *
 * 背景：194 个有省级明细的国家里，82 国覆盖率 <90%（瑞典 5.4%、比利时 4.2%、肯尼亚 13%…）。
 * 原因不是 GBIF 没数据，而是 `stateProvince` 是自由文本（历史地理省 / 旧转写 / 大区名）。
 * 手工补 82 国不现实，这里做**保守的机器建议**：
 *
 *   ① 取该国 facet 里所有**未能映射**到 ISO 码的原始省名（按记录数降序）；
 *   ② 与本国 ISO 3166-2 区划名做**规范化比对**（去后缀/变音符/标点）：
 *      exact 1.0 · 包含 0.9 · 编辑距离≤2 且长度≥6 → 0.8 · 词集合相等 → 0.85；
 *   ③ **只接受「唯一最佳且领先第二名 ≥0.1」的匹配**，其余一律留给人工（不猜）；
 *   ④ 结果写 `scripts/region/aliases-auto.mjs`（提交物，输入可复查），
 *      `adapters/iso3166.mjs` 把它合并进 NAME_ALIASES（人工条目优先）。
 *
 * 安全性：别名只在 `matchSubdivision(cc, raw)` 且 `code.startsWith(cc+'-')` 时生效，
 * 跨国的同名（如格鲁吉亚 vs 美国 Georgia）不会串。
 *
 * CLI：
 *   npm run region:suggest-aliases                 # 只出报告
 *   npm run region:suggest-aliases -- --write      # 同时写 aliases-auto.mjs
 *   npm run region:suggest-aliases -- --countries SE,BE,KE --min-share 0.5
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { buildIndex, canonName, matchSubdivision, NAME_ALIASES } from './adapters/iso3166.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const WRITE = !!args.write
const MIN_SHARE = Number(args['min-share']) || 0.01
const MAX_PER_COUNTRY = Number(args['max-per-country']) || 40
const OUT_MODULE = path.join(ROOT, 'scripts/region/aliases-auto.mjs')

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const subs = (await readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json'))).subdivisions
const report = await readJson(path.join(ROOT, 'public/data/region-provinces/index.json'))
const coverage = report.coverage?.byCountry || {}

/** 编辑距离（Levenshtein，短串足够） */
function lev(a, b) {
  const m = a.length
  const n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** 规范化：去变音符、小写、去括号与行政后缀、压空白 */
function norm(s) {
  return canonName(String(s || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))
}

/**
 * 保守相似度（2026-10-23 实测收紧）：
 *   · 精确 1.0；
 *   · 一方包含另一方（短串 ≥6 字符）0.9 —— 如 "Uppland län" ⊃ "uppland"；
 *   · 词集合完全相同 0.85 —— 顺序不同；
 *   · 编辑距离 1（长度 ≥5）0.8；距离 2 只在**长度 ≥10 且首字母相同**时 0.8
 *     —— 否则 "Sevilla" 会被错配到 "Melilla"（实测踩过）。
 */
function similarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 6 && long.includes(short)) return 0.9
  const A = new Set(a.split(' ').filter(Boolean))
  const B = new Set(b.split(' ').filter(Boolean))
  if (A.size && A.size === B.size && [...A].every((x) => B.has(x))) return 0.85
  const d = lev(a, b)
  if (d === 1 && Math.max(a.length, b.length) >= 5) return 0.8
  if (d === 2 && Math.max(a.length, b.length) >= 10 && a[0] === b[0]) return 0.8
  return 0
}

/** 国家英文名（用于识别「把国名当省名」的脏数据：Nigeria / Singapore / Zambia 这类必须丢弃） */
const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
const countryNameOf = (cc) => {
  try {
    return norm(displayNames.of(cc) || '')
  } catch {
    return ''
  }
}

/** 每国 ISO 区划：规范化名 → code；code → 原始名（报告用） */
const divisionsOf = new Map()
const nameOfCode = new Map()
for (const [cc, list] of Object.entries(subs)) {
  const map = new Map()
  // 两种形态都可能：数组 [{ code, name }] 或对象 { code: name }
  const entries = Array.isArray(list)
    ? list.map((d) => [d.code, d.name])
    : Object.entries(list || {})
  for (const [code, name] of entries) {
    const n = norm(name)
    if (n && !map.has(n)) map.set(n, code)
    nameOfCode.set(code, name)
  }
  divisionsOf.set(cc, map)
}

/**
 * 结构性不匹配的国家**不自动补别名**（它们的 GBIF 一级区划与 ISO 一级区划不同级，
 * 硬映射会把"省"塞进"大区"，口径混在一起；见 docs/075 §3）：PH 省/大区、NP 旧开发区、LK 省/区。
 * 这三个留给"省/区 → 一级区划"的显式映射表。
 */
const SKIP = new Set(String(args.skip || 'PH,NP,LK').split(',').map((s) => s.trim().toUpperCase()))

const targets = String(args.countries || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

const countries = (targets.length
  ? targets
  : Object.entries(coverage)
      .filter(([, c]) => c.coverage < 0.9 && c.allRecords > 0)
      .sort((a, b) => b[1].allRecords - a[1].allRecords)
      .map(([cc]) => cc)
).filter((cc) => !SKIP.has(cc))

const index = buildIndex(subs, countries)
const out = {}
const perCountry = {}
let accepted = 0
let reviewed = 0

for (const cc of countries) {
  const cov = coverage[cc]
  if (!cov) continue
  const facet = await readJson(path.join(ROOT, `data-cache/region/gbif-coverage/${cc}.json`)).catch(() => null)
  const names = facet?.facets?.[0]?.counts || []
  const unmatched = names
    .filter(({ name }) => !matchSubdivision(index, cc, name))
    .sort((a, b) => b.count - a.count)
    .filter(({ count }) => cov.allRecords && count / cov.allRecords >= MIN_SHARE)

  const divs = divisionsOf.get(cc) || new Map()
  const rows = []
  const cname = countryNameOf(cc)
  for (const { name, count } of unmatched.slice(0, MAX_PER_COUNTRY)) {
    const key = norm(name)
    // 「国名当省名」= GBIF 里最常见的一类脏数据（Nigeria/Singapore/Zambia…）→ 绝不映射到某个省
    if (key && (key === cname || key === String(cc).toLowerCase())) continue
    const scored = [...divs.entries()]
      .map(([dn, code]) => ({ code, score: similarity(key, dn) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    const second = scored[1]
    reviewed++
    // 采纳门槛：≥0.8，且领先第二名 ≥0.15（并列一律不猜）
    const confident = best && best.score >= 0.8 && (!second || best.score - second.score >= 0.15)
    if (!confident) continue
    if (out[key] && out[key] !== best.code) continue // 跨国同名冲突 → 放弃
    out[key] = best.code
    accepted++
    rows.push(`${name} (${count})→ ${best.code} ${nameOfCode.get(best.code) ?? ''}${second ? ` [次:${second.code} ${second.score}]` : ''}`)
  }
  if (rows.length) perCountry[cc] = rows
}

console.log(`省名别名建议：扫描 ${countries.length} 国 · 候选名 ${reviewed} 个 · 采纳 ${accepted} 条`)
for (const [cc, rows] of Object.entries(perCountry)) {
  console.log(`\n${cc}（现覆盖率 ${((coverage[cc]?.coverage ?? 0) * 100).toFixed(1)}%）`)
  for (const r of rows.slice(0, 12)) console.log(`  - ${r}`)
  if (rows.length > 12) console.log(`  … 其余 ${rows.length - 12} 条`)
}

if (!accepted) {
  console.log('\n没有可自动采纳的别名（都需要人工）。')
  process.exit(0)
}

if (!WRITE) {
  console.log('\n（只出报告；加 -- --write 写入 scripts/region/aliases-auto.mjs）')
  process.exit(0)
}

const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
const body = `/**
 * ⚠️ 自动生成，勿手改（2026-10-23，命令：\`npm run region:suggest-aliases -- --write\`）。
 *
 * 来源：GBIF \`stateProvince\` 自由文本 vs ISO 3166-2 区划名的**保守相似度**匹配
 * （exact / 包含 / 编辑距离≤2 / 词集合相等），只收「唯一最佳且领先 ≥0.1」的；
 * 其余留给人工补进 \`adapters/iso3166.mjs\` 的 NAME_ALIASES（人工条目优先）。
 * 共 ${Object.keys(sorted).length} 条；每条都可用 \`npm run region:coverage\` 复核收益。
 */
export const AUTO_ALIASES = ${JSON.stringify(sorted, null, 2)}
`
await fs.writeFile(OUT_MODULE, body)
console.log(`\n✓ 已写入 ${path.relative(ROOT, OUT_MODULE)}（${Object.keys(sorted).length} 条）`)
