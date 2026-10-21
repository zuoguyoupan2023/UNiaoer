#!/usr/bin/env node
/**
 * 科级中文名（2026-10-21）：从 Wikidata（CC0）取「科」的中文标签。
 *
 * 背景：`public/data/catalog.json` 的**目**有中文（`scripts/build-manifest-layers.mjs`
 * 里的 46 条 `ORDER_ZH`），**科**只有拉丁名 —— 全球 252 个科里，只有核心 1,299 种
 * 见过的 ~50 个科在 `src/i18n/data/family.ts` 有人工中文。用户看到「目下面一级没有中文名」。
 *
 * 做法：用 specieswiki 标题（= 拉丁科名，如 `Turdidae`）反查 Wikidata 实体，
 * 取 `zh-hans / zh-cn / zh` 标签（Wikidata 的中文标签基本是简体）。
 * 标题精确匹配 → 查不到就是 missing，不做模糊匹配（零错配）。
 *
 * 产物：`data/family-zh.json`（入库；{ latin: 中文 }）。构建期由
 * `build-manifest-layers.mjs` 的 `buildCatalog()` 读入并写进 catalog 的 `families[].zh`。
 *
 * 用法：
 *   npm run taxonomy:family-zh            # 断点续跑（按批次缓存）
 *   npm run taxonomy:family-zh -- --refresh
 *   npm run taxonomy:family-zh -- --limit 2   # 冒烟
 *
 * 许可：Wikidata contributors, CC0 1.0（https://www.wikidata.org）；来源记入 docs/024。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, sleep } from '../lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CATALOG = path.join(ROOT, 'public/data/catalog.json')
const OUT = path.join(ROOT, 'data/family-zh.json')
const CACHE_DIR = path.join(ROOT, 'data-cache/taxonomy/family-zh')
const API = 'https://www.wikidata.org/w/api.php'
const UA = 'UNiaoer-build/0.1 (open-source non-commercial bird quiz; https://github.com/zuoguyoupan/UNiaoer)'

const args = parseArgs(process.argv.slice(2))
const LIMIT = Number(args.limit) || Infinity
const REFRESH = !!args.refresh

const catalog = JSON.parse(await fs.readFile(CATALOG, 'utf8'))
const latin = [...new Set(catalog.orders.flatMap((o) => (o.families || []).map((f) => f.sci)))]
  .filter((x) => x && x !== '—')
  .sort()
console.log(`科（去重）${latin.length}`)

await fs.mkdir(CACHE_DIR, { recursive: true })
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n))
const chunkFile = (names) =>
  path.join(CACHE_DIR, `batch-${crypto.createHash('sha1').update(names.join('|')).digest('hex').slice(0, 10)}.json`)

async function fetchBatch(names) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          action: 'wbgetentities',
          format: 'json',
          formatversion: '2',
          sites: 'specieswiki',
          titles: names.join('|'),
          props: 'labels|sitelinks',
          // 必须保留 specieswiki 的 sitelink：它是「请求标题 → 实体」的唯一回映射
          sitefilter: 'specieswiki',
          languages: 'zh|zh-hans|zh-cn',
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || 10
        console.warn(`  429 限流，等 ${ra}s…`)
        await sleep(ra * 1000)
        throw new Error('HTTP 429')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await sleep(1500 * (attempt + 1))
    }
  }
  throw new Error(`Wikidata 请求失败：${lastErr?.message || lastErr}`)
}

/**
 * Wikidata 的科标签并不都以「科」结尾：有的是属名（雀鹎属）、有的只写类群名（蕉鹃）、
 * 还有少量繁体（大嘴鳥）。统一成「X科」——只做单位换算与字形转换，不换名称。
 */
const TRAD = {
  鳥: '鸟',
  鷺: '鹭',
  鶴: '鹤',
  鶇: '鸫',
  鶲: '鹟',
  鴉: '鸦',
  鷗: '鸥',
  鷹: '鹰',
  鴴: '鸻',
  鷸: '鹬',
  鵐: '鹀',
  鶯: '莺',
  鸚: '鹦',
  鵑: '鹃',
  鸌: '鹱',
  鸕: '鸬',
  鶿: '鹚',
  鷦: '鹪',
  鶥: '鹛',
  鶺: '鹡',
  鴒: '鸰',
  鵯: '鹎',
  鳩: '鸠',
  鴿: '鸽',
  鵰: '雕',
  鷲: '鹫',
  鴞: '鸮',
  鶚: '鹗',
  鶉: '鹑',
  鴣: '鸪',
  鵲: '鹊',
  鷓: '鹧',
  鸛: '鹳',
  鸝: '鹂',
  屬: '属',
}

function normalizeFamilyZh(raw) {
  let v = [...raw].map((ch) => TRAD[ch] || ch).join('').trim()
  v = v.replace(/[属族目]$/, '').trim()
  if (v && !v.endsWith('科')) v += '科'
  return v || null
}

/** 实体 → 简体中文标签（优先 zh-hans → zh-cn → zh） */
function zhLabel(entity) {
  const labels = entity?.labels || {}
  for (const k of ['zh-hans', 'zh-cn', 'zh']) {
    const raw = labels[k]?.value?.trim()
    if (raw) return normalizeFamilyZh(raw)
  }
  return null
}

const out = {}
const batches = chunk(latin, 50)
for (const [i, names] of batches.slice(0, LIMIT).entries()) {
  const file = chunkFile(names)
  let raw
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'))
    if (REFRESH) throw new Error('refresh')
  } catch {
    raw = await fetchBatch(names)
    await fs.writeFile(file, JSON.stringify(raw))
    await sleep(600)
  }
  const entities = raw.entities || {}
  const byTitle = new Map()
  for (const e of Object.values(entities)) {
    const t = e?.sitelinks?.specieswiki?.title
    if (t) byTitle.set(t, e)
  }
  let hit = 0
  for (const name of names) {
    const zh = zhLabel(byTitle.get(name))
    if (zh) {
      out[name] = zh
      hit += 1
    }
  }
  console.log(`  批次 ${i + 1}/${batches.length}：${hit}/${names.length}（累计 ${Object.keys(out).length}）`)
}

// 人工补充（Wikidata 缺标签、但 GBIF/Catalogue of Life 有中文俗名的科）
const SUP = path.join(ROOT, 'data/family-zh-supplement.json')
let supplement = {}
try {
  supplement = JSON.parse(await fs.readFile(SUP, 'utf8')).families || {}
} catch {
  /* 没有补充表也能跑 */
}
const merged = { ...supplement, ...out } // Wikidata 优先
const missing = latin.filter((x) => !merged[x])
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: 'Wikidata (specieswiki titles → zh labels) + GBIF/CoL supplement',
  license: 'CC0 1.0 / GBIF dataset licenses',
  citation:
    'Wikidata contributors, Wikidata, https://www.wikidata.org (CC0 1.0); GBIF.org species API vernacularNames (Catalogue of Life)',
  count: Object.keys(merged).length,
  wikidata: Object.keys(out).length,
  supplement: Object.keys(supplement).filter((k) => latin.includes(k)).length,
  missing,
  families: Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]])),
}
await fs.writeFile(OUT, JSON.stringify(payload, null, 1) + '\n')
console.log(`✓ ${OUT}: ${payload.count}/${latin.length}（Wikidata ${payload.wikidata} + 补充 ${payload.supplement}），未命中 ${missing.length}`)
if (missing.length) console.log('  未命中：', missing.join(', '))
