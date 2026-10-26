#!/usr/bin/env node
/**
 * 更新日志数据校验（2026-10-26）
 *
 * 日志是手写的 TS 数据，最容易犯两类错：
 *  1. `date` 写成 `2026/10/26`、`26-10-2026` 或漏补零 → 页面显示乱、排序也乱；
 *  2. 新条目随手加在末尾 → 「最新在前」的约定悄悄失效。
 *
 * 这里用正则解析源文件（不引入 TS 运行时依赖），逐条校验。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = resolve(root, 'src/data/changelog.ts')
const src = readFileSync(file, 'utf8')

const errors = []

// 抓每个条目的 date 与 zh/en 标题，用来做结构性校验
const entryRe = /date:\s*'([^']*)'[\s\S]*?zh:\s*\{\s*title:\s*'([^']*)'[\s\S]*?en:\s*\{\s*title:\s*'([^']*)'/g
const entries = []
for (const m of src.matchAll(entryRe)) {
  entries.push({ date: m[1], zhTitle: m[2], enTitle: m[3] })
}

if (!entries.length) {
  errors.push('未解析到任何条目（检查 src/data/changelog.ts 的结构）')
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

for (const [i, e] of entries.entries()) {
  if (!DATE_RE.test(e.date)) {
    errors.push(`第 ${i + 1} 条 date 格式非法："${e.date}"（应为 YYYY-MM-DD）`)
    continue
  }
  const d = new Date(`${e.date}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.date) {
    errors.push(`第 ${i + 1} 条 date 不是真实日期："${e.date}"`)
  }
  if (!e.zhTitle.trim()) errors.push(`第 ${i + 1} 条缺少中文标题`)
  if (!e.enTitle.trim()) errors.push(`第 ${i + 1} 条缺少英文标题`)
}

// 倒序：新的必须在上面
for (let i = 1; i < entries.length; i++) {
  const prev = entries[i - 1].date
  const cur = entries[i].date
  if (DATE_RE.test(prev) && DATE_RE.test(cur) && cur > prev) {
    errors.push(`顺序错误：第 ${i + 1} 条（${cur}）比上一条（${prev}）更新，新条目应放在数组最前面`)
  }
}

if (errors.length) {
  console.error('❌ check:changelog 失败：')
  for (const e of errors) console.error(`   · ${e}`)
  process.exit(1)
}

console.log(`✅ check:changelog 通过（${entries.length} 条，日期格式与倒序均正确）`)
