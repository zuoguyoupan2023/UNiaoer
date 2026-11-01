/**
 * 2026-11-01:从 Wikidata(CC0)批量抓取**属级**中文名 → data-cache/taxonomy/genus-zh/(gitignore,断点缓存)。
 * 用途:观鸟页统计「按属分组」此前用「成员中文名公共尾字」推导属名,单种属/区域内单种属
 * (灰喜鹊 Cyanopica、夜鹭 Nycticorax…)推导不出,只能回退学名。本脚本提供权威属名,
 * 由 `npm run species-index` 应用为 species-index.json 顶层 `genusZh` 映射(前端优先取它)。
 * 名单 = species-index.json 全部物种的属(学名首词,与前端 genusOfSci 同口径)。
 * 通路/防误配/引用与 fetch-wikidata-zh.mjs 完全一致:specieswiki 页面标题=属学名
 * (属在 specieswiki 同名成页),标题精确匹配零误配;查不到=missing,零误标。
 * 引用:Wikidata contributors, "Wikidata", https://www.wikidata.org(CC0);许可细节见 docs/024 §2.7。
 *
 * CLI:npm run taxonomy:genus-zh [-- --refresh] [--limit N] [--batch 50] [--sleep 500]
 *   --refresh 强制重抓;--limit N 只抓前 N 个待抓批次(冒烟);断点续跑:已有批次文件直接跳过。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, sleep } from '../lib/util.mjs'
import { parseEntitiesResults } from './wikidata-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = path.join(ROOT, 'data-cache/taxonomy/genus-zh')
const API = 'https://www.wikidata.org/w/api.php'
const UA = 'UNiaoer-build/0.1 (open-source non-commercial bird quiz; https://github.com/zuoguyoupan/UNiaoer)'
const LANGS = 'zh|zh-cn|zh-hans|zh-hant|zh-tw|zh-hk|zh-sg|zh-my|zh-mo'

const args = parseArgs(process.argv.slice(2))
const BATCH = Math.min(50, Math.max(5, Number(args.batch) || 50))
const SLEEP = Math.max(100, Number(args.sleep) || 500)
const LIMIT = Number(args.limit) || Infinity

const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))

// 属名单 = 全部物种学名的首词(去重;与前端 genusOfSci / 构建端 binomialName 同口径)。
// 只收合法属形态(首字母大写+纯字母),防亚种三名/杂讯混入。
const genera = [
  ...new Set(index.species.map((e) => String(e.nameSci || '').trim().split(/\s+/)[0] || '')),
]
  .filter((g) => /^[A-Z][a-z]+$/.test(g))
  .sort()
console.log(`待查属 ${genera.length}(species-index 全物种首词去重)`)

await fs.mkdir(CACHE_DIR, { recursive: true })
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n))
const batches = chunk(genera, BATCH)
const batchFile = (namesInBatch) =>
  path.join(
    CACHE_DIR,
    `batch-${crypto.createHash('sha1').update(JSON.stringify(namesInBatch)).digest('hex').slice(0, 10)}.json`,
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
        console.warn(`  429 限流,等 ${ra}s 重试…`)
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
    for (const l of Object.values(j.labels || {})) langCount[l.lang] = (langCount[l.lang] || 0) + 1
    continue
  }
  const json = await fetchEntities(titles)
  if (json?.error) throw new Error(`API error: ${json.error.info || json.error.code}`)
  const labels = parseEntitiesResults(json)
  await fs.writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), names: titles, labels }))
  fetched++
  done++
  hit += Object.keys(labels).length
  for (const l of Object.values(labels)) langCount[l.lang] = (langCount[l.lang] || 0) + 1
  console.log(`  批次 ${done}/${batches.length}:命中 ${Object.keys(labels).length}/${titles.length}`)
  if (fetched < batches.length) await sleep(SLEEP)
}

console.log(
  `✓ genus-zh:批次 ${batches.length}(新抓 ${fetched} · 缓存跳过 ${skipped})· 命中 ${hit}/${genera.length}` +
    (Object.keys(langCount).length ? ` · 语言分布 ${JSON.stringify(langCount)}` : '') +
    ` → ${path.relative(ROOT, CACHE_DIR)}`,
)
