/**
 * 023 P1-a:从 Wikidata(CC0)批量抓取中文名 → data-cache/taxonomy/wikidata-zh/（gitignore，断点缓存）。
 * 查询范围 = species-index.json 中「概念中文名无法从 manifest 精确学名获得」的物种
 * （即排除 bank 内有 curated nameZh 的同学名物种；概念合并物种不蹭别名中文名，走本查询）。
 * 结果由 `npm run species-index` 应用到 species-index.json（curated 优先于 wikidata）。
 *
 * 通路：Action API `wbgetentities`（www.wikidata.org，可达性好）——借 specieswiki 页面标题=学名
 * 反查实体（标题精确匹配，查不到=missing，零误配；redirect 会以目标页标题回 key，自然 miss 不误标）。
 * 备用通路：WDQS SPARQL（query.wikidata.org，部分网络不可达；纯函数已备于 wikidata-lib）。
 * 引用：Wikidata contributors, "Wikidata", https://www.wikidata.org（CC0）；许可细节见 docs/024 §2.7。
 *
 * CLI：npm run taxonomy:wikidata-zh [-- --refresh] [--limit N] [--batch 50] [--sleep 500]
 *   --refresh 强制重抓；--limit N 只抓前 N 个待抓批次（冒烟）；断点续跑：已有批次文件直接跳过。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, sleep } from '../lib/util.mjs'
import { parseEntitiesResults } from './wikidata-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = path.join(ROOT, 'data-cache/taxonomy/wikidata-zh')
const API = 'https://www.wikidata.org/w/api.php'
const UA = 'UNiaoer-build/0.1 (open-source non-commercial bird quiz; https://github.com/zuoguyoupan/UNiaoer)'
const LANGS = 'zh|zh-cn|zh-hans|zh-hant|zh-tw|zh-hk|zh-sg|zh-my|zh-mo'

const args = parseArgs(process.argv.slice(2))
const BATCH = Math.min(50, Math.max(5, Number(args.batch) || 50))
const SLEEP = Math.max(100, Number(args.sleep) || 500)
const LIMIT = Number(args.limit) || Infinity

const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))

// 089 前置（2026-10-24）：名单 = **全量** index 学名——curated 物种已有简体中文名，
// 但 L7 繁体判分需要它们的**港台名**（nameZhTw），故一并抓取（zh 主名照常取，不影响下游；
// 下游 build-species-index 的 curated 优先级在消费侧处理，与抓取无关）。
const names = [...new Set(index.species.map((e) => e.nameSci))].sort()
console.log(`待查学名 ${names.length}（species-index 全量）`)

await fs.mkdir(CACHE_DIR, { recursive: true })
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n))
const batches = chunk(names, BATCH)
// 089 前置：缓存格式 v2（条目新增 zhTw/zhTwLang）——与旧 batch-*.json 并存但互不识别，旧文件自然作废
const batchFile = (namesInBatch) =>
  path.join(
    CACHE_DIR,
    `batch2-${crypto.createHash('sha1').update(JSON.stringify(namesInBatch)).digest('hex').slice(0, 10)}.json`,
  )

async function fetchEntities(titles) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'wbgetentities',
          format: 'json',
          formatversion: '2',
          sites: 'specieswiki',
          titles: titles.join('|'),
          props: 'labels|sitelinks',
          sitefilter: 'specieswiki',
          languages: LANGS,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || 10
        console.warn(`  429 限流，等 ${ra}s 重试…`)
        await sleep(ra * 1000)
        throw new Error('HTTP 429')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (String(e.message) !== 'HTTP 429' && attempt < 2) await sleep(3000 * (attempt + 1))
    }
  }
  throw lastErr
}

let done = 0
let skipped = 0
let fetched = 0
let hit = 0
let zhTwHit = 0
let zhTwDiff = 0 // 词形不同于主名（含纯字形差异与真·港台异名；后者待 OpenCC 方案 A 区分）
const langCount = {}
for (const titles of batches) {
  if (done >= LIMIT) break
  const file = batchFile(titles)
  const cached = !args.refresh && (await fs.stat(file).catch(() => null))
  if (cached) {
    skipped++
    done++
    const j = JSON.parse(await fs.readFile(file, 'utf8'))
    hit += Object.keys(j.labels || {}).length
    for (const l of Object.values(j.labels || {})) {
      langCount[l.lang] = (langCount[l.lang] || 0) + 1
      if (l.zhTw) {
        zhTwHit++
        if (l.zhTw !== l.zh) zhTwDiff++
      }
    }
    continue
  }
  const json = await fetchEntities(titles)
  if (json?.error) throw new Error(`API error: ${json.error.info || json.error.code}`)
  const labels = parseEntitiesResults(json)
  await fs.writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), names: titles, labels }))
  fetched++
  done++
  hit += Object.keys(labels).length
  for (const l of Object.values(labels)) {
    langCount[l.lang] = (langCount[l.lang] || 0) + 1
    if (l.zhTw) {
      zhTwHit++
      if (l.zhTw !== l.zh) zhTwDiff++
    }
  }
  console.log(`  批次 ${done}/${batches.length}：命中 ${Object.keys(labels).length}/${titles.length}`)
  if (fetched < batches.length) await sleep(SLEEP)
}

console.log(
  `✓ wikidata-zh：批次 ${batches.length}（新抓 ${fetched} · 缓存跳过 ${skipped}）· 命中 ${hit}/${names.length}` +
    (Object.keys(langCount).length ? ` · 语言分布 ${JSON.stringify(langCount)}` : '') +
    ` → ${path.relative(ROOT, CACHE_DIR)}`,
)
console.log(
  `  港台名（zhTw）：命中 ${zhTwHit}/${hit}` +
    ` · 与主名词形不同 ${zhTwDiff}（含纯字形差异；真·港台异名数待 OpenCC 方案 A 落地后统计）`,
)
