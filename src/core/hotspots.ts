/**
 * 观鸟点（021 M4 腿 B）：public/data/hotspots.json，按需加载、失败静默为 null（整块隐藏）。
 * 数据由 GBIF 带坐标观测按网格聚合（见 scripts/region/build-hotspots.mjs）——统计层，非人工名录。
 */
export interface HotspotSource {
  key: string
  name: string
  url: string
  license: string
  attribution: string
}

export interface HotspotTopSpecies {
  /** manifest 物种 id（可反查本地化名）；缺省时用 sci */
  id?: string
  sci?: string
  count: number
}

export interface Hotspot {
  id: string
  /** 展示名（腿 B 由网格内多数 stateProvince 生成；腿 A eBird 名录有名） */
  name?: string
  lat: number
  lng: number
  country: string
  subnational1?: string
  speciesCount: number
  recordCount: number
  observerCount: number
  topSpecies: HotspotTopSpecies[]
  sources: string[]
}

export interface HotspotData {
  schemaVersion: number
  generatedAt: string
  method: string
  grid: number
  thresholds: { minRecords: number; minSpecies: number; minObservers: number }
  sources: HotspotSource[]
  countries: string[]
  hotspotCount: number
  hotspots: Hotspot[]
}

let cache: Promise<HotspotData | null> | null = null

/** 加载观鸟点数据；失败/不存在返回 null，不阻塞页面 */
export function loadHotspots(): Promise<HotspotData | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/hotspots.json`)
    .then((r) => (r.ok ? (r.json() as Promise<HotspotData>) : null))
    .catch(() => null)
  return cache
}

/** 该国观鸟点（recordCount 降序，同数量按 id） */
export function hotspotsOf(data: HotspotData | null, country: string): Hotspot[] {
  if (!data?.hotspots || !country) return []
  return data.hotspots
    .filter((h) => h.country === country)
    .sort((a, b) => b.recordCount - a.recordCount || a.id.localeCompare(b.id))
}
