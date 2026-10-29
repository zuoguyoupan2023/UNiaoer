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
function checkCommon(name, raw, data, budget = MAX_BYTES, { shard = false } = {}) {
  check(raw.length < budget, `${name}: 体积超预算（021 §2.3 上限 ${Math.round(budget / 1024 / 1024)}MB）：${Math.round(raw.length / 1024)}KB`)
  check(data.schemaVersion === 1, `${name}: schemaVersion 必须为 1，得到 ${data.schemaVersion}`)
  // 039 P1 按国分片：口径/署名集中在 index.json（15 份重复无意义），分片只查结构
  if (!shard) {
    check(typeof data.generatedAt === 'string' && data.generatedAt, `${name}: generatedAt 缺失`)
    check(typeof data.method === 'string' && data.method, `${name}: method（口径说明）缺失`)
    check(Array.isArray(data.sources) && data.sources.length > 0, `${name}: sources（数据集署名）缺失`)
  }
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
  for (const k of ['dominanceShare', 'spikeShare', 'minProvinceRecords', 'minBandSize', 'minSpeciesRecords']) {
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
      if (!Number.isInteger(tier) || tier < 1 || tier > 10) {
        errors.push(`${name}: ${label} ${spId} 档位非法（${tier}，应为 1..10，097 十档制）`)
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

/**
 * P1-6（2026-10-23）省级层分片索引 `public/data/region-provinces/index.json`：
 * 只承载元数据 + 国家/省名 + 两类分片清单（**不得内嵌 bySpecies**，否则又变成单文件）。
 * 分片内容与整体不变量在 checkProvincesShards 里合并后复用 checkProvinces 校验。
 */
function checkProvincesIndex(name, data) {
  check(Array.isArray(data.countries) && data.countries.length > 0, `${name}: countries 缺失`)
  check(data.bySpecies === undefined, `${name}: 索引不得内嵌 bySpecies（P1-6 已拆成按国/按物种分片）`)
  check(data.sharding && Array.isArray(data.sharding.files), `${name}: sharding.files 缺失`)
  check(
    data.speciesSharding && Array.isArray(data.speciesSharding.buckets),
    `${name}: speciesSharding.buckets 缺失（物种页热力条要按桶取）`,
  )
  const chars = data.speciesSharding?.bucketChars
  check(Number.isInteger(chars) && chars >= 1 && chars <= 4, `${name}: speciesSharding.bucketChars 非法（${chars}）`)
  for (const cc of data.countries || []) {
    if (!/^[A-Z]{2}$/.test(cc)) errors.push(`${name}: 非法国家码 ${cc}`)
    if (COUNTRY_DENY.has(cc)) errors.push(`${name}: 排除码 ${cc}（铁律 6）`)
  }
  check(!Object.keys(data.byCountry || {}).some((cc) => COUNTRY_DENY.has(cc)), `${name}: byCountry 出现排除码（铁律 6）`)
  // P1-4B：每国覆盖率可追溯（低覆盖国前端要标注"仅覆盖 X%"）
  const cov = data.coverage?.byCountry || {}
  for (const [cc, c] of Object.entries(cov)) {
    check(
      Number.isFinite(c?.coverage) && c.coverage >= 0 && c.coverage <= 1,
      `${name}: ${cc} coverage 非法（${c?.coverage}）`,
    )
    check(
      !Number.isFinite(c?.mappedRecords) || c.mappedRecords <= c.allRecords,
      `${name}: ${cc} mappedRecords > allRecords`,
    )
  }
  check(Number.isInteger(data.coverage?.countries) && data.coverage.countries > 0, `${name}: coverage.countries 非法`)
}

/** 递归规范化（键排序）→ 用于"同一格数据在两个分片里必须一致"的比对 */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/**
 * P1-6：省级层分片的**闭环校验**（索引 ↔ 磁盘 ↔ 两种分片之间的逐格一致）。
 * 合并后的结构直接复用 checkProvinces（重复向量/异常主导/CN 34 区划/港澳台标注名等不变量）。
 */
async function checkProvincesShards(baseDir, name, data) {
  const base = path.join(baseDir, 'public/data')
  const readDir = (d) => fs.readdir(d).catch(() => [])
  const readShard = async (dir, f, label) => {
    const raw = await fs.readFile(path.join(dir, f), 'utf8').catch(() => null)
    if (raw === null) {
      errors.push(`${name}: 缺少分片 ${label}`)
      return null
    }
    check(raw.length < MAX_BYTES, `${name}: 分片 ${label} 体积 ${Math.round(raw.length / 1024)}KB 超 ${MAX_BYTES / 1024 / 1024}MB`)
    try {
      const shard = JSON.parse(raw)
      const geo = findGeo(shard)
      check(geo.length === 0, `${name}: 分片 ${label} 含边界/几何数据：${geo.slice(0, 3).join(', ')}`)
      return shard
    } catch {
      errors.push(`${name}: 分片 ${label} 不是合法 JSON`)
      return null
    }
  }

  // ① 按国分片
  const dir = path.join(base, data.sharding.dir)
  const onDisk = (await readDir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort()
  for (const f of data.sharding.files || []) if (!onDisk.includes(f)) errors.push(`${name}: 清单里的分片 ${f} 不存在`)
  for (const f of onDisk) if (!(data.sharding.files || []).includes(f)) errors.push(`${name}: 磁盘上有多余分片 ${f}（清单未登记）`)

  const bySpecies = {}
  const countriesWithData = new Set()
  for (const f of onDisk) {
    const cc = f.replace(/\.json$/, '')
    if (!/^[A-Z]{2}$/.test(cc)) {
      errors.push(`${name}: 分片文件名 ${f} 不是国家码`)
      continue
    }
    if (COUNTRY_DENY.has(cc)) errors.push(`${name}: 分片 ${f} 是国家排除码（铁律 6）`)
    const shard = await readShard(dir, f, `region-provinces/${f}`)
    if (!shard) continue
    check(shard.schemaVersion === 1, `${name}: 分片 ${f} schemaVersion 应为 1`)
    check(shard.cc === cc, `${name}: 分片 ${f} 的 cc(${shard.cc}) 与文件名不一致`)
    const n = Object.keys(shard.bySpecies || {}).length
    check(n > 0, `${name}: 分片 ${f} 为空`)
    const meta = data.countryCounts?.[cc]
    check(!!meta, `${name}: 分片 ${f} 未登记在 countryCounts`)
    if (meta) check(meta.species === n, `${name}: ${cc} countryCounts.species(${meta.species}) ≠ 分片实际(${n})`)
    for (const [spId, cells] of Object.entries(shard.bySpecies || {})) {
      if (!spId) errors.push(`${name}: 分片 ${f} 存在空 speciesId`)
      for (const [code, count] of Object.entries(cells || {})) {
        if (!String(code).startsWith(`${cc}-`)) errors.push(`${name}: ${f} 的 ${spId} 引用了不属于 ${cc} 的省码 ${code}`)
        if (!Number.isInteger(count) || count <= 0) errors.push(`${name}: ${f} 的 ${spId}/${code} 记录数非法（${count}）`)
      }
      ;(bySpecies[spId] ??= {})[cc] = cells
    }
    countriesWithData.add(cc)
  }

  // 合并后跑原有全部省级层不变量（等价于旧单文件的校验路径）
  checkProvinces(`${name}(分片合集)`, {
    byCountry: data.byCountry,
    byCountryAlt: data.byCountryAlt,
    bySpecies,
  })
  const speciesN = Object.keys(bySpecies).length
  check(data.counts?.species === speciesN, `${name}: counts.species(${data.counts?.species}) ≠ 分片合集(${speciesN})`)
  check(
    data.counts?.countries === countriesWithData.size,
    `${name}: counts.countries(${data.counts?.countries}) ≠ 有数据国家数(${countriesWithData.size})`,
  )

  // ② 按物种前缀分桶
  const sdir = path.join(base, data.speciesSharding.dir)
  const onDiskS = (await readDir(sdir)).filter((f) => f.endsWith('.json')).sort()
  const chars = data.speciesSharding.bucketChars
  for (const f of data.speciesSharding.buckets || []) if (!onDiskS.includes(f)) errors.push(`${name}: 清单里的物种桶 ${f} 不存在`)
  for (const f of onDiskS) if (!(data.speciesSharding.buckets || []).includes(f)) errors.push(`${name}: 磁盘上有多余物种桶 ${f}`)

  const seen = new Set()
  let cells = 0
  for (const f of onDiskS) {
    const bucket = f.replace(/\.json$/, '')
    const shard = await readShard(sdir, f, `${data.speciesSharding.dir}/${f}`)
    if (!shard) continue
    check(shard.schemaVersion === 1, `${name}: 物种桶 ${f} schemaVersion 应为 1`)
    check(shard.bucket === bucket, `${name}: 物种桶 ${f} 的 bucket(${shard.bucket}) 与文件名不一致`)
    check(bucket.length === chars, `${name}: 物种桶 ${f} 名长度应等于 bucketChars=${chars}`)
    for (const [spId, byCc] of Object.entries(shard.bySpecies || {})) {
      if (spId.slice(0, chars) !== bucket) errors.push(`${name}: ${spId} 落在错误的桶 ${bucket}`)
      if (seen.has(spId)) errors.push(`${name}: 物种 ${spId} 出现在多个桶里`)
      seen.add(spId)
      const merged = bySpecies[spId]
      if (!merged) {
        errors.push(`${name}: 物种桶里的 ${spId} 不在按国分片里（两种分片不一致）`)
        continue
      }
      if (canon(merged) !== canon(byCc)) errors.push(`${name}: ${spId} 的省份数据在两种分片里不一致（同源必须逐格相等）`)
      for (const c of Object.values(byCc || {})) cells += Object.keys(c || {}).length
    }
  }
  check(seen.size === speciesN, `${name}: 物种桶覆盖 ${seen.size} 种 ≠ 按国分片 ${speciesN} 种`)
  check(data.counts?.cells === cells, `${name}: counts.cells(${data.counts?.cells}) ≠ 物种桶逐格合计(${cells})`)
  console.log(
    `  · ${name}：${data.sharding.files.length} 国分片 / ${data.speciesSharding.buckets.length} 物种桶 / ` +
      `${speciesN} 物种 / ${cells} 格（索引↔分片逐格一致）`,
  )
}

/**
 * P0-5（2026-10-23）国家层记录数分片 `public/data/region-records/`：
 * 索引的 totals 必须等于分片 count，分片 count 必须等于 bySpecies 之和；
 * 物种 id 必须是 slug 形态（不能是学术名/空串），国家码不得是排除码。
 */
async function checkCountryRecords(baseDir, name, data) {
  const base = path.join(baseDir, 'public/data')
  const dir = path.join(base, data.sharding.dir)
  const onDisk = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json') && f !== 'index.json').sort()
  for (const f of data.sharding.files || []) if (!onDisk.includes(f)) errors.push(`${name}: 清单里的分片 ${f} 不存在`)
  for (const f of onDisk) if (!(data.sharding.files || []).includes(f)) errors.push(`${name}: 磁盘上有多余分片 ${f}（清单未登记）`)

  let pairs = 0
  let speciesSeen = new Set()
  let matched = 0
  for (const f of onDisk) {
    const cc = f.replace(/\.json$/, '')
    if (!/^[A-Z]{2}$/.test(cc)) {
      errors.push(`${name}: 分片文件名 ${f} 不是国家码`)
      continue
    }
    if (COUNTRY_DENY.has(cc)) errors.push(`${name}: 分片 ${f} 是国家排除码（铁律 6）`)
    const raw = await fs.readFile(path.join(dir, f), 'utf8').catch(() => null)
    if (raw === null) continue
    check(raw.length < MAX_BYTES, `${name}: 分片 ${f} 体积超 ${MAX_BYTES / 1024 / 1024}MB`)
    let shard = null
    try {
      shard = JSON.parse(raw)
    } catch {
      errors.push(`${name}: 分片 ${f} 不是合法 JSON`)
      continue
    }
    check(shard.schemaVersion === 1, `${name}: 分片 ${f} schemaVersion 应为 1`)
    check(shard.cc === cc, `${name}: 分片 ${f} 的 cc(${shard.cc}) 与文件名不一致`)
    const geo = findGeo(shard)
    check(geo.length === 0, `${name}: 分片 ${f} 含边界/几何数据：${geo.slice(0, 3).join(', ')}`)
    let sum = 0
    const ids = Object.keys(shard.bySpecies || {})
    for (const [spId, n] of Object.entries(shard.bySpecies || {})) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(spId)) errors.push(`${name}: ${f} 的物种 id 非法（${spId}）`)
      if (!Number.isInteger(n) || n < (data.threshold?.minRecords ?? 1)) {
        errors.push(`${name}: ${f}/${spId} 记录数非法（${n}，地板 ${data.threshold?.minRecords}）`)
      }
      sum += n
      speciesSeen.add(spId)
    }
    check(shard.count === sum, `${name}: ${f} 的 count(${shard.count}) ≠ bySpecies 之和(${sum})`)
    check(shard.species === ids.length, `${name}: ${f} 的 species(${shard.species}) ≠ 物种数(${ids.length})`)
    check(data.totals?.[cc] === shard.count, `${name}: ${cc} 索引合计(${data.totals?.[cc]}) ≠ 分片 count(${shard.count})`)
    pairs += ids.length
    matched += sum
  }
  const files = new Set((data.sharding.files || []).map((f) => f.replace(/\.json$/, '')))
  for (const cc of Object.keys(data.totals || {})) {
    if (!files.has(cc)) errors.push(`${name}: totals 里的 ${cc} 没有对应分片`)
  }
  check(files.size === (data.scope?.countries ?? -1), `${name}: scope.countries(${data.scope?.countries}) ≠ 分片数(${files.size})`)
  check(data.counts?.pairs === pairs, `${name}: counts.pairs(${data.counts?.pairs}) ≠ 实际(${pairs})`)
  check(data.counts?.matchedRecords === matched, `${name}: counts.matchedRecords(${data.counts?.matchedRecords}) ≠ 实际(${matched})`)
  check(
    Number.isFinite(data.counts?.matchedShare) && data.counts.matchedShare > 0.99,
    `${name}: 物种匹配率 ${data.counts?.matchedShare} 偏低（< 99%，说明学名映射链断了：先看 data/region-name-aliases.json 是否过期）`,
  )
  const gbif = (data.sources || []).find((s) => s.key === 'gbif')
  check(!!gbif, `${name}: sources 缺 gbif 署名条目`)
  console.log(
    `  · ${name}：${files.size} 个国家/地区 / ${speciesSeen.size} 物种 / ${pairs} 个(地区码,种)对 / ` +
      `匹配率 ${(Number(data.counts?.matchedShare) * 100).toFixed(2)}%（索引↔分片合计一致）`,
  )
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
  // P0-0（2026-10-23，docs/075 §5）：两条不变量，防止「GBIF 学名解析降级」类错误再次静默上线。
  // 旧实现只判 matchType !== 'NONE'，把 HIGHERRANK 的属/根节点当物种 → 记录数变成「该国全部类群」
  // （实测 anarhynchus-dealbatus 的 CN-11 = 809,195 = 北京全部类群；真值 486）。
  const vectorSeen = new Map()
  const ccTotals = new Map()
  const codeTotals = new Map()
  const ccMax = new Map()
  const codeMax = new Map()
  for (const [spId, byCc] of Object.entries(data.bySpecies || {})) {
    for (const [cc, counts] of Object.entries(byCc || {})) {
      const codes = Object.keys(counts || {})
      const sum = codes.reduce((a, c) => a + counts[c], 0)
      // ① 同国内「省份向量完全相同」= 同一个 fallback key 的指纹（小样本会天然重合，故只查合计 > 1,000 且 ≥2 省）
      if (codes.length >= 2 && sum > 1000) {
        const key = `${cc}|${[...codes].sort().map((c) => `${c}:${counts[c]}`).join(',')}`
        if (vectorSeen.has(key)) {
          errors.push(
            `${name}: 省份向量完全相同（P0-0 指纹）→ ${cc}: ${vectorSeen.get(key)} ↔ ${spId}（合计 ${sum}）`,
          )
        } else {
          vectorSeen.set(key, spId)
        }
      }
      ccTotals.set(cc, (ccTotals.get(cc) || 0) + sum)
      if (sum > (ccMax.get(cc) || 0)) ccMax.set(cc, sum)
      for (const c of codes) {
        const k = `${cc}|${c}`
        codeTotals.set(k, (codeTotals.get(k) || 0) + counts[c])
        if (counts[c] > (codeMax.get(k) || 0)) codeMax.set(k, counts[c])
      }
    }
  }
  // ② 任一地区（国家或省）里，单个物种不得同时满足「记录数 ≥ 100,000」且「份额 ≥ 20%」。
  //    下限取 10 万：解析降级拿到的是"整个地区"的量级（最小也 ≥ 86 万），而小地区（如 ES-ML 梅利利亚
  //    的奥氏鸥 67%、ES-CE 休达的欧洲丝雀 21%）是真实的小样本集中，不能误判 → 这类只打印提示、不判错。
  const dominanceNote = []
  for (const [cc, total] of ccTotals) {
    const mx = ccMax.get(cc) || 0
    if (total < 10000 || mx / total < 0.2) continue
    if (mx >= 100000) errors.push(`${name}: ${cc} 出现异常主导物种（${mx} / ${total} = ${((mx / total) * 100).toFixed(1)}% ≥ 20%）`)
    else dominanceNote.push(`${cc} ${((mx / total) * 100).toFixed(1)}%（${mx}，样本小，人工确认即可）`)
  }
  for (const [k, total] of codeTotals) {
    const mx = codeMax.get(k) || 0
    if (total < 10000 || mx / total < 0.2) continue
    if (mx >= 100000) errors.push(`${name}: ${k} 出现异常主导物种（${mx} / ${total} = ${((mx / total) * 100).toFixed(1)}% ≥ 20%）`)
    else dominanceNote.push(`${k} ${((mx / total) * 100).toFixed(1)}%（${mx}，样本小，人工确认即可）`)
  }
  if (dominanceNote.length) {
    console.log(`  · ${name} 小样本主导（不判错，人工确认）：${dominanceNote.slice(0, 8).join(' · ')}${dominanceNote.length > 8 ? ` …共 ${dominanceNote.length} 处` : ''}`)
  }

  // 021 M3 §2.4：CN 省级清单硬校验（34 官方区划 + 港澳台标注名，铁律 6）
  if (data.byCountry?.CN) {    const cnMap = data.byCountry.CN
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

/** hotspots.json（M4 腿 B 网格聚合观鸟点；041 A2 起含网格×省补码） */
function checkHotspots(name, data) {
  check(typeof data.grid === 'number' && data.grid > 0, `${name}: grid 必须为正数`)
  const th = data.thresholds || {}
  for (const k of ['minRecords', 'minSpecies', 'minObservers']) {
    check(Number.isInteger(th[k]) && th[k] >= 0, `${name}: thresholds.${k} 非法`)
  }
  check(Array.isArray(data.hotspots), `${name}: hotspots 必须是数组`)
  let withSub = 0
  const bySource = {}
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
    // 041 A2：省码必须与所在国家对得上；subnational1Source 只允许已知取值
    if (h?.subnational1 !== undefined) {
      withSub++
      check(
        String(h.subnational1).startsWith(h.country + '-'),
        `${at} subnational1 ${h.subnational1} 与国家 ${h.country} 不匹配`,
      )
      if (h.subnational1Source !== undefined) {
        check(
          h.subnational1Source === 'gbif-cell' || h.subnational1Source === 'ebird',
          `${at} subnational1Source 非法（${h.subnational1Source}）`,
        )
        bySource[h.subnational1Source] = (bySource[h.subnational1Source] || 0) + 1
      }
    } else {
      check(h?.subnational1Source === undefined, `${at} 无 subnational1 却带 subnational1Source`)
    }
  }
  // 覆盖率地板：eBird 命名 3215/5588（57.5%）；补码后应显著高于它。跌破说明补码链断裂。
  const total = (data.hotspots || []).length
  const ratio = total ? withSub / total : 0
  check(
    ratio >= 0.55,
    `${name}: 省码覆盖率 ${(ratio * 100).toFixed(1)}%（${withSub}/${total}）低于 55% 地板` +
      `（eBird 命名应已提供 ~57%；见 041 A2）`,
  )
  if (total && withSub) {
    // 只统计已声明来源者；未声明者即 eBird 就近命名自带（或旧的记录层数据）——两段之和应为总数
    const filled = bySource['gbif-cell'] || 0
    console.log(
      `  · 观鸟点：${total} 点 · 带省码 ${withSub}（${(ratio * 100).toFixed(1)}%）` +
        `（eBird/记录层 ${withSub - filled} · 网格补码 ${filled}）`,
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

/**
 * 039 P1 附近观鸟点：索引 + 按国分片（eBird 派生子集 + GBIF 网格去重共享）。
 * 重点校验：**派生约束**（原始 → 子集的保留率不能异常高——高了说明退化成"原样导出"，
 * 会把 eBird 条款风险与体积一起带回来）、字段完整性、省码与国家前缀、grid 引用闭环。
 */
function checkNearbySpots(name, data) {
  const isIndex = !!data.countries && data.total != null
  if (isIndex) {
    check(data.schemaVersion === 1, `${name}: schemaVersion 应为 1`)
    check(Array.isArray(data.sources) && data.sources.length > 0, `${name}: sources 缺失（eBird 署名不可省）`)
    const ebird = (data.sources || []).find((s) => s.key === 'ebird')
    check(!!ebird, `${name}: sources 缺 ebird 条目`)
    check(typeof data.method === 'string' && data.method.length > 20, `${name}: method（派生口径）缺失或过短`)
    for (const k of ['minSpecies', 'cellDeg', 'perCell']) {
      check(Number.isFinite(data[k]) && data[k] >= 0, `${name}: ${k} 非法`)
    }
    check(data.cellDeg > 0, `${name}: cellDeg 必须为正（0 = 未做空间去重，等于原样导出）`)
    check(Number.isFinite(data.rawTotal) && data.rawTotal > 0, `${name}: rawTotal 缺失`)
    check(Number.isInteger(data.total) && data.total > 0, `${name}: total 非法`)
    for (const c of data.countries || []) {
      if (!/^[A-Z]{2}$/.test(String(c.cc || ''))) errors.push(`${name}: 非法国家码 ${c.cc}`)
      check(Number.isInteger(c.count) && c.count > 0, `${name}: ${c.cc} count 非法`)
    }
    const kept = data.countries.reduce((n, c) => n + c.count, 0)
    check(kept === data.total, `${name}: total(${data.total}) ≠ 各国之和(${kept})`)
    // 派生边界：保留率过高说明过滤失效（对照 docs/039 §2.2 的 7.1% 实测）
    const ratio = data.total / data.rawTotal
    check(
      ratio <= 0.2,
      `${name}: 保留率 ${(ratio * 100).toFixed(1)}%（${data.total}/${data.rawTotal}）过高——` +
        `派生约束失效？eBird 原始名录不得原样分发（docs/022 §2.5）`,
    )
  } else {
    check(/^[A-Z]{2}$/.test(String(data.cc || '')), `${name}: cc 非法`)
    check(Number.isInteger(data.count) && data.count > 0, `${name}: count 非法`)
    check(Array.isArray(data.spots), `${name}: spots 必须是数组`)
    check(data.count === (data.spots || []).length, `${name}: count(${data.count}) ≠ spots(${data.spots?.length})`)
    check(data.grids && typeof data.grids === 'object', `${name}: grids 缺失`)
    const gridIds = new Set(Object.keys(data.grids || {}))
    for (const [i, s] of (data.spots || []).entries()) {
      const at = `${name}: spot[${i}]`
      check(/^L\d+$/.test(String(s?.i || '')), `${at} locId 非法（${s?.i}；eBird hotspot id 形如 L123456）`)
      check(Number.isFinite(s?.lat) && s.lat >= -90 && s.lat <= 90, `${at} lat 非法`)
      check(Number.isFinite(s?.lng) && s.lng >= -180 && s.lng <= 180, `${at} lng 非法`)
      if (s?.sub !== undefined) check(String(s.sub).startsWith(data.cc + '-'), `${at} 省码 ${s.sub} 与 ${data.cc} 不匹配`)
      if (s?.p !== undefined) check(Number.isInteger(s.p) && s.p >= 0, `${at} p（鸟种数）非法`)
      if (s?.o !== undefined) check(/^\d{4}-\d{2}-\d{2}$/.test(String(s.o)), `${at} o（日期）格式非法（${s.o}）`)
      if (s?.grid !== undefined) {
        check(gridIds.has(s.grid), `${at} 引用不存在的 grid ${s.grid}（grids 表里没有）`)
        check(Number.isInteger(s.km) && s.km >= 0, `${at} 有 grid 但 km 非法`)
      } else {
        check(s?.km === undefined, `${at} 无 grid 却带 km`)
      }
    }
    for (const [id, g] of Object.entries(data.grids || {})) {
      check(Number.isInteger(g?.r) && g.r > 0, `${name}: grid ${id} r（记录数）非法`)
      check(Number.isInteger(g?.s) && g.s > 0, `${name}: grid ${id} s（物种数）非法`)
    }
  }
}

/** 039 P1：附近观鸟点的**按国分片**（有 spots/cc，但不是索引） */
function isNearbyShard(data, file) {
  return /hotspots-ebird[\\/]/.test(file) && Array.isArray(data?.spots) && !data?.countries
}

// 039 P1：附近观鸟点分片（索引 + 各国文件；不存在时静默跳过，兼容未构建的旧检出）
const nearbyDir = path.join(ROOT, 'public/data/hotspots-ebird')
const nearbyFiles = await fs
  .readdir(nearbyDir)
  .then((list) => list.filter((f) => f.endsWith('.json')).sort().map((f) => path.join(nearbyDir, f)))
  .catch(() => [])

const files = args.file
  ? [path.resolve(ROOT, args.file)]
  : [
      'public/data/seasonality.json',
      'public/data/hotspots.json',
      'public/data/species-distribution.json',
      'public/data/province-commonness.json',
    ]
      .map((p) => path.join(ROOT, p))
      .concat(nearbyFiles)

const present = []
/** P1-6 / P0-5（2026-10-23）：分片产物的索引（在目录里，故不走上面的单文件清单） */
const shardedIndexes = args.file
  ? []
  : [
      ['region-provinces', 'public/data/region-provinces/index.json'],
      ['region-records', 'public/data/region-records/index.json'],
    ].map(([kind, p]) => ({ kind, file: path.join(ROOT, p) }))
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
  // 039 P1 分片：US 最大约 1.8MB，给 3MB 上限；索引与其余产物沿用 2MB。
  // 2026-10-23：`region-provinces.json` 旧单文件已退役（扩到 198 国后会有 ~14MB），改为分片闭环校验。
  const budget = /species-distribution/.test(name)
    ? 3 * 1024 * 1024
    : /hotspots-ebird[\\/]/.test(file)
      ? 3 * 1024 * 1024
      : MAX_BYTES
  checkCommon(name, raw, data, budget, { shard: isNearbyShard(data, file) })
  if (Array.isArray(data.tiers)) errors.push(`${name}: tiers 必须是对象`)
  else if (data.tiers || data.sharding) {
    // 036 省级常见度（分片产物）：索引 + 分片
    checkProvinceCommonness(name, data)
    if (data.sharding) {
      const dir = path.join(path.dirname(file), data.sharding.dir)
      const onDisk = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'))
      // 2026-10-23 用户定：档位分片**只推 R2、不进 git**（~22-25MB）→ 新克隆/CI 上没有分片，
      // 整个目录缺失时跳过闭环校验并提示（本地构建过就会有，门禁照常生效）。
      if (!onDisk.length) {
        console.log(`  · ${name}: 分片未在本地产出（只推 R2）→ 跳过 ${data.sharding.files?.length ?? 0} 片的闭环校验`)
      } else {
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
    }
  } else if (Array.isArray(data.spots) || (data.countries && data.total != null && nearbyFiles.includes(file))) {
    // 039 P1：附近观鸟点（索引 / 分片）
    checkNearbySpots(name, data)
  } else if (data.bySpecies && data.byCountry) checkProvinces(name, data)
  else if (Array.isArray(data.hotspots)) checkHotspots(name, data)
  else if (data.bySpecies) checkSeasonality(name, data)
  else if (data.byCountry && data.counts?.pairs != null) checkDistributionGlobal(name, data, indexCodes)
  else errors.push(`${name}: 无法识别的产物形状`)
}

// ── P1-6 / P0-5：分片产物的索引 → 目录闭环（2026-10-23） ────────────────
for (const { kind, file } of shardedIndexes) {
  const raw = await fs.readFile(file, 'utf8').catch(() => null)
  if (raw === null) continue
  const name = path.relative(path.join(ROOT, 'public/data'), file)
  present.push(name)
  let data = null
  try {
    data = JSON.parse(raw)
  } catch {
    errors.push(`${name}: 不是合法 JSON`)
    continue
  }
  checkCommon(name, raw, data)
  if (kind === 'region-provinces') {
    checkProvincesIndex(name, data)
    await checkProvincesShards(ROOT, name, data)
  } else {
    await checkCountryRecords(ROOT, name, data)
  }
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
