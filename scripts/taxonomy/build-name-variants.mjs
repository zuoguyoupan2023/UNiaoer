/**
 * 089 P0-2（繁体方案 A，构建期）：生成 L7 中文判分的**名字变体字典** →
 * `public/data/name-variants.json`。
 *
 * 两个来源（085 §2.2 / §4.1 中文卷接受集合）：
 *   · tw   —— Wikidata 港台体系名（zh-tw/zh-hk/zh-mo/zh-hant，来自 data/wikidata-zh-names.json 成品）；
 *             「不同词」的港台正式名（黑面琵鷺 ≠ 黑脸琵鹭）
 *   · trad —— 大陆 nameZh 的繁体**字形**（opencc-js cn→tw，构建期转换，前端零依赖）；
 *             「同一个词的另一种写法」（白頭鵯 = 白头鹎）
 *   trad 与 nameZh 相同（无简繁差异的字）时省略；tw 与 nameZh 相同时也省略。
 *
 * 前端消费：src/core/nameVariants.ts（懒加载一次，进程内缓存）；判分见 src/core/nameMatch.ts。
 * 体积：~5.6k 条 × 少量字段 ≈ 数百 KB（25MiB 单文件门禁无虞）。
 *
 * CLI：npm run names:variants（依赖 wikidata:names 成品；幂等）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenCC from 'opencc-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const META = path.join(ROOT, 'public/data/manifest-meta.json')
const WIKI = path.join(ROOT, 'data/wikidata-zh-names.json')
const OUT = path.join(ROOT, 'public/data/name-variants.json')

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' })

const meta = JSON.parse(await fs.readFile(META, 'utf8'))
const wiki = JSON.parse(await fs.readFile(WIKI, 'utf8'))

// 学名匹配键：trim + 压空白（index/meta 侧偶有尾随空白差异）
const sciKey = (s) => String(s || '').trim().replace(/\s+/g, ' ')
const wikiBySci = new Map(Object.entries(wiki.bySci || {}).map(([k, v]) => [sciKey(k), v]))

const bySci = {}
let twHit = 0
let tradHit = 0
let bothSame = 0
for (const sp of meta.species || []) {
  const key = sciKey(sp.nameSci)
  if (!key || !sp.nameZh) continue
  const tw = wikiBySci.get(key)?.zhTw
  const trad = s2t(sp.nameZh)
  const entry = {}
  if (tw && tw !== sp.nameZh) {
    entry.tw = tw
    twHit++
  }
  if (trad && trad !== sp.nameZh) {
    entry.trad = trad
    tradHit++
  }
  if (entry.tw || entry.trad) bySci[key] = entry
  if (entry.tw && entry.tw === entry.trad) bothSame++
}

const doc = {
  v: 1,
  generatedAt: new Date().toISOString(),
  sources: [
    'Wikidata zh-tw/zh-hk/zh-mo/zh-hant labels（CC0；data/wikidata-zh-names.json，docs/024 §2.7）',
    'opencc-js 简繁转换（构建期 cn→tw；字典数据以 opencc 项目许可发布）',
  ],
  count: Object.keys(bySci).length,
  twCount: twHit,
  tradCount: tradHit,
  bySci,
}
await fs.writeFile(OUT, JSON.stringify(doc))
console.log(
  `✓ name-variants：${doc.count} 种（港台名 ${twHit} · 繁体字形 ${tradHit} · 二者相同 ${bothSame}）` +
    ` → ${path.relative(ROOT, OUT)}（${Math.round((await fs.stat(OUT)).size / 1024)} KB）`,
)
