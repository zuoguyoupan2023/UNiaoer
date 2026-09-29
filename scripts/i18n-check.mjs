#!/usr/bin/env node
/**
 * i18n 质量门禁 · check（015 i18n-5 / 010 §i18n-5）
 *
 * 比对 zh-CN 与 en 语言包：
 * - key 集合完全对齐（缺失/多余都算失败）
 * - 无空值 key（'' 或纯空白）
 *
 * 命中即退出码 1。用 jiti 加载 TS 语言包（避免依赖 node 版本的 type-stripping）。
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)

const zh = (await jiti.import('../src/i18n/locales/zh-CN.ts')).default
const en = (await jiti.import('../src/i18n/locales/en.ts')).default

/** 展开为点分 key → 值（叶子必须都是字符串） */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}

const zhMap = flatten(zh)
const enMap = flatten(en)

const problems = []

for (const [k, v] of zhMap) {
  if (!enMap.has(k)) problems.push(`en 缺少 key: ${k}`)
  else if (typeof v === 'string' && !v.trim()) problems.push(`zh-CN 空值: ${k}`)
  else if (typeof enMap.get(k) === 'string' && !enMap.get(k).trim()) problems.push(`en 空值: ${k}`)
}
for (const k of enMap.keys()) {
  if (!zhMap.has(k)) problems.push(`en 多出 key: ${k}`)
}

if (problems.length) {
  console.error(`✗ i18n-check：${problems.length} 个问题`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✓ i18n-check：zh-CN 与 en 对齐（${zhMap.size} keys），无空值`)
