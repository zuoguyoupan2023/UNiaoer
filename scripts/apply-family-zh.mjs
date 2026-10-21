#!/usr/bin/env node
/**
 * 把 `data/family-zh.json` 的科中文名写进 `public/data/catalog.json`。
 *
 * 为什么单独跑：`npm run layers` 会从 `data-cache/manifest-core-full.json` 重建
 * manifest-meta / assets / catalog 三件套；只想补科名时不该动另外两件
 * （缓存台账可能比已发布产物旧/新，重建会带出无关 diff）。
 *
 * 幂等：重复运行结果一致；没有中文名的科保持拉丁名（不写 null）。
 * 注意：这是**静态产物**，不涉及 D1/R2/Worker。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = path.join(ROOT, 'public/data/catalog.json')
const MAP = path.join(ROOT, 'data/family-zh.json')

const families = JSON.parse(await fs.readFile(MAP, 'utf8')).families || {}
const raw = await fs.readFile(CATALOG, 'utf8')
const catalog = JSON.parse(raw)

let hit = 0
let total = 0
for (const order of catalog.orders) {
  for (const fam of order.families || []) {
    total += 1
    const zh = families[fam.sci]
    if (zh) {
      fam.zh = zh
      hit += 1
    } else {
      delete fam.zh
    }
  }
}

const text = JSON.stringify(catalog)
if (text === raw) {
  console.log(`✓ 无变化（${hit}/${total} 个科有中文名）`)
} else {
  const tmp = `${CATALOG}.tmp-${process.pid}`
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, CATALOG)
  console.log(`✓ 已写入 ${CATALOG}：${hit}/${total} 个科有中文名（${total - hit} 个保持拉丁名）`)
}
