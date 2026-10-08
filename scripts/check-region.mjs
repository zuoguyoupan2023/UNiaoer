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
import { CN_PROVINCES, CN_SENSITIVE } from './region/cn-provinces.mjs'
import { COUNTRY_DENY } from './region/config.mjs'

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

/** 顶层通用校验(budget:体积上限,默认 2MB;species-distribution 3MB,见 025 §5) */
function checkCommon(name, raw, data, budget = MAX_BYTES) {
  check(raw.length < budget, `${name}: 体积超预算（021 §2.3 上限 ${Math.round(budget / 1024 / 1024)}MB）：${Math.round(raw.length / 1024)}KB`)
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
    const RANGE_CODES = new Set(['resident', 'summer', 'winter', 'passage', 'vagrant'])
    if (e.range !== undefined) {
      check(
        Array.isArray(e.range) && e.range.length > 0 && e.range.every((c) => RANGE_CODES.has(c)),
        `${name}: ${id} range 必须为居留型枚举（resident/summer/winter/passage/vagrant）`,
      )
    }
  }
}

/** region-provinces.json（M2） */
/**
 * 036 省级常见度索引：结构/档位值域/署名/敏感性（铁律 6：不得出现排除码）。
 * 注意索引**不含 tiers**（在分片里），此处只校验元数据与口径字段。
 */
function checkProvinceCommonness(name, data) {
  check(data.schemaVersion === 1, `${name}: schemaVersion 应为 1`)
  check(Array.isArray(data.sources) && data.sources.length > 0, `${name}: sources 缺失（署名不可省）`)
  check(data.coverage && typeof data.coverage === 'object', `${name}: coverage 缺失`)
  check(data.guards && typeof data.guards === 'object', `${name}: guards 缺失（口径需可追溯）`)
  check(data.provenance && typeof data.provenance === 'object', `${name}: provenance 缺失（留痕要求）`)
  const scope = data.scope?.countries
  check(Array.isArray(scope) && scope.length > 0, `${name}: scope.countries 缺失`)
  for (const cc of scope || []) {
    if (!/^[A-Z]{2}$/.test(cc)) errors.push(`${name}: 非法国家码 ${cc}`)
    // 铁律 6：排除码不得出现在任何地区产物里
    if (['ZZ', 'XK', 'XZ'].includes(cc)) errors.push(`${name}: 出现排除码 ${cc}（铁律 6）`)
  }
  // 档位配置合理性（防止误配成"全是 1 档"之类）
  for (const k of ['dominanceShare', 'spikeShare', 'minProvinceRecords', 'minBandSize']) {
    const v = data.guards?.[k]
    check(Number.isFinite(v) && v >= 0, `${name}: guards.${k} 非法`)
  }
  check(Number.isFinite(data.coverage.species) && data.coverage.species >= 0, `${name}: coverage.species 非法`)
  check(Number.isFinite(data.coverage.pairs) && data.coverage.pairs >= 0, `${name}: coverage.pairs 非法`)
}

/**
 * 036 分片：
 *   province 级 —— { country, level:'province', tiersByCode: { code: { speciesId: tier } } }
 *   country 级  —— { country, level:'country',  tiers: { speciesId: tier } }
 * 注意 province 级**必须保留 code 层**（同物种各省档位不同；压平会静默丢数据，见构建脚本注释）。
 */
function checkProvinceCommonnessShard(name, shard) {
  check(/^[A-Z]{2}$/.test(String(shard.country || '')), `${name}: country 非法`)
  if (['ZZ', 'XK', 'XZ'].includes(shard.country)) errors.push(`${name}: 出现排除码（铁律 6）`)
  check(shard.level === 'province' || shard.level === 'country', `${name}: level 非法`)

  const checkTierMap = (label, map) => {
    let n = 0
    for (const [spId, tier] of Object.entries(map || {})) {
      if (!spId) errors.push(`${name}: ${label} 存在空 speciesId`)
      if (!Number.isInteger(tier) || tier < 1 || tier > 5) {
        errors.push(`${name}: ${label} ${spId} 档位非法（${tier}，应为 1..5）`)
        if (errors.length > 20) return n
      }
      n++
    }
    return n
  }

  if (shard.level === 'province') {
    // 省级分片必须带 tiersByCode（省码 → { 物种: 档位 }）。
    // 若只有压平后的 tiers，说明是**旧结构/构建脚本回归**（同物种多省档位会被覆盖 → 静默丢数据）。
    if (shard.tiers && !shard.tiersByCode) {
      errors.push(`${name}: 旧结构（省级分片缺少 tiersByCode，见构建脚本 shardByCountry 注释）`)
    }
    check(shard.tiersByCode && typeof shard.tiersByCode === 'object', `${name}: tiersByCode 缺失`)
    let total = 0
    for (const [code, map] of Object.entries(shard.tiersByCode || {})) {
      check(String(code).startsWith(shard.country + '-'), `${name}: 省码 ${code} 与国家 ${shard.country} 不匹配`)
      total += checkTierMap(code, map)
    }
    check(total > 0, `${name}: 无任何档位`)
  } else {
    check(shard.tiers && typeof shard.tiers === 'object', `${name}: tiers 缺失`)
    checkTierMap('tiers', shard.tiers)
    check(Object.keys(shard.tiers || {}).length > 0, `${name}: 分片为空`)
  }
}

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
  // 021 M3 §2.4：CN 省级清单硬校验（34 官方区划 + 港澳台标注名，铁律 6）
  if (data.byCountry?.CN) {
    const cnMap = data.byCountry.CN
    check(
      Object.keys(cnMap).length === CN_PROVINCES.length,
      `${name}: CN 省级清单必须完整等于 ${CN_PROVINCES.length} 个官方区划，实际 ${Object.keys(cnMap).length}`,
    )
    const wantCodes = new Set(CN_PROVINCES.map((p) => p.code))
    for (const code of Object.keys(cnMap)) {
      check(wantCodes.has(code), `${name}: CN 出现官方清单之外的 code ${code}`)
    }
    check(data.byCountryAlt?.CN !== undefined, `${name}: CN 缺 byCountryAlt（英文展示名，含港澳台标注）`)
    for (const [code, names] of Object.entries(CN_SENSITIVE)) {
      check(cnMap[code] === names.zh, `${name}: CN/${code} 显示名必须为「${names.zh}」`)
      check(
        data.byCountryAlt?.CN?.[code] === names.en,
        `${name}: CN/${code} 英文名必须为 "${names.en}"`,
      )
    }
  }
}

/** hotspots.json（M4 腿 B 网格聚合观鸟点） */
function checkHotspots(name, data) {
  check(typeof data.grid === 'number' && data.grid > 0, `${name}: grid 必须为正数`)
  const th = data.thresholds || {}
  for (const k of ['minRecords', 'minSpecies', 'minObservers']) {
    check(Number.isInteger(th[k]) && th[k] >= 0, `${name}: thresholds.${k} 非法`)
  }
  check(Array.isArray(data.hotspots), `${name}: hotspots 必须是数组`)
  for (const [i, h] of (data.hotspots || []).entries()) {
    const at = `${name}: hotspot[${i}]`
    check(typeof h?.id === 'string' && h.id, `${at} id 缺失`)
    check(Number.isFinite(h?.lat) && h.lat >= -90 && h.lat <= 90, `${at} lat 非法`)
    check(Number.isFinite(h?.lng) && h.lng >= -180 && h.lng <= 180, `${at} lng 非法`)
    check(/^[A-Z]{2}$/.test(h?.country || ''), `${at} country 非法`)
    check(Number.isInteger(h?.recordCount) && h.recordCount > 0, `${at} recordCount 非法`)
    check(Number.isInteger(h?.speciesCount) && h.speciesCount > 0, `${at} speciesCount 非法`)
    check(Number.isInteger(h?.observerCount) && h.observerCount >= 0, `${at} observerCount 非法`)
    check(
      Number.isInteger(h?.recordCount) && h.recordCount >= (th.minRecords ?? 0) &&
        Number.isInteger(h?.speciesCount) && h.speciesCount >= (th.minSpecies ?? 0) &&
        Number.isInteger(h?.observerCount) && h.observerCount >= (th.minObservers ?? 0),
      `${at} 未达 thresholds（阈值过滤失效）`,
    )
    check(
      Array.isArray(h?.topSpecies) &&
        h.topSpecies.length > 0 &&
        h.topSpecies.every((s) => Number.isInteger(s.count) && s.count > 0 && (s.id || s.sci)),
      `${at} topSpecies 非法`,
    )
    check(
      Array.isArray(h?.sources) && h.sources.length > 0 && h.sources.every((s) => typeof s === 'string' && s),
      `${at} sources（逐条署名）缺失`,
    )
  }
}

/** species-distribution.json(025 M1,全球区系按国倒排;短码=AvibaseID 去 avibase- 前缀) */
function checkDistributionGlobal(name, data, indexCodes) {
  check(data.byCountry && typeof data.byCountry === 'object', `${name}: byCountry 缺失`)
  if (!indexCodes) {
    errors.push(`${name}: 无法加载 species-index.json 做短码闭环校验(先跑 npm run species-index)`)
    return
  }
  let pairs = 0
  for (const [cc, codes] of Object.entries(data.byCountry || {})) {
    if (!/^[A-Z]{2}$/.test(cc)) {
      errors.push(`${name}: 非法国家码键 ${cc}`)
      continue
    }
    if (COUNTRY_DENY.has(cc)) {
      errors.push(`${name}: 排除码 ${cc}(ZZ/XK/XZ)不得出现在产物(铁律 6 / 非国家码)`)
      continue
    }
    if (!Array.isArray(codes) || !codes.length) {
      errors.push(`${name}: ${cc} 必须是非空短码数组`)
      continue
    }
    let prev = ''
    for (const code of codes) {
      if (!/^[A-Z0-9]{6,10}$/.test(code)) {
        errors.push(`${name}: ${cc} 含非法短码 ${code}`)
        break
      }
      if (!indexCodes.has(code)) errors.push(`${name}: ${cc} 短码 ${code} 不在 species-index(闭环失败)`)
      if (code === prev) errors.push(`${name}: ${cc} 短码重复 ${code}`)
      if (code < prev) errors.push(`${name}: ${cc} 短码未按升序排序(产物须确定性)`)
      prev = code
      pairs++
    }
  }
  check(Number.isInteger(data.counts?.countries) && data.counts.countries === Object.keys(data.byCountry || {}).length, `${name}: counts.countries 与 byCountry 不一致`)
  check(Number.isInteger(data.counts?.pairs) && data.counts.pairs === pairs, `${name}: counts.pairs(${data.counts?.pairs})与实际(${pairs})不一致`)
  const gbif = (data.sources || []).find((s) => s.key === 'gbif')
  check(!!gbif, `${name}: sources 缺 gbif 条目(署名义务)`)
  if (data.counts?.unmatchedNames != null) {
    check(Number.isInteger(data.counts.unmatchedNames) && data.counts.unmatchedNames >= 0, `${name}: counts.unmatchedNames 非法`)
  }
}

const files = args.file
  ? [path.resolve(ROOT, args.file)]
  : [
      'public/data/seasonality.json',
      'public/data/region-provinces.json',
      'public/data/hotspots.json',
      'public/data/species-distribution.json',
      'public/data/province-commonness.json',
    ].map((p) => path.join(ROOT, p))

const present = []
// 025 M1:species-distribution 闭环校验需要骨架短码全集(缺骨架时报错,由 checkDistributionGlobal 呈现)
let indexCodes = null
try {
  const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  indexCodes = new Set(index.species.map((e) => String(e.taxonKey || '').replace(/^avibase-/, '')))
} catch {
  indexCodes = null
}
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
  checkCommon(name, raw, data, /species-distribution/.test(name) ? 3 * 1024 * 1024 : MAX_BYTES)
  if (Array.isArray(data.tiers)) errors.push(`${name}: tiers 必须是对象`)
  else if (data.tiers || data.sharding) {
    // 036 省级常见度（分片产物）：索引 + 分片
    checkProvinceCommonness(name, data)
    if (data.sharding) {
      const dir = path.join(path.dirname(file), data.sharding.dir)
      for (const f of data.sharding.files || []) {
        const raw2 = await fs.readFile(path.join(dir, f), 'utf8').catch(() => null)
        if (raw2 === null) {
          errors.push(`${name}: 缺少分片 ${data.sharding.dir}/${f}`)
          continue
        }
        present.push(`${data.sharding.dir}/${f}`)
        let shard = null
        try {
          shard = JSON.parse(raw2)
        } catch {
          errors.push(`分片 ${f}: 不是合法 JSON`)
          continue
        }
        checkProvinceCommonnessShard(`${data.sharding.dir}/${f}`, shard)
      }
    }
  } else if (data.bySpecies && data.byCountry) checkProvinces(name, data)
  else if (Array.isArray(data.hotspots)) checkHotspots(name, data)
  else if (data.bySpecies) checkSeasonality(name, data)
  else if (data.byCountry && data.counts?.pairs != null) checkDistributionGlobal(name, data, indexCodes)
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
