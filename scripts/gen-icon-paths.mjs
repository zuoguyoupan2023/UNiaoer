#!/usr/bin/env node
/**
 * 从 lucide-vue-next 提取徽章/称号用到的图标节点数据，
 * 生成 src/core/iconPaths.ts（海报 canvas 绘制每枚独特图标用，R38）。
 *
 * 用法：npm run gen:icons（badges.ts / titles.ts 新增图标后重跑一次）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICONS_DIR = path.join(ROOT, 'node_modules/lucide-vue-next/dist/esm/icons')

// 从源码里收集用到的图标名（badges.ts 与 titles.ts 的 icon: 'xxx'）
function collectUsedIcons() {
  const names = new Set()
  for (const file of ['src/core/badges.ts', 'src/core/titles.ts']) {
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    for (const m of src.matchAll(/icon: '([a-z0-9-]+)'/g)) names.add(m[1])
  }
  return [...names]
}

function extractNodes(name) {
  const file = path.join(ICONS_DIR, `${name}.js`)
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf('createLucideIcon(')
  if (start < 0) throw new Error(`${name}: createLucideIcon 未找到`)
  const arrStart = src.indexOf('[', start)
  const arrEnd = src.lastIndexOf('])')
  const literal = src.slice(arrStart, arrEnd + 1)
  // lucide 属性键未加引号（JS 字面量），构建期本地求值（受信任的包内容）
   
  return new Function(`return (${literal})`)()
}

const names = collectUsedIcons().sort()
const out = {}
for (const name of names) {
  try {
    const nodes = extractNodes(name).map(([tag, attrs]) => {
      const { key: _key, ...rest } = attrs ?? {}
      return [tag, rest]
    })
    out[name] = nodes
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`)
  }
}

const ts = `/**
 * 由 lucide-vue-next v0.577.0 图标数据生成（scripts/gen-icon-paths.mjs，R38）。
 * 供海报 canvas 绘制每枚徽章/称号的独特图标；新增图标后运行 npm run gen:icons 重新生成。
 * 手动编辑会被覆盖。
 */
export type IconNode = [string, Record<string, string>]

export const ICON_NODES: Record<string, IconNode[]> = ${JSON.stringify(out, null, 2)}
`

writeFileSync(path.join(ROOT, 'src/core/iconPaths.ts'), ts)
console.log(`✅ 已生成 ${Object.keys(out).length} 个图标：${names.join(', ')}`)
