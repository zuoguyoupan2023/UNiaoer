#!/usr/bin/env node
/**
 * P0-5（Tier A，2026-10-23）：**国家层记录数** → `public/data/region-records/`。
 *
 * ⚠️ 口径先说清楚（2026-10-23 用户纠正）：这里的「国家」是 **GBIF 的 `countrycode`**，
 * 也就是 **ISO 3166-1 alpha-2 的 249 个码**——它包含**属地与特殊领地**，不等于「主权国家数」：
 *   · 193 个联合国会员国 + 2 个观察员（VA / PS）；
 *   · 台湾（TW，按铁律 6 显示为「中国台湾」）与南极洲（AQ）；
 *   · 约 50 个属地/特殊领地（HK/MO、格陵兰 GL、法属圭亚那 GF、圣诞岛 CX、布韦岛 BV、南乔治亚 GS…）。
 * 所以对外表述一律写「**249 个国家/地区（码）**」，**不要写「249 国」**。
 *
 * 为什么要有这一层（docs/075 §6.1）：
 *   观鸟页此前只有 29 国（`SUPPORTED_COUNTRIES`）能按「记录数」排序——不是 GBIF 缺数据，
 *   而是省级层只做了这 29 国。国家层（物种 × 国家）**早就有现成的 GBIF SQL 矩阵缓存**，
 *   我们一直没用来出数字。本脚本把它变成按国分片的轻量产物，让全部 249 个国家/地区都有「记录数」。
 *
 * 数据源（**零新下载**）：
 *   `data-cache/region/gbif-sql/0009710-260928105237408.json`
 *   —— GBIF SQL Download API 结果，`{ scientificname, countrycode, n }`，343,741 行 / 252 国 / 23.6 亿条；
 *   DOI `10.15468/dl.scmsur`（`docs/024` §2.2 已登记）。
 *
 * 口径（与省级层**刻意不同**，UI 必须说明，docs/075 §6.3）：
 *   · 国家层 = **该国全部记录数**（含未被归属到省份的记录）；
 *   · 省级层 = **只计能映射到 ISO 省名的记录**（DE 这类填充率低的国家会系统性偏低）；
 *   → 两层数字天然不等，**不可互相加总，也不跨地区比大小**。
 *
 * 处理链：
 *   学名归一（`normBinomial`，亚种归并到种）→ 骨架短码 → 权威层 id
 *   → 未命中再查 `name-bridge.json`（旧分类组合名 → id）
 *   → 丢弃非种级名（`Aves` / `Corvus` 这类属/纲级行，宁可没有数字）
 *   → 孤证地板 `n >= 2`（docs/036 §10）
 *   → 按国分片。
 *
 * CLI：
 *   npm run region:records                         # 默认写 public/data/region-records/
 *   npm run region:records -- --sql <file>         # 指定 SQL 结果
 *   npm run region:records -- --min 2 --out <dir>  # 门槛 / 输出目录
 *   npm run region:records -- --dry                # 只打印统计，不写文件
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { normBinomial } from './verify-provinces-lib.mjs'
import { COUNTRY_DENY, GBIF_SQL_SOURCE } from './config.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const MIN = Math.max(1, Number(args.min) || 2)
const DRY = !!args.dry
const OUT_DIR = args.out ? path.resolve(ROOT, args.out) : path.join(ROOT, 'public/data/region-records')

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
const writeJson = async (file, obj) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const text = JSON.stringify(obj)
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, file)
  return Buffer.byteLength(text)
}

// ── 输入：SQL 矩阵 ────────────────────────────────────────────────
async function pickSqlFile() {
  if (args.sql) return path.resolve(ROOT, args.sql)
  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^0009710-.*\.json$/.test(f))
  if (!files.length) {
    throw new Error(
      '找不到 GBIF 物种×国家矩阵（data-cache/region/gbif-sql/0009710-*.json）。\n' +
        '  获取方式：npm run region:gbif-sql -- --sql "<docs/024 §2.2 的查询>"（需 GBIF 账号）',
    )
  }
  // 取最新一份（文件名前缀是下载 key，时间戳在尾部）
  files.sort()
  return path.join(dir, files[files.length - 1])
}

const sqlFile = await pickSqlFile()
const rows = await readJson(sqlFile)
const meta = await readJson(path.join(ROOT, 'public/data/manifest-meta.json'))

// ── 物种匹配：学名 → 权威层 id ────────────────────────────────────
const bySci = new Map()
for (const sp of meta.species || []) {
  const k = normBinomial(sp.nameSci)
  if (k && !bySci.has(k)) bySci.set(k, sp.id)
}
const knownIds = new Set((meta.species || []).map((sp) => sp.id))
/** 旧分类组合名 → id（`Carduelis chloris` → `chloris-chloris` 之类；由 region:resolve-names 生成） */
const bridge = new Map()
let bridgeEntries = 0
try {
  const b = await readJson(path.join(ROOT, 'data-cache/region/name-bridge.json'))
  for (const [name, id] of Object.entries(b.map || {})) {
    if (!knownIds.has(id)) continue
    bridge.set(normBinomial(name), id)
    bridgeEntries++
  }
} catch {
  /* 无桥接表：覆盖略低，流程照常 */
}

const byCountry = {} // cc → { speciesId: n }
const rawTotals = {} // cc → 该行全部记录数（含未匹配到物种的行）
const unmatchedNames = new Map() // 学名 → 记录数（未匹配）
let viaBridge = 0
let viaBridgeRecords = 0

for (const r of rows) {
  const n = Number(r?.n) || 0
  if (n <= 0) continue
  const cc = String(r?.countrycode || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) continue
  rawTotals[cc] = (rawTotals[cc] || 0) + n
  if (COUNTRY_DENY.has(cc)) continue // 铁律 6：ZZ/XK/XZ 不作为独立国家呈现
  const key = normBinomial(r?.scientificname)
  if (!key) continue
  let id = bySci.get(key)
  if (!id) {
    const bridged = bridge.get(key)
    if (bridged) {
      id = bridged
      viaBridge++
      viaBridgeRecords += n
    }
  }
  if (!id) {
    unmatchedNames.set(String(r?.scientificname || ''), (unmatchedNames.get(String(r?.scientificname || '')) || 0) + n)
    continue
  }
  const map = (byCountry[cc] ??= {})
  map[id] = (map[id] || 0) + n
}

// ── 孤证地板 + 分片 ───────────────────────────────────────────────
const shards = {} // cc → { bySpecies, count, species }
let pairs = 0
let dropped = 0
let mappedRecords = 0
for (const [cc, map] of Object.entries(byCountry)) {
  const kept = {}
  let count = 0
  for (const [id, n] of Object.entries(map)) {
    if (n < MIN) {
      dropped++
      continue
    }
    kept[id] = n
    count += n
    pairs++
  }
  if (!Object.keys(kept).length) continue
  // 按学名（id）排序，保证产物确定性（diff 友好）
  const bySpecies = Object.fromEntries(Object.entries(kept).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  shards[cc] = { bySpecies, count, species: Object.keys(kept).length }
  mappedRecords += count
}

const countries = Object.keys(shards).sort()
const totalRaw = Object.values(rawTotals).reduce((a, b) => a + b, 0)
const matchedCoverage = totalRaw ? mappedRecords / totalRaw : 0
console.log(`region-records：${path.relative(ROOT, sqlFile)}`)
console.log(`  SQL ${rows.length.toLocaleString()} 行 / ${Object.keys(rawTotals).length} 国 / ${totalRaw.toLocaleString()} 条记录`)
console.log(
  `  匹配：${pairs.toLocaleString()} 个 (地区码, 种) 对（n>=${MIN}，丢弃孤证 ${dropped}）/ ` +
    `${countries.length} 个国家/地区 / ${(matchedCoverage * 100).toFixed(2)}% 的记录挂到了权威层物种` +
    (viaBridge ? `（其中 name-bridge 补 ${viaBridge} 行 / ${viaBridgeRecords.toLocaleString()} 条）` : ''),
)
if (unmatchedNames.size) {
  const top = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  const lost = [...unmatchedNames.values()].reduce((a, b) => a + b, 0)
  console.log(
    `  未匹配 ${unmatchedNames.size} 个学名 / ${lost.toLocaleString()} 条（${((lost / totalRaw) * 100).toFixed(2)}%）：` +
      '多为属/纲级行（Aves、Corvus）与名录尚未收录的拆分种，已丢弃，不臆造',
  )
  for (const [name, n] of top) console.log(`    - ${name} (${n.toLocaleString()})`)
}

if (DRY) {
  console.log('（--dry：未写任何文件）')
  process.exit(0)
}

// ── 写分片 + 索引 ─────────────────────────────────────────────────
const shardDir = path.join(OUT_DIR)
const shardBytes = {}
const shardTotals = {}
for (const cc of countries) {
  const { bySpecies, count, species } = shards[cc]
  shardBytes[`${cc}.json`] = await writeJson(path.join(shardDir, `${cc}.json`), {
    schemaVersion: 1,
    cc,
    /** 该国已归一到权威层物种的记录数合计（= bySpecies 之和；不含被丢弃的非种级/未收录名） */
    count,
    species,
    bySpecies,
  })
  shardTotals[cc] = count
}
// 清理过期分片（国家集合变了之后，旧文件留着会被误读）
const keep = new Set(Object.keys(shardBytes))
for (const f of (await fs.readdir(shardDir).catch(() => [])).filter((f) => f.endsWith('.json'))) {
  if (f === 'index.json' || keep.has(f)) continue
  await fs.rm(path.join(shardDir, f), { force: true })
}

const totalShardBytes = Object.values(shardBytes).reduce((a, b) => a + b, 0)
const maxShardName = Object.entries(shardBytes).sort((a, b) => b[1] - a[1])[0]

const index = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    'GBIF SQL Download API 的「物种 × 国家」记录数矩阵（scientificname + countrycode + n）；' +
    '学名按 normBinomial 归并亚种后挂到权威层物种（manifest-meta），未命中再查 name-bridge（旧分类组合名）；' +
    `属/纲级行（Aves、Corvus 等）与名录未收录的拆分种直接丢弃，孤证（n<${MIN}）按地板丢弃——不臆造。` +
    '范围＝GBIF countrycode，即 **ISO 3166-1 alpha-2 的 249 个码**（含属地与特殊领地，不是主权国家数）：' +
    '193 个联合国会员国 + 2 个观察员（VA/PS）+ 台湾（按铁律 6 显示为「中国台湾」）与南极洲 + 约 50 个属地/特殊领地' +
    '（香港/澳门、格陵兰、法属圭亚那、圣诞岛、布韦岛…）。**表述统一用「国家/地区」**。' +
    '口径：**国家层 = 该国家/地区码的全部记录数（含未被归属到省份的记录）**；与省级层（只计能映射到 ISO 省名的记录）' +
    '天然不等，两层不可互相加总，也**不要跨地区比大小**（各国记录量差异来自 GBIF 数据集构成）。',
  sources: [GBIF_SQL_SOURCE],
  threshold: { minRecords: MIN },
  scope: { countries: countries.length },
  counts: {
    rows: rows.length,
    rawRecords: totalRaw,
    pairs,
    species: new Set(Object.values(shards).flatMap((s) => Object.keys(s.bySpecies))).size,
    matchedRecords: mappedRecords,
    matchedShare: Number(matchedCoverage.toFixed(4)),
    viaBridge,
    unmatchedNames: unmatchedNames.size,
  },
  /** 该国已归一记录数合计（= 分片 count；与 counts.rawRecords 不同，后者含被丢弃的行） */
  totals: shardTotals,
  sharding: {
    dir: path.basename(OUT_DIR),
    files: Object.keys(shardBytes).sort(),
    bytes: shardBytes,
    maxBytes: maxShardName?.[1] ?? 0,
    totalBytes: totalShardBytes,
  },
}
const indexBytes = await writeJson(path.join(OUT_DIR, 'index.json'), index)
console.log(
  `✓ region-records：索引 ${(indexBytes / 1024).toFixed(1)}KB + ${countries.length} 个分片 ` +
    `（合计 ${(totalShardBytes / 1e6).toFixed(2)}MB，最大 ${maxShardName?.[0]} ${((maxShardName?.[1] ?? 0) / 1024).toFixed(0)}KB）` +
    ` → ${path.relative(ROOT, OUT_DIR)}/`,
)
