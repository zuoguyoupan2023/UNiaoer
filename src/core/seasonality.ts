/** 季节性数据（021 M1）：public/data/seasonality.json，按需加载、失败静默为 null（UI 隐藏整块） */
export interface SeasonalityEntry {
  /** 12 个月的出现强度（0–100；多源逐月取最大份额，避免同源重复计数） */
  months: number[]
  /** 底层记录量（单源最大口径，透明度用） */
  recordCount: number
  sources: string[]
  /** 权威居留型（021 M3：郑光美体系数据集；resident/summer/winter/passage/vagrant） */
  range?: string[]
}

export interface SeasonalityData {
  schemaVersion: number
  generatedAt: string
  method: string
  sources: string[]
  speciesCount: number
  bySpecies: Record<string, SeasonalityEntry>
}

let cache: Promise<SeasonalityData | null> | null = null

/** 加载季节性数据；失败/不存在返回 null，不阻塞页面 */
export function loadSeasonality(): Promise<SeasonalityData | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/seasonality.json`)
    .then((r) => (r.ok ? (r.json() as Promise<SeasonalityData>) : null))
    .catch(() => null)
  return cache
}

/** 取单物种条目；无数据/形状不合法返回 null（薄数据不出块） */
export function seasonalityOf(
  data: SeasonalityData | null,
  speciesId: string,
): SeasonalityEntry | null {
  if (!data) return null
  const e = data.bySpecies[speciesId]
  return e && Array.isArray(e.months) && e.months.length === 12 ? e : null
}
