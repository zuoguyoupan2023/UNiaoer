#!/usr/bin/env node
/**
 * 051 S2：`npm run check:class` —— 生活型六分法记录台账的校验。
 *
 * 核心原则（用户 2026-10-10）：**没有出处的类群不生效；查不到就留空，宁可空着也不显示错误信息。**
 * 因此本脚本检查的是"台账是否干净"，而不是"覆盖是否够"：
 *
 *  A 记录结构：familySci/orderSci 至少有一个；groups 非空且都是六值之一
 *  B **出处必填**：source.type 合法，且 ref 或 url 至少有一个 → 否则该记录不生效（判失败）
 *  C status 只允许 ok / disputed；disputed 不参与渲染
 *  D 六值枚举与 `data/class-records.json` 的 `values` 一致
 *  E 键冲突：同一 familySci（或 orderSci）出现多条 **且都是 ok** → 判失败（需人工合并）
 *  F 覆盖度：只**告警**不失败（台账本就是空的，等逐条积累）；
 *    若某条记录引用的科/目在权威层里一个种都没有，提示"可能是拼写错误"
 *
 * 用法：node scripts/check-class.mjs [--report]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GROUP6,
  SOURCE_TYPES,
  buildClassTable,
  checkRecord,
  resolveGroup6,
} from './lib/class-taxonomy.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = process.argv.includes('--report')

let failed = 0
const fail = (m) => {
  failed++
  console.error(`✗ ${m}`)
}
const warn = (m) => console.warn(`⚠ ${m}`)

// ── D 六值枚举一致性 ──────────────────────────────────────────
const doc = JSON.parse(await fs.readFile(path.join(ROOT, 'data/class-records.json'), 'utf8'))
const declared = Object.keys(doc.values || {})
if (declared.length !== GROUP6.length || declared.some((k) => !GROUP6.includes(k))) {
  fail(`class-records.json 的 values(${declared.join(',')}) 与 lib/class-taxonomy.mjs 的六值不一致`)
}

// ── A/B/C 逐条校验 ──────────────────────────────────────────
const records = (doc.records || []).filter((r) => !Object.keys(r).some((k) => k.startsWith('_')))
let live = 0
let disputed = 0
records.forEach((r, i) => {
  const { issues, live: isLive } = checkRecord(r)
  const tag = `${r.speciesSci || r.familySci || r.orderSci || `#${i}`}`
  if (issues.length) fail(`记录 ${tag}：${issues.join('；')}`)
  if (isLive) live++
  if (r.status === 'disputed') disputed++
})

// ── E 键冲突（同一科/目多条都是 ok）────────────────────────
for (const key of ['speciesSci', 'familySci', 'orderSci']) {
  const seen = new Map()
  for (const r of records) {
    if (!r[key] || r.status === 'disputed') continue
    const { live: isLive } = checkRecord(r)
    if (!isLive) continue
    seen.set(r[key], (seen.get(r[key]) || 0) + 1)
  }
  for (const [k, n] of seen) {
    if (n > 1) fail(`${key}=${k} 有 ${n} 条生效记录，需人工合并（避免展示时顺序不定）`)
  }
}

// ── F 覆盖度（只告警）──────────────────────────────────────
const table = buildClassTable(records)
let covered = 0
let unmatchedKeys = []
try {
  const meta = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest-meta.json'), 'utf8'))
  const withClass = meta.species.filter((s) =>
    resolveGroup6(table, { speciesSci: s.nameSci, familySci: s.family, orderSci: s.order }),
  )
  covered = withClass.length
  const sciSet = new Set(meta.species.map((s) => s.nameSci).filter(Boolean))
  const famSet = new Set(meta.species.map((s) => s.family).filter(Boolean))
  const ordSet = new Set(meta.species.map((s) => s.order).filter(Boolean))
  unmatchedKeys = records
    .filter((r) => checkRecord(r).live)
    .filter(
      (r) =>
        (r.speciesSci && !sciSet.has(r.speciesSci)) ||
        (r.familySci && !famSet.has(r.familySci)) ||
        (r.orderSci && !ordSet.has(r.orderSci)),
    )
    .map((r) => r.speciesSci || r.familySci || r.orderSci)
} catch {
  warn('未找到 manifest-meta.json，跳过覆盖度检查（先跑 npm run layers）')
}

console.log('· 生活型台账 data/class-records.json')
console.log(`  记录 ${records.length} 条 · 生效 ${live} · 被质疑 ${disputed}`)
console.log(
  `  覆盖 ${covered} / ${(covered ? '' : '')}${covered === 0 ? '0 种（台账为空，所有物种都不显示类群——这是预期状态）' : ''}`,
)
console.log(`  声明的六值：${GROUP6.join(' / ')}（出处类型：${SOURCE_TYPES.join(' / ')}）`)

if (REPORT || covered === 0) {
  console.log('\n· 说明（为什么覆盖是 0 也不算失败）')
  console.log('  六分法是**习惯分类**，没有权威标准可查；本台账采取"有出处才生效"的策略。')
  console.log('  初始为空是刻意的（用户 2026-10-10：「宁愿空着」），后续由：')
  console.log('    ① 逐条录入指定手册的类群划分；或 ② 社区投稿/挑错（见 docs/051 §2.2 R8）')
  console.log('  来积累。任何时候 `profile.group6` 缺失都只是"没有依据"，UI 不显示，不视为缺陷。')
}
if (unmatchedKeys.length) {
  warn(`以下记录引用的科/目在权威层里找不到对应物种（可能是拼写错误）：${unmatchedKeys.join(', ')}`)
}

if (failed) {
  console.error(`\n✗ check:class：${failed} 项未通过`)
  process.exit(1)
}
console.log('\n✓ check:class：台账结构 / 出处必填 / 枚举 / 键唯一性全部通过')