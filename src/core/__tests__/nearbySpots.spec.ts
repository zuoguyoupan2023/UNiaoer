import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  _resetNearbyCache,
  availableCountries,
  distanceKm,
  fetchCoarseGeo,
  loadNearbyCountry,
  nearbySpots,
  type NearbyCountryFile,
  type NearbyIndex,
} from '../nearbySpots'

afterEach(() => {
  _resetNearbyCache()
  vi.unstubAllGlobals()
})

const spot = (i: string, lat: number, lng: number, p?: number, extra: Record<string, unknown> = {}) => ({
  i,
  n: `Spot ${i}`,
  lat,
  lng,
  ...(p != null ? { p } : {}),
  ...extra,
})

const file: NearbyCountryFile = {
  cc: 'CN',
  count: 4,
  grids: { 'CN-g1-39_116': { r: 28504, s: 320, top: [{ id: 'sp-01', count: 900 }] } },
  spots: [
    spot('A', 39.9, 116.4, 200, { grid: 'CN-g1-39_116', km: 5, sub: 'CN-11' }),
    spot('B', 39.95, 116.45, 150),
    spot('C', 40.5, 117.0, 300),
    spot('D', 31.2, 121.5, 180),
  ],
}

describe('distanceKm', () => {
  it('同点距离 0；已知城市对距离正确（1% 容差）', () => {
    expect(distanceKm(39.9, 116.4, 39.9, 116.4)).toBe(0)
    // 北京 → 上海 约 1067 km
    const d = distanceKm(39.9042, 116.4074, 31.2304, 121.4737)
    expect(d).toBeGreaterThan(1055)
    expect(d).toBeLessThan(1080)
  })

  it('跨经度 180 与南半球也成立', () => {
    expect(distanceKm(0, 179.9, 0, -179.9)).toBeLessThan(30)
    expect(distanceKm(-33.87, 151.21, -37.81, 144.96)).toBeGreaterThan(700) // 悉尼→墨尔本
  })
})

describe('nearbySpots', () => {
  it('按距离升序，且只保留半径内的点', () => {
    const hits = nearbySpots(file, 39.9, 116.4, { radiusKm: 25 })
    expect(hits.map((h) => h.i)).toEqual(['A', 'B']) // C 约 70km、D 约 1000+km 都被排除
    expect(hits[0]!.distanceKm).toBeLessThanOrEqual(hits[1]!.distanceKm)
    expect(hits[0]!.distanceKm).toBe(0)
  })

  it('半径切换改变结果；近邻优先于记录数', () => {
    // 夹具实测：A→B 7km、A→C 84km、A→D 1071km
    expect(nearbySpots(file, 39.9, 116.4, { radiusKm: 5 }).map((h) => h.i)).toEqual(['A'])
    expect(nearbySpots(file, 39.9, 116.4, { radiusKm: 10 }).map((h) => h.i)).toEqual(['A', 'B'])
    expect(nearbySpots(file, 39.9, 116.4, { radiusKm: 25 }).map((h) => h.i)).toEqual(['A', 'B'])
    const wide = nearbySpots(file, 39.9, 116.4, { radiusKm: 100 })
    expect(wide.map((h) => h.i)).toEqual(['A', 'B', 'C'])
    // B（150 种、7km）排在 C（300 种、84km）之前 —— 距离优先于记录数
    expect(wide[1]!.i).toBe('B')
  })

  it('空/缺数据 → 空数组（不抛错）', () => {
    expect(nearbySpots(null, 39.9, 116.4)).toEqual([])
    expect(nearbySpots({ cc: 'CN', count: 0, grids: {}, spots: [] }, 39.9, 116.4)).toEqual([])
  })

  it('limit 生效（点位密集处不返回长列表）', () => {
    expect(nearbySpots(file, 39.9, 116.4, { radiusKm: 100, limit: 2 })).toHaveLength(2)
  })
})

describe('availableCountries', () => {
  const idx: NearbyIndex = {
    schemaVersion: 1,
    generatedAt: '',
    method: '',
    sources: [],
    minSpecies: 50,
    cellDeg: 0.25,
    perCell: 1,
    gridMaxKm: 120,
    rawTotal: 100,
    total: 10,
    countries: [
      { cc: 'AU', count: 5, grids: 1, bytes: 10 },
      { cc: 'CN', count: 5, grids: 1, bytes: 10 },
    ],
  }
  it('列出有数据的国家；粗定位国家置顶', () => {
    expect(availableCountries(idx)).toEqual(['AU', 'CN'])
    expect(availableCountries(idx, 'cn')).toEqual(['CN', 'AU'])
    expect(availableCountries(idx, 'US')).toEqual(['AU', 'CN']) // 无数据 → 不置顶
    expect(availableCountries(null)).toEqual([])
  })
})

describe('loadNearbyCountry', () => {
  it('非法国家码不发请求', async () => {
    const f = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', f)
    expect(await loadNearbyCountry('XYZ')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('按国缓存：同国只请求一次', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => file } as Response)
    vi.stubGlobal('fetch', f)
    await loadNearbyCountry('cn')
    await loadNearbyCountry('CN')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('网络失败 → null（页面显示空态而非报错）', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
    expect(await loadNearbyCountry('CN')).toBeNull()
  })
})

describe('fetchCoarseGeo', () => {
  it('located=false（无 cf 地理）→ { located: false }', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => ({ ok: true, located: false }) } as Response))
    expect(await fetchCoarseGeo()).toEqual({ located: false })
  })

  it('located=true 带坐标 → 透传（含精度与国家）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, located: true, lat: 39.9, lng: 116.4, country: 'CN', precisionDeg: 0.05 }),
      } as Response),
    )
    expect(await fetchCoarseGeo()).toEqual({ located: true, lat: 39.9, lng: 116.4, country: 'CN', precisionDeg: 0.05 })
  })

  it('located=true 但坐标缺失 → 退化为 { located: false }（不返回半截坐标）', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => ({ ok: true, located: true }) } as Response))
    expect(await fetchCoarseGeo()).toEqual({ located: false })
  })

  it('接口失败 → null（调用方回退手动选国家）', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue({ ok: false, json: async () => ({}) } as Response))
    expect(await fetchCoarseGeo()).toBeNull()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('boom')))
    expect(await fetchCoarseGeo()).toBeNull()
  })
})
