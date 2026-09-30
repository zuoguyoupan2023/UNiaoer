#!/usr/bin/env node
/**
 * i18n 质量门禁 · check（015 i18n-5 / 010 §i18n-5）
 *
 * 比对 zh-CN 与 en 语言包：
 * - key 集合完全对齐（缺失/多余都算失败）
 * - 无空值 key（'' 或纯空白）
 * - src 中 `t('literal.key')` 用到的 key 必须在语言包中定义（动态模板串跳过）
 *
 * 命中即退出码 1。用 jiti 加载 TS 语言包（避免依赖 node 版本的 type-stripping）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

// ---- 静态 t('literal') 使用处必须存在该 key（动态模板串 t(`a.${x}`) 跳过） ----
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      yield* walk(p)
    } else if (/\.(ts|vue)$/.test(e.name) && !e.name.endsWith('.spec.ts')) {
      yield p
    }
  }
}
const used = new Map()
for (const file of walk(path.join(ROOT, 'src'))) {
  if (file.includes(`${path.sep}i18n${path.sep}locales${path.sep}`)) continue
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) {
    if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, file))
  }
}
for (const [key, file] of used) {
  if (!zhMap.has(key)) problems.push(`使用了未定义 key: ${key}（${file}）`)
}

if (problems.length) {
  console.error(`✗ i18n-check：${problems.length} 个问题`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✓ i18n-check：zh-CN 与 en 对齐（${zhMap.size} keys），无空值`)
