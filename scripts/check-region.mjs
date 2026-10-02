/**
 * 021 §2.3/§2.4：地区数据产物结构与署名校验（纯本地，不联网）。
 * CLI：npm run check:region [-- --no-net] [-- --file path]
 *  - 默认校验 public/data/ 下已存在的 seasonality.json 与 region-provinces.json
 *  - --file 指定单个文件（按内容形状自动判定类型）
 * 校验失败 exit 1；通过打印汇总。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const MAX_BYTES = 2 * 1024 * 1024

const errors = []
const check = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/** §2.4.4：产物只允许统计/文本，不得含地图/边界几何数据 */
const GEO_KEYS = new Set([
  'geometry', 'geojson', 'coordinates', 'bbox', 'geom', 'the_geom', 'polygon', 'multipolygon', 'linestring',
])
function findGeo(node, at = '$', hits = []) {
  if (!node || typeof node !== 'object') return hits
  for (const [k, v] of Object.entries(node)) {
    if (GEO_KEYS.has(String(k).toLowerCase())) hits.push(`${at}.${k}`)
    else findGeo(v, `${at}.${k}`, hits)
  }
  return hits
}

/** 顶层通用校验 */
function checkCommon(name, raw, data) {
  check(raw.length < MAX_BYTES, `${name}: 体积超预算（021 §2.3 上限 2MB）：${Math.round(raw.length / 1024)}KB`)
  check(data.schemaVersion === 1, `${name}: schemaVersion 必须为 1，得到 ${data.schemaVersion}`)
  check(typeof data.generatedAt === 'string' && data.generatedAt, `${name}: generatedAt 缺失`)
  check(typeof data.method === 'string' && data.method, `${name}: method（口径说明）缺失`)
  check(Array.isArray(data.sources) && data.sources.length > 0, `${name}: sources（数据集署名）缺失`)
  const geo = findGeo(data)
  check(geo.length === 0, `${name}: 产物含边界/几何数据（021 §2.4.4 禁止）：${geo.slice(0, 5).join(', ')}`)
}

/** seasonality.json（M1） */
function checkSeasonality(name, data) {
  check(data.bySpecies && typeof data.bySpecies === 'object', `${name}: bySpecies 缺失`)
  for (const [id, e] of Object.entries(data.bySpecies || {})) {
    if (!id) errors.push(`${name}: 存在空 speciesId`)
    const monthsOk =
      Array.isArray(e.months) && e.months.length === 12 && e.months.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)
    if (!monthsOk) {
      errors.push(`${name}: ${id} months 必须是 12 个 0–100 整数`)
      continue
    }
    check(Number.isInteger(e.recordCount) && e.recordCount >= 0, `${name}: ${id} recordCount 非法`)
    check(
      Array.isArray(e.sources) && e.sources.length > 0 && e.sources.every((s) => typeof s === 'string' && s),
      `${name}: ${id} sources（逐条署名）缺失`,
    )
  }
}

/** region-provinces.json（M2） */
function checkProvinces(name, data) {
  check(data.byCountry && typeof data.byCountry === 'object', `${name}: byCountry 缺失`)
  check(data.bySpecies && typeof data.bySpecies === 'object', `${name}: bySpecies 缺失`)
  for (const [cc, divs] of Object.entries(data.byCountry || {})) {
    if (!/^[A-Z]{2}$/.test(cc)) errors.push(`${name}: 非法国家码 ${cc}`)
    for (const [code, divName] of Object.entries(divs || {})) {
      check(String(code).startsWith(cc + '-'), `${name}: ${cc} 下 code ${code} 与国家对不上`)
      check(typeof divName === 'string' && divName, `${name}: ${cc}/${code} 缺省名`)
    }
  }
  for (const [spId, byCc] of Object.entries(data.bySpecies || {})) {
    if (!spId) errors.push(`${name}: 存在空 speciesId`)
    for (const [cc, counts] of Object.entries(byCc || {})) {
      if (!data.byCountry?.[cc]) {
        errors.push(`${name}: ${spId} 引用了 byCountry 未收录的国家 ${cc}`)
        continue
      }
      for (const [code, n] of Object.entries(counts || {})) {
        check(data.byCountry[cc][code] !== undefined, `${name}: ${spId}/${cc} code ${code} 未在 byCountry`)
        check(Number.isInteger(n) && n > 0, `${name}: ${spId}/${cc}/${code} count 必须为正整数`)
      }
    }
  }
}

const files = args.file
  ? [path.resolve(ROOT, args.file)]
  : ['public/data/seasonality.json', 'public/data/region-provinces.json'].map((p) => path.join(ROOT, p))

const present = []
for (const file of files) {
  const raw = await fs.readFile(file, 'utf8').catch(() => null)
  if (raw === null) continue
  const name = path.basename(file)
  present.push(name)
  let data = null
  try {
    data = JSON.parse(raw)
  } catch {
    errors.push(`${name}: 不是合法 JSON`)
    continue
  }
  checkCommon(name, raw, data)
  if (data.bySpecies && data.byCountry) checkProvinces(name, data)
  else if (data.bySpecies) checkSeasonality(name, data)
  else errors.push(`${name}: 无法识别的产物形状`)
}

if (!present.length && !args.file) {
  console.error('check:region：未找到任何产物（先跑 region:build / region:provinces）')
  process.exit(1)
}

if (errors.length) {
  console.error(`check:region：${errors.length} 处问题`)
  for (const e of errors.slice(0, 25)) console.error('  -', e)
  process.exit(1)
}
console.log(`✓ check:region：结构/署名/敏感性校验通过（${present.join(' · ') || path.basename(files[0])}）`)
