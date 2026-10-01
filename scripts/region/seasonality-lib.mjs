/**
 * 021 §2.2 归一化纯函数（不碰网络/文件系统，可单测）。
 * 口径约定（021 §2.5）：不知情不编造——源没有的字段留空；多源合并取逐月最大
 * 份额（iNat 记录亦会进 GBIF，取最大避免同源重复计数抬高峰值）。
 */

/** '2021-04-11' / '2021-04' / ISO 日期 → 月份 1..12；无效返回 null */
export function monthOf(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})/)
  const n = m ? Number(m[2]) : 0
  return n >= 1 && n <= 12 ? n : null
}

/** 素材数组 → 12 个月计数（只统计带 month 的素材；缺月份不计入） */
export function countsFromMedia(assets) {
  const counts = Array(12).fill(0)
  for (const a of assets || []) {
    const m = a && a.month
    if (m >= 1 && m <= 12) counts[m - 1]++
  }
  return counts
}

/** GBIF occurrence/search facet=month 响应 → 12 个月计数 */
export function countsFromGbifFacet(payload) {
  const counts = Array(12).fill(0)
  const facet = (payload?.facets || []).find((f) => String(f.field || '').toUpperCase() === 'MONTH')
  for (const c of facet?.counts || []) {
    const m = Number(c.name)
    if (m >= 1 && m <= 12) counts[m - 1] = c.count
  }
  return counts
}

/** 月计数 → 份额（0..100 整数；总量 0 → 全 0，不编造） */
export function toShare(counts) {
  const total = counts.reduce((s, n) => s + n, 0)
  if (!total) return Array(12).fill(0)
  return counts.map((n) => Math.round((n / total) * 100))
}

/** 多源份额合并：逐月取最大 */
export function mergeShares(vecs) {
  const out = Array(12).fill(0)
  for (const v of vecs || []) {
    for (let i = 0; i < 12; i++) out[i] = Math.max(out[i], v[i] || 0)
  }
  return out
}

/**
 * 汇总为 seasonality.json 的 bySpecies 条目。
 * countsBySource: { gbif: counts[12], xc: counts[12], inat: counts[12], ... }
 * recordCount 取单源最大口径（各源底层记录总量取 max；不跨源求和以免重复计数）。
 * 无任何有效数据返回 null（薄数据不出条目，UI 自动隐藏）。
 */
export function buildEntry(countsBySource) {
  const sources = Object.keys(countsBySource || {})
    .filter((s) => (countsBySource[s] || []).some(Boolean))
    .sort()
  if (!sources.length) return null
  const shares = sources.map((s) => toShare(countsBySource[s]))
  const recordCount = Math.max(
    ...sources.map((s) => countsBySource[s].reduce((a, b) => a + b, 0)),
  )
  return { months: mergeShares(shares), recordCount, sources }
}
