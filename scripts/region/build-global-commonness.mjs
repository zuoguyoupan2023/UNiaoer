/**
 * 097 F（2026-10-30）：构建**全球档位表** `public/data/global-commonness.json`。
 *
 * 背景：省级/国家级档位表（province-commonness）只覆盖"选了国家/省"的出题；
 * ALL / 洲模式没有档位表，此前不收窄（全取满）——L1 与 L6 池子相同，用户指出
 * L1 不该 100%（docs/097）。本产物按**全球 GBIF 观测记录数**把题库物种十等分，
 * 给洲/全球出题提供"全球视角的常见度"切分点。
 *
 * 数据源：`public/data/region-records/<CC>.json`（GBIF SQL 物种×国家矩阵，
 * 已匹配到权威层物种）逐国求和 → 每物种的全球记录数。无需新下载、无需名称匹配。
 *
 * 产物（git 提交物 + 推 R2 供 Worker 在线候选）：
 *   { schemaVersion, scope: 'global', generatedAt, method, sources,
 *     counts: { species, withRecords, bankTotal }, tiers: { 物种id: 1..10 } }
 *
 * 运行：`npm run region:global-tiers`（纯本地，无网络）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bandGlobal } from './province-commonness-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA = path.join(ROOT, 'public/data')
const OUT_FILE = path.join(DATA, 'global-commonness.json')

const REGION_RECORDS_INDEX = path.join(DATA, 'region-records/index.json')
const MANIFEST_META = path.join(DATA, 'manifest-meta.json')

const GBIF_SOURCE = {
  key: 'gbif',
  name: 'GBIF occurrence data (SQL Download API)',
  url: 'https://www.gbif.org/',
  license: 'CC0/CC-BY/CC-BY-NC（逐条，见 GBIF 处理规则）',
  attribution: 'GBIF — https://www.gbif.org/ (occurrence records via SQL Download, CC0/CC-BY/CC-BY-NC)',
}

async function readJson(file) {
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(file, 'utf8'))
}

async function writeJson(file, text) {
  const { writeFile, rename } = await import('node:fs/promises')
  const tmp = `${file}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
}

const index = await readJson(REGION_RECORDS_INDEX)
const shardDir = path.join(DATA, 'region-records')
// 国家清单来自 sharding.files（<CC>.json）；跳过非法形态以防产物结构变化
const countries = (index?.sharding?.files || [])
  .filter((f) => /^[A-Z]{2}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ''))

// 逐国求和 → 每物种的全球记录数（region-records 已按国家匹配权威层物种）
const globalCounts = new Map()
let countriesRead = 0
for (const cc of countries) {
  let shard
  try {
    shard = await readJson(path.join(shardDir, `${cc}.json`))
  } catch {
    continue
  }
  countriesRead++
  for (const [speciesId, n] of Object.entries(shard.bySpecies || {})) {
    globalCounts.set(speciesId, (globalCounts.get(speciesId) || 0) + (Number(n) || 0))
  }
}

// 题库全集（含无记录物种 → 兜进第 10 档，保持全球池完整）
const meta = await readJson(MANIFEST_META)
const bankIds = meta.species.map((s) => s.id)

const { tiers, withRecords } = bandGlobal(globalCounts, bankIds)

const tierHist = {}
for (const t of Object.values(tiers)) tierHist[t] = (tierHist[t] || 0) + 1

const product = {
  schemaVersion: 1,
  scope: 'global',
  generatedAt: new Date().toISOString(),
  method:
    'global observation count (sum of region-records per-country GBIF counts) → quantile banding (10 deciles, 1 most observed … 10 least observed; zero-record species = 10) — 097 F: tier coverage for ALL/continent quizzes',
  sources: [GBIF_SOURCE],
  counts: {
    bankTotal: bankIds.length,
    withRecords,
    tierHist,
  },
  tiers,
}

await writeJson(OUT_FILE, JSON.stringify(product))
console.log(
  `✓ global-commonness：${bankIds.length} 种（有记录 ${withRecords} / 无记录兜 10 档 ${bankIds.length - withRecords}）`,
  `· 来源 ${countriesRead}/${countries.length} 国分片`,
)
console.log(`  档位分布: ${JSON.stringify(tierHist)}`)
console.log(`  体积 ${(Buffer.byteLength(JSON.stringify(product)) / 1024).toFixed(0)}KB → public/data/global-commonness.json`)
