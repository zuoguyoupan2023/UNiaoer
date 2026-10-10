/**
 * 050 P3：GBIF usageKey 缓存读取（`data-cache/taxonomy/gbif-match/`）。
 *
 * ## 背景：为什么需要它
 * 全球层的 9,545 种原本**没有 `taxonId`**（采集台账里全是 null），因此：
 *   - 季节层 `seasonality.json`、省级层 `region-provinces.json` 只能覆盖核心库 1,299 种；
 *   - `build-seasonality` / `build-provinces` 只能退化成运行时 `species/match` 现场匹配（慢且不稳）。
 *
 * 023 P1-b 那次 `taxonomy:gbif-match` 已经把 **10,892 条学名 → GBIF key** 落盘缓存
 * （gitignore，断点续跑），当时只是写进骨架的 `backboneTaxonId`。这里直接复用它，
 * **不需要联网**，也**不改核心库**的 taxonId（050 P3 只回填全球种）。
 *
 * ## 注意：核心库的 taxonId 是"历史键"，不是当前 GBIF usageKey
 * 实测：`Pycnonotus sinensis` 核心库 `taxonId=14621`，GBIF 已 404（occurrence 0 条），
 * 现行有效 key 是 `2486150`。所以两个来源的语义并不一致 —— 回填时**不要**互相覆盖，
 * 核心库的修正另立任务（P3b），避免一次性改动既有地区产物。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = path.join(ROOT, 'data-cache/taxonomy/gbif-match')

/**
 * 读取缓存 → `Map<nameSci, gbifKey>`。
 * 每个 batch 文件形如 `{ fetchedAt, names: string[], results: [{ key, via }] }`，
 * `names[i]` 与 `results[i]` **按位置对应**（实测：元素里没有 `i` 索引字段，
 * 早先按 `r.i` 取名会静默返回空 Map —— 已踩过这个坑）。
 * 缓存缺失（未跑过 `npm run taxonomy:gbif-match`）返回空 Map —— 调用方按"无 key"处理，不报错。
 */
export async function loadGbifUsageKeys() {
  const map = new Map()
  let files
  try {
    files = await fs.readdir(CACHE_DIR)
  } catch {
    return map
  }
  for (const f of files.filter((n) => n.endsWith('.json'))) {
    try {
      const doc = JSON.parse(await fs.readFile(path.join(CACHE_DIR, f), 'utf8'))
      const names = doc.names || []
      const results = doc.results || []
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const name = names[i] ?? (r && r.name)
        if (name && r && r.key != null && r.key !== 0) map.set(name, r.key)
      }
    } catch {
      /* 损坏的 batch 跳过：缓存是加速器，不是真源 */
    }
  }
  return map
}