/**
 * C7 地区浏览（017）纯逻辑：由 `public/data/distribution.json` 的 `bySpecies`
 * （{ 物种id: [ISO 3166-1 alpha-2 国家码…] }）反查「国家/地区 → 物种」。
 * 国家名的本地化由视图用 Intl.DisplayNames 完成，这里只处理结构，便于单测。
 */

export interface CountryStat {
  code: string
  count: number
}

/** 反查索引：countryCode → speciesId[]（保持输入物种顺序） */
export function buildCountryIndex(bySpecies: Record<string, string[]>): Record<string, string[]> {
  const byCountry: Record<string, string[]> = {}
  for (const [speciesId, codes] of Object.entries(bySpecies)) {
    for (const code of codes) {
      ;(byCountry[code] ??= []).push(speciesId)
    }
  }
  return byCountry
}

/** 国家/地区统计，按物种数降序（同数量按 code 升序，保证顺序稳定） */
export function countryStats(bySpecies: Record<string, string[]>): CountryStat[] {
  const counts = new Map<string, number>()
  for (const codes of Object.values(bySpecies)) {
    for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

/** 过滤国家/地区：匹配代码或本地化名称（大小写不敏感），空查询返回全部 */
export function filterCountries(
  stats: CountryStat[],
  query: string,
  nameOf: (code: string) => string,
): CountryStat[] {
  const q = query.trim().toLowerCase()
  if (!q) return stats
  return stats.filter(
    (s) => s.code.toLowerCase().includes(q) || nameOf(s.code).toLowerCase().includes(q),
  )
}
