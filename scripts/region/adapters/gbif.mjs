/**
 * 021 §2.2 GBIF adapter（纯函数，不碰网络/文件系统，可单测）。
 * occurrence/search 的 facet 响应 → 统一 RegionRecord（§2.2）。
 * 说明：GBIF facet 为聚合桶，无法交叉制表（country × stateProvince 需按国家分开查）。
 */

/** 归一化 facet 名：GBIF 返回 STATE_PROVINCE，调用方写 stateProvince */
const normField = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase()

/** occurrence/search `facet=<field>` 响应 → [{ name, count }]，按 count 降序，空名过滤 */
export function facetCounts(payload, field) {
  const want = normField(field)
  const facet = (payload?.facets || []).find((f) => normField(f?.field) === want)
  return (facet?.counts || [])
    .map((c) => ({ name: String(c?.name ?? '').trim(), count: Number(c?.count) || 0 }))
    .filter((c) => c.name && c.count > 0)
    .sort((a, b) => b.count - a.count)
}

/**
 * 省级 facet（stateProvince）→ RegionRecord[]（kind:'record'，逐条带 count）。
 * country 为 ISO alpha-2；GBIF 的 stateProvince 是自由文本，无稳定 code（eBird 合并时再映射）。
 */
export function provinceRecords(payload, { speciesId, country, source = 'gbif', fetchedAt = null } = {}) {
  if (!country) throw new Error('gbif adapter: country 必填（facet 需按国家查询）')
  return facetCounts(payload, 'stateProvince').map((c) => ({
    speciesId,
    region: { country, subnational1: c.name },
    kind: 'record',
    count: c.count,
    source,
    fetchedAt,
  }))
}

/**
 * occurrence/search `results` → 带坐标观测点（021 M4 腿 B 网格聚合输入）。
 * 只做字段搬运与坐标有效性过滤；物种映射（key/学名 → manifest id）由调用方完成。
 * 过滤圈养/逃逸/栽培由上游查询参数负责（不在此处推断）。
 */
export function occurrencePoints(payload, { source = 'gbif' } = {}) {
  return (payload?.results || [])
    .map((r) => ({
      key: r.key,
      speciesKey: r.speciesKey ?? r.acceptedTaxonKey ?? r.taxonKey ?? null,
      sci: r.species || r.acceptedScientificName || r.scientificName || null,
      lat: r.decimalLatitude,
      lng: r.decimalLongitude,
      country: r.countryCode || r.country || null,
      subnational1: r.stateProvince || null,
      observer: r.recordedBy || null,
      date: r.eventDate || null,
      source,
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
}

/**
 * 试点/构建统计：把「物种×国家」查询结果汇总成覆盖率指标。
 * rows: [{ country, present, provinceCount, records }]
 *   present   —— 该国该种总记录数 > 0（GBIF payload.count）
 *   province  —— 有 stateProvince 的记录数（provinceRecords 长度>0）
 * 区分「物种不在该国」与「在但省级字段缺失」，fillRate 只在 present 内计算（R-021-1）。
 */
export function fillSummary(rows) {
  const byCountry = {}
  for (const { country, present, provinceCount = 0, records = 0 } of rows) {
    const a = (byCountry[country] ??= {
      species: 0,
      present: 0,
      withProvince: 0,
      totalRecords: 0,
    })
    a.species++
    if (present) {
      a.present++
      a.totalRecords += records
      if (provinceCount > 0) a.withProvince++
    }
  }
  const out = {}
  for (const [country, a] of Object.entries(byCountry)) {
    out[country] = {
      species: a.species,
      present: a.present,
      withProvince: a.withProvince,
      provinceFillRate: a.present ? Math.round((a.withProvince / a.present) * 100) : 0,
      presenceRate: a.species ? Math.round((a.present / a.species) * 100) : 0,
      totalRecords: a.totalRecords,
    }
  }
  return out
}
