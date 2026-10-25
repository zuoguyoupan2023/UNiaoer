/**
 * 089 P0-1b：把 Wikidata 中文名断点缓存**固化成仓库成品**（`data/wikidata-zh-names.json`）。
 *
 * 为什么：缓存目录 data-cache/ 是 gitignore 的、随时可能被清（--refresh/换机/手动清理）；
 * L7 集成（判分字典、将来 bank/manifest 注入 nameZhTw）需要稳定数据源。成品进 git，
 * 带 CC0 引用留痕（docs/024 §2.7）。
 *
 * 输入：data-cache/taxonomy/wikidata-zh/batch2-*.json（v2 缓存，含 zhTw）
 * 输出：data/wikidata-zh-names.json
 *   { schemaVersion, generatedAt, source, license, count, bySci: { 学名: { zh, lang, item, zhTw?, zhTwLang? } } }
 *
 * CLI：node scripts/taxonomy/build-wikidata-names.mjs（幂等，重跑合并最新缓存）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = path.join(ROOT, 'data-cache/taxonomy/wikidata-zh')
const OUT = path.join(ROOT, 'data/wikidata-zh-names.json')

const files = (await fs.readdir(CACHE_DIR)).filter((f) => f.startsWith('batch2-') && f.endsWith('.json'))
if (!files.length) {
  console.error('没有 v2 缓存（batch2-*.json）——先跑 npm run taxonomy:wikidata-zh')
  process.exit(1)
}

const bySci = {}
let zhTwCount = 0
let latest = 0
for (const f of files) {
  const j = JSON.parse(await fs.readFile(path.join(CACHE_DIR, f), 'utf8'))
  latest = Math.max(latest, Date.parse(j.fetchedAt || '') || 0)
  for (const [sci, e] of Object.entries(j.labels || {})) {
    // 同名跨批次理论上不出现（名单去重）；出现时保留 zhTw 更全的一条
    const prev = bySci[sci]
    if (!prev || (!prev.zhTw && e.zhTw)) bySci[sci] = e
  }
}
for (const e of Object.values(bySci)) if (e.zhTw) zhTwCount++

const doc = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: 'Wikidata (wbgetentities via specieswiki titles; contributors "Wikidata", wikidata.org)',
  license: 'CC0 1.0（https://creativecommons.org/publicdomain/zero/1.0/）；许可登记见 docs/024 §2.7',
  count: Object.keys(bySci).length,
  zhTwCount,
  bySci,
}
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(doc))
console.log(
  `✓ wikidata-zh-names：${doc.count} 学名（含港台名 ${zhTwCount}）→ ${path.relative(ROOT, OUT)}（${Math.round((await fs.stat(OUT)).size / 1024)} KB）`,
)
