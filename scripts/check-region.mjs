/**
 * 021 §2.3/§2.4：seasonality.json 结构与署名校验（纯本地，不联网）。
 * CLI：npm run check:region [-- --no-net] [-- --file path]
 * 校验失败 exit 1；通过打印汇总。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const FILE = path.resolve(ROOT, args.file || 'public/data/seasonality.json')

const errors = []
function check(cond, msg) {
  if (!cond) errors.push(msg)
}

const raw = await fs.readFile(FILE, 'utf8').catch(() => null)
if (raw === null) {
  console.error(`check:region：文件不存在 ${FILE}（先跑 npm run region:build）`)
  process.exit(1)
}
check(raw.length < 2 * 1024 * 1024, `体积超预算（021 §2.3 上限 2MB）：${Math.round(raw.length / 1024)}KB`)

let data = null
try {
  data = JSON.parse(raw)
} catch {
  errors.push('不是合法 JSON')
}
/** §2.4.4：产物只允许统计/文本，不得含地图/边界几何数据 */
const GEO_KEYS = new Set([
  'geometry',
  'geojson',
  'coordinates',
  'bbox',
  'geom',
  'the_geom',
  'polygon',
  'multipolygon',
  'linestring',
])
function findGeo(node, path = '$', hits = []) {
  if (!node || typeof node !== 'object') return hits
  for (const [k, v] of Object.entries(node)) {
    if (GEO_KEYS.has(String(k).toLowerCase())) hits.push(`${path}.${k}`)
    else findGeo(v, `${path}.${k}`, hits)
  }
  return hits
}

if (data) {
  check(data.schemaVersion === 1, `schemaVersion 必须为 1，得到 ${data.schemaVersion}`)
  check(typeof data.generatedAt === 'string' && data.generatedAt, 'generatedAt 缺失')
  check(typeof data.method === 'string' && data.method, 'method（口径说明）缺失')
  check(Array.isArray(data.sources) && data.sources.length > 0, 'sources（数据集署名）缺失')
  check(data.bySpecies && typeof data.bySpecies === 'object', 'bySpecies 缺失')

  const entries = Object.entries(data.bySpecies || {})
  for (const [id, e] of entries) {
    if (!id) errors.push('存在空 speciesId')
    const monthsOk =
      Array.isArray(e.months) &&
      e.months.length === 12 &&
      e.months.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)
    if (!monthsOk) {
      errors.push(`${id}: months 必须是 12 个 0–100 整数`)
      continue
    }
    check(Number.isInteger(e.recordCount) && e.recordCount >= 0, `${id}: recordCount 非法`)
    check(
      Array.isArray(e.sources) && e.sources.length > 0 && e.sources.every((s) => typeof s === 'string' && s),
      `${id}: sources（逐条署名）缺失`,
    )
  }

  const geo = findGeo(data)
  check(geo.length === 0, `产物含边界/几何数据（021 §2.4.4 禁止）：${geo.slice(0, 5).join(', ')}`)
}

if (errors.length) {
  console.error(`check:region：${errors.length} 处问题`)
  for (const e of errors.slice(0, 20)) console.error('  -', e)
  process.exit(1)
}
console.log(
  `✓ check:region：${path.basename(FILE)} 结构/署名/敏感性校验通过` +
    `${data ? `（${Object.keys(data.bySpecies).length} 物种）` : ''}`,
)
