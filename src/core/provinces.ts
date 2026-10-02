/**
 * 外国省级层（021 M2）：public/data/region-provinces.json，按需加载、失败静默为 null。
 * 数据由 GBIF stateProvince + ISO 3166-2 归一化构建（见 scripts/region/build-provinces.mjs）。
 */
export interface ProvinceSource {
  key: string
  name: string
  url: string
  license: string
  attribution: string
}

export interface ProvinceData {
  schemaVersion: number
  generatedAt: string
  method: string
  sources: ProvinceSource[]
  countries: string[]
  /** 国家码 → { ISO 3166-2 code: 展示名 } */
  byCountry: Record<string, Record<string, string>>
  /** 物种 id → 国家码 → { ISO code: 记录数 } */
  bySpecies: Record<string, Record<string, Record<string, number>>>
}

let cache: Promise<ProvinceData | null> | null = null

/** 加载省级数据；失败/不存在返回 null，不阻塞页面 */
export function loadProvinces(): Promise<ProvinceData | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/region-provinces.json`)
    .then((r) => (r.ok ? (r.json() as Promise<ProvinceData>) : null))
    .catch(() => null)
  return cache
}

/** 该国省级列表（按展示名排序）；无数据返回 [] */
export function provincesOf(data: ProvinceData | null, country: string): { code: string; name: string }[] {
  const map = data?.byCountry?.[country]
  if (!map) return []
  return Object.entries(map)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 某物种在某国某省的记录数；无则 0 */
export function provinceCount(data: ProvinceData | null, speciesId: string, country: string, code: string): number {
  return data?.bySpecies?.[speciesId]?.[country]?.[code] ?? 0
}

/** 该省有记录的物种 id 集合（用于过滤） */
export function speciesInProvince(data: ProvinceData | null, country: string, code: string): Set<string> {
  const out = new Set<string>()
  if (!data || !code) return out
  for (const [spId, byCc] of Object.entries(data.bySpecies || {})) {
    if (byCc?.[country]?.[code]) out.add(spId)
  }
  return out
}
