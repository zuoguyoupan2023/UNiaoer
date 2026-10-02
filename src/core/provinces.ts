/**
 * 中国+外国省级层（021 M2/M3）：public/data/region-provinces.json，按需加载、失败静默为 null。
 * 数据由 GBIF stateProvince + ISO 3166-2 归一化构建（见 scripts/region/build-provinces.mjs）。
 * CN：内地 31 省=GBIF 记录数；港澳台（CN-71/91/92）按铁律 6 并入并标注，存在性来自 distribution.json。
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
  /** 国家码 → { code: 展示名 }（CN 为中文全称、含港澳台标注名；其余国家为 ISO 英文名） */
  byCountry: Record<string, Record<string, string>>
  /** 英文展示名（仅当与 byCountry 不同时提供，当前仅 CN；provincesOf 按 locale 取用） */
  byCountryAlt?: Record<string, Record<string, string>>
  /** 物种 id → 国家码 → { code: 记录数 } */
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

/** 该国省级列表（按展示名排序）；无数据返回 []。en 优先取 byCountryAlt（如 CN 的港澳台标注名） */
export function provincesOf(
  data: ProvinceData | null,
  country: string,
  locale = 'zh-CN',
): { code: string; name: string }[] {
  const map =
    (locale.startsWith('en') ? data?.byCountryAlt?.[country] : null) ?? data?.byCountry?.[country]
  if (!map) return []
  // 保持 data 内顺序（由构建脚本按 code 排序）；排序交给视图按 sortMode 决定
  return Object.entries(map).map(([code, name]) => ({ code, name }))
}

/**
 * 该国省级列表 + 每省鸟种数（供二级目录按鸟种数排序/展示）。
 * count = 该国该省有记录的物种数（与一级目录的「N 种」同口径）。
 */
export function provinceStats(
  data: ProvinceData | null,
  country: string,
  locale = 'zh-CN',
): { code: string; name: string; count: number }[] {
  const list = provincesOf(data, country, locale)
  if (!list.length) return []
  const counts = new Map<string, number>()
  for (const byCc of Object.values(data?.bySpecies || {})) {
    const m = byCc?.[country]
    if (!m) continue
    for (const code of Object.keys(m)) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return list.map((p) => ({ ...p, count: counts.get(p.code) ?? 0 }))
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
