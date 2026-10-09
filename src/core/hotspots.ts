/**
 * 观鸟点（地区浏览 `/region` 与附近页 `/nearby` 共用一套数据）。
 *
 * 数据源：`public/data/hotspots-ebird/<CC>.json`（构建见 `scripts/region/build-ebird-hotspots.mjs`）——
 * **eBird 真实热点点位**的派生子集（`numSpeciesAllTime ≥ 6` + `0.25°` 网格每格 1 个），
 * 带省码、记录鸟种数与最近记录日期；`grid`/`km` 指向最近的 GBIF 1° 网格统计（"这一带有什么"）。
 *
 * 口径变更（2026-10-09）：此前 `/region` 用的是 `hotspots.json`（GBIF 1° 网格聚合 + eBird 就近命名），
 * 点位是"格子"而非常用观鸟点，且 15 国全部**比 eBird 点位稀疏**（CN 706 格 vs 1,929 个真实点位；
 * DE 77 vs 829）。两处改用同一套数据后，`/region` 的观鸟点数、省码覆盖与 `/nearby` 口径一致，
 * 不再出现"省里 12 个 / 全国 706 个"这类来自另一份数据源的数字。
 *
 * 署名（铁律 5）：来源经 `sources[]` 透出（eBird 非商业/需署名/不得再分发原始数据 + GBIF）。
 */
export interface NearbySpotRaw {
  /** eBird hotspot locId（可派生 https://ebird.org/hotspot/<i>） */
  i: string
  n: string | null
  lat: number
  lng: number
  /** ISO 3166-2 省码 */
  sub?: string
  /** 该点记录过的鸟种数 */
  p?: number
  /** 最近记录日期（YYYY-MM-DD） */
  o?: string
  grid?: string
  km?: number
}

export interface NearbyGridRaw {
  r: number
  s: number
  top?: { id?: string; sci?: string; count: number }[]
}

export interface HotspotSource {
  key: string
  name: string
  url: string
  license: string
  attribution: string
}

/** `/region` 展示用的观鸟点（由 NearbySpotRaw 归一而来，字段名沿用页面既有约定） */
export interface Hotspot {
  id: string
  name?: string
  lat: number
  lng: number
  country: string
  subnational1?: string
  /** 该点记录过的鸟种数（eBird numSpeciesAllTime） */
  speciesCount: number
  /** 最近记录日期（YYYY-MM-DD） */
  latestObs?: string
  /** 最近 GBIF 1° 网格的**记录数**（"这一带"的活跃度；非本点记录数） */
  gridRecords?: number
  /** 该网格距本点的距离（km） */
  gridKm?: number
  topSpecies: { id?: string; sci?: string; count: number }[]
  sources: string[]
}

/** 某国点位文件（含共享的网格统计表） */
export interface CountrySpots {
  cc: string
  grids: Record<string, NearbyGridRaw>
  spots: NearbySpotRaw[]
}

/** 索引（只承载署名；点位数据按国单独加载，见 loadCountrySpots） */
export interface HotspotIndex {
  sources: HotspotSource[]
}

const BASE = `${import.meta.env.BASE_URL}data/hotspots-ebird`
let indexCache: Promise<{ sources: HotspotSource[] } | null> | null = null
const fileCache = new Map<string, Promise<CountrySpots | null>>()

/** 加载索引（只取 sources 供署名展示；失败 → null，页面按"无数据"处理） */
export function loadHotspots(): Promise<HotspotIndex | null> {
  indexCache ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<HotspotIndex>) : null))
    .catch(() => null)
  return indexCache
}

/** 按国加载点位（失败 → null；组件对 null 一律走空态） */
export function loadCountrySpots(cc: string): Promise<CountrySpots | null> {
  const key = String(cc || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(key)) return Promise.resolve(null)
  let p = fileCache.get(key)
  if (!p) {
    p = fetch(`${BASE}/${key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<CountrySpots>) : null))
      .catch(() => null)
    fileCache.set(key, p)
  }
  return p
}

/** 归一：点位文件 → 展示用 Hotspot[]（已按物种数降序，与产物一致） */
export function spotsOf(file: CountrySpots | null): Hotspot[] {
  if (!file?.spots?.length) return []
  return file.spots.map((s) => {
    const grid = s.grid ? file.grids?.[s.grid] : undefined
    return {
      id: s.i,
      name: s.n ?? undefined,
      lat: s.lat,
      lng: s.lng,
      country: file.cc,
      subnational1: s.sub,
      speciesCount: s.p ?? 0,
      latestObs: s.o,
      gridRecords: grid?.r,
      gridKm: s.km,
      topSpecies: grid?.top ?? [],
      sources: ['ebird', ...(grid ? ['gbif'] : [])],
    }
  })
}

/** eBird 官方页（由 locId 派生，不落盘存储） */
export const ebirdHotspotUrl = (id: string): string => `https://ebird.org/hotspot/${id}`

/**
 * 某省观鸟点（036/037 地区下钻）：按 `subnational1`（ISO 3166-2 省码）过滤。
 * 数据现状（2026-10-09，eBird 派生集）：15 国点位**全部带省码**（CN 1,929/1,929），
 * 因此不再有"无省码的点"这一档——`unassigned` 恒为空，保留字段是为了兼容与将来数据源变化。
 *
 * 语义：无省码的点**不会**混进某省列表（避免"选上海看到全国"）。
 */
export function hotspotsInProvince(
  spots: Hotspot[] | null | undefined,
  provinceCode: string,
): { matched: Hotspot[]; unassigned: Hotspot[] } {
  const list = spots ?? []
  if (!provinceCode) return { matched: [...list], unassigned: [] }
  const matched: Hotspot[] = []
  const unassigned: Hotspot[] = []
  for (const h of list) {
    if (!h.subnational1) unassigned.push(h)
    else if (h.subnational1 === provinceCode) matched.push(h)
  }
  return { matched, unassigned }
}

/** 测试用：清缓存 */
export function _resetHotspotCache(): void {
  indexCache = null
  fileCache.clear()
}
