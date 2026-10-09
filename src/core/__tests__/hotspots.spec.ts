import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  _resetHotspotCache,
  ebirdHotspotUrl,
  hotspotsInProvince,
  loadCountrySpots,
  loadHotspots,
  spotsOf,
  type CountrySpots,
} from '../hotspots'

afterEach(() => {
  _resetHotspotCache()
  vi.unstubAllGlobals()
})

const file: CountrySpots = {
  cc: 'CN',
  grids: { 'CN-g1-39_116': { r: 28504, s: 320, top: [{ id: 'sp-01', count: 900 }] } },
  spots: [
    { i: 'L1001', n: '颐和园', lat: 39.95, lng: 116.35, sub: 'CN-11', p: 270, o: '2026-09-29', grid: 'CN-g1-39_116', km: 8 },
    { i: 'L1002', n: '九连山', lat: 24.5, lng: 114.5, sub: 'CN-36', p: 180 },
    { i: 'L1003', n: null, lat: 31.2, lng: 121.5, sub: 'CN-31', p: 40, o: '2026-05-01' },
  ],
}

describe('spotsOf', () => {
  it('归一：点位 → 展示字段（含网格统计挂接与来源）', () => {
    const out = spotsOf(file)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({
      id: 'L1001',
      name: '颐和园',
      country: 'CN',
      subnational1: 'CN-11',
      speciesCount: 270,
      latestObs: '2026-09-29',
      gridRecords: 28504,
      gridKm: 8,
    })
    // 有网格统计 → 来源含 gbif；无 → 只有 ebird
    expect(out[0]!.sources).toEqual(['ebird', 'gbif'])
    expect(out[1]!.sources).toEqual(['ebird'])
    expect(out[1]!.topSpecies).toEqual([])
    expect(out[2]!.name).toBeUndefined() // n=null → undefined（模板回退显示坐标）
  })

  it('空/缺数据 → 空数组', () => {
    expect(spotsOf(null)).toEqual([])
    expect(spotsOf({ cc: 'CN', grids: {}, spots: [] })).toEqual([])
  })
})

describe('hotspotsInProvince（省下钻）', () => {
  const spots = spotsOf(file)

  it('按省码过滤', () => {
    expect(hotspotsInProvince(spots, 'CN-11').matched.map((h) => h.id)).toEqual(['L1001'])
    expect(hotspotsInProvince(spots, 'CN-36').matched.map((h) => h.id)).toEqual(['L1002'])
  })

  it('空省码 → 返回全部（unassigned 为空）', () => {
    const all = hotspotsInProvince(spots, '')
    expect(all.matched).toHaveLength(3)
    expect(all.unassigned).toEqual([])
  })

  it('该省无点 → matched 为空（不把别省的点混进来）', () => {
    const none = hotspotsInProvince(spots, 'CN-99')
    expect(none.matched).toEqual([])
    expect(none.unassigned).toEqual([])
  })

  it('无省码的点进 unassigned、不算作该省', () => {
    const withUnassigned = spotsOf({
      cc: 'CN',
      grids: {},
      spots: [{ i: 'L9001', n: '无名点', lat: 30, lng: 110, p: 7 }],
    })
    const r = hotspotsInProvince(withUnassigned, 'CN-11')
    expect(r.matched).toEqual([])
    expect(r.unassigned.map((h) => h.id)).toEqual(['L9001'])
  })

  it('空数组/null 安全', () => {
    expect(hotspotsInProvince([], 'CN-11')).toEqual({ matched: [], unassigned: [] })
    expect(hotspotsInProvince(null as unknown as [], 'CN-11')).toEqual({ matched: [], unassigned: [] })
  })
})

describe('ebirdHotspotUrl', () => {
  it('由 locId 派生官方页链接（不落盘存储该 URL）', () => {
    expect(ebirdHotspotUrl('L1001')).toBe('https://ebird.org/hotspot/L1001')
  })
})

describe('loadCountrySpots / loadHotspots', () => {
  it('非法国家码不发请求', async () => {
    const f = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', f)
    expect(await loadCountrySpots('XYZ')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('按国缓存：同一国只请求一次（大小写不敏感）', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => file } as Response)
    vi.stubGlobal('fetch', f)
    await loadCountrySpots('cn')
    await loadCountrySpots('CN')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('网络失败 → null（页面走空态而非报错）', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
    expect(await loadCountrySpots('CN')).toBeNull()
  })

  it('索引失败 → null；成功 → 透出 sources（署名用）', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue({ ok: false } as Response))
    expect(await loadHotspots()).toBeNull()
    _resetHotspotCache()
    const sources = [{ key: 'ebird', name: 'eBird', url: '', license: '', attribution: '' }]
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => ({ sources }) } as Response),
    )
    expect(await loadHotspots()).toEqual({ sources })
  })
})
