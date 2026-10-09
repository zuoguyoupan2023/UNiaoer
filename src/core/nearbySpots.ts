/**
 * 039 P1：附近观鸟点（前端消费层）。
 *
 * 数据：`public/data/hotspots-ebird/index.json` + `<CC>.json`（按国懒加载；构建见
 * `scripts/region/build-ebird-hotspots.mjs`——eBird 派生子集 + GBIF 网格统计去重共享）。
 * 定位：`GET /api/geo`（Worker 从 `request.cf` 取 IP 粗定位，四舍五入 0.05°≈5km；
 * **不落库、不进日志**）；也可由浏览器精定位（米级，仅存内存，见 docs/039 §2.1）。
 *
 * 距离一律本地算（haversine）——坐标不出设备、零第三方运行时依赖、可离线复用 SW 缓存。
 */

/** 与构建脚本 `o`（short name）字段一一对应；改这里要同步 scripts/region/build-ebird-hotspots.mjs */
export interface NearbySpot {
  /** eBird hotspot locId（可派生 https://ebird.org/hotspot/<i>） */
  i: string
  n: string | null
  lat: number
  lng: number
  /** ISO 3166-2 省码 */
  sub?: string
  /** 该点记录过的鸟种数（numSpeciesAllTime） */
  p?: number
  /** 最近记录日期（YYYY-MM-DD） */
  o?: string
  /** 最近的 GBIF 1° 网格 id（共享统计，见 grids） */
  grid?: string
  /** 与该网格中心的距离（km） */
  km?: number
}

/** GBIF 1° 网格统计（同国多点多格共享，故不在 spot 上重复） */
export interface NearbyGrid {
  /** 记录数 */
  r: number
  /** 物种数 */
  s: number
  /** 代表鸟种（manifest 物种 id 或学名） */
  top?: { id?: string; sci?: string; count: number }[]
}

export interface NearbyCountryFile {
  cc: string
  count: number
  grids: Record<string, NearbyGrid>
  spots: NearbySpot[]
}

export interface NearbySource {
  key: string
  name: string
  url: string
  license: string
  attribution: string
}

export interface NearbyIndex {
  schemaVersion: number
  generatedAt: string
  method: string
  sources: NearbySource[]
  minSpecies: number
  cellDeg: number
  perCell: number
  gridMaxKm: number
  rawTotal: number
  total: number
  countries: { cc: string; count: number; grids: number; bytes: number }[]
}

const BASE = `${import.meta.env.BASE_URL}data/hotspots-ebird`
let indexCache: Promise<NearbyIndex | null> | null = null
const fileCache = new Map<string, Promise<NearbyCountryFile | null>>()

export function loadNearbyIndex(): Promise<NearbyIndex | null> {
  indexCache ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<NearbyIndex>) : null))
    .catch(() => null)
  return indexCache
}

/** 按国加载点位（失败 → null，页面显示空态而不是报错） */
export function loadNearbyCountry(cc: string): Promise<NearbyCountryFile | null> {
  const key = String(cc || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(key)) return Promise.resolve(null)
  let p = fileCache.get(key)
  if (!p) {
    p = fetch(`${BASE}/${key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<NearbyCountryFile>) : null))
      .catch(() => null)
    fileCache.set(key, p)
  }
  return p
}

/** haversine（km） */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export interface NearbyHit extends NearbySpot {
  /** 距查询点的距离（km，1 位小数） */
  distanceKm: number
}

/**
 * 取半径内最近的点（本地算距离）。
 * @param radiusKm 10 / 25 / 50（UI 三档）
 * @param limit 返回上限（默认 30；点位密集处避免长列表）
 */
export function nearbySpots(
  file: NearbyCountryFile | null,
  lat: number,
  lng: number,
  { radiusKm = 25, limit = 30 }: { radiusKm?: number; limit?: number } = {},
): NearbyHit[] {
  if (!file?.spots?.length) return []
  const out: NearbyHit[] = []
  for (const s of file.spots) {
    const d = distanceKm(lat, lng, s.lat, s.lng)
    if (d <= radiusKm) out.push({ ...s, distanceKm: Math.round(d * 10) / 10 })
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm || (b.p ?? 0) - (a.p ?? 0))
  return out.slice(0, limit)
}

/**
 * 有数据的国家清单（UI 的国家下拉只列这些——不在表里的国家没有点位文件，选了也是空态）。
 * `prefer`（如粗定位返回的国家码）命中时置顶。
 */
export function availableCountries(index: NearbyIndex | null, prefer?: string | null): string[] {
  if (!index?.countries?.length) return []
  const list = index.countries.map((c) => c.cc)
  const p = String(prefer || '').toUpperCase()
  if (p && list.includes(p)) return [p, ...list.filter((c) => c !== p)]
  return list
}

export interface GeoResult {
  located: boolean
  lat?: number
  lng?: number
  country?: string | null
  /** 精度（度）；0.05 ≈ 5km */
  precisionDeg?: number
}

/** Worker `/api/geo` 的响应形状（比 GeoResult 多一个 ok 标志） */
interface GeoResponse extends GeoResult {
  ok?: boolean
}

/**
 * 取粗定位（Worker `/api/geo`）。失败/无位置 → null（调用方回退手动选地区）。
 * 注意：**不缓存结果**（避免把某个人的位置留在内存里复用给下一个人）。
 */
export async function fetchCoarseGeo(): Promise<GeoResult | null> {
  try {
    const r = await fetch('/api/geo', { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as GeoResponse
    if (j?.ok === false || typeof j?.located !== 'boolean') return null
    if (!j.located) return { located: false }
    if (!Number.isFinite(j.lat) || !Number.isFinite(j.lng)) return { located: false }
    return { located: true, lat: j.lat, lng: j.lng, country: j.country ?? null, precisionDeg: j.precisionDeg }
  } catch {
    return null
  }
}

/** 设备精定位（需用户点击 + 系统授权；坐标只在本函数返回值里，不落任何存储） */
export function fetchPreciseGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

/** 测试用：清缓存 */
export function _resetNearbyCache(): void {
  indexCache = null
  fileCache.clear()
}
