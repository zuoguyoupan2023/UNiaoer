import { describe, expect, it } from 'vitest'
import { aggregateHotspots, applyEbirdNames, buildHotspotIndex, cellKey, indexedNearest } from '../hotspots-lib.mjs'

const rec = (o) => ({
  key: o.key ?? Math.random().toString(36).slice(2),
  speciesId: o.speciesId,
  sci: o.sci,
  lat: o.lat,
  lng: o.lng,
  country: o.country ?? 'US',
  subnational1: o.sub,
  observer: o.observer,
  date: o.date,
  source: o.source ?? 'gbif',
  ...o,
})

describe('cellKey', () => {
  it('按网格取 floor，负坐标同样成立', () => {
    expect(cellKey(34.05, -118.25, 0.1)).toBe('340_-1183')
    expect(cellKey(34.06, -118.24, 0.1)).toBe('340_-1183')
    expect(cellKey(47.6, -122.3, 0.1)).toBe('476_-1223')
    expect(cellKey(39.9, 116.4, 1)).toBe('39_116')
  })
})

describe('aggregateHotspots', () => {
  it('已知输入 → 已知网格：分格、计数、代表鸟种、中心坐标', () => {
    const out = aggregateHotspots(
      [
        rec({ speciesId: 'sp-01', lat: 34.05, lng: -118.25, observer: 'A', date: '2024-05-01', sub: 'California' }),
        rec({ speciesId: 'sp-02', lat: 34.06, lng: -118.24, observer: 'B', date: '2024-05-02', sub: 'California' }),
        rec({ speciesId: 'sp-01', lat: 47.6, lng: -122.3, observer: 'C', date: '2024-06-01', sub: 'Washington' }),
      ],
      { grid: 0.1, minRecords: 1, minSpecies: 1, minObservers: 0 },
    )
    expect(out).toHaveLength(2)
    const la = out.find((h) => h.subnational1 === 'California')
    expect(la).toMatchObject({ country: 'US', speciesCount: 2, recordCount: 2, observerCount: 2 })
    expect(la.lat).toBeCloseTo(34.055, 4)
    expect(la.lng).toBeCloseTo(-118.245, 4)
    expect(la.topSpecies.map((s) => s.id).sort()).toEqual(['sp-01', 'sp-02'])
    // recordCount 降序；并列时按 id
    expect(out[0].recordCount).toBeGreaterThanOrEqual(out[1].recordCount)
  })

  it('去重：同 observer 同日同格算一条记录，物种仍分别计入', () => {
    const out = aggregateHotspots(
      [
        rec({ speciesId: 'sp-01', lat: 39.9, lng: 116.4, observer: 'X', date: '2024-05-01T08:00' }),
        rec({ speciesId: 'sp-01', lat: 39.91, lng: 116.41, observer: 'X', date: '2024-05-01T18:00' }),
        rec({ speciesId: 'sp-02', lat: 39.92, lng: 116.42, observer: 'X', date: '2024-05-01T09:00' }),
      ],
      { grid: 0.1, minRecords: 1, minSpecies: 1, minObservers: 0 },
    )
    expect(out).toHaveLength(1)
    expect(out[0].recordCount).toBe(1) // 同一人同日同格 → 1 条
    expect(out[0].speciesCount).toBe(2)
    expect(out[0].observerCount).toBe(1)
    expect(out[0].topSpecies[0]).toMatchObject({ id: 'sp-01', count: 2 })
  })

  it('阈值过滤：records/species/observers 任一不达标即不成点', () => {
    const base = [
      rec({ speciesId: 'sp-01', lat: 1.1, lng: 2.1, observer: 'A', date: '2024-01-01' }),
      rec({ speciesId: 'sp-02', lat: 1.1, lng: 2.1, observer: 'B', date: '2024-01-01' }),
    ]
    expect(aggregateHotspots(base, { grid: 1, minRecords: 3 })).toHaveLength(0)
    expect(aggregateHotspots(base, { grid: 1, minSpecies: 3 })).toHaveLength(0)
    expect(aggregateHotspots(base, { grid: 1, minObservers: 3 })).toHaveLength(0)
    expect(aggregateHotspots(base, { grid: 1, minObservers: 2 })).toHaveLength(1)
  })

  it('学名回退与缺国家：无 manifest id 用 sci；无 country 的点丢弃', () => {
    const out = aggregateHotspots(
      [
        rec({ sci: 'Testus birdus', lat: 10.0, lng: 20.0, observer: 'A', date: '2024-01-01' }),
        rec({ speciesId: 'sp-09', lat: 11, lng: 21, observer: 'A', date: '2024-01-01', country: undefined }),
      ],
      { grid: 1, minRecords: 1 },
    )
    expect(out).toHaveLength(1)
    expect(out[0].topSpecies[0]).toEqual({ sci: 'Testus birdus', count: 1 })
  })

  it('非法 grid 抛错；非有限坐标跳过', () => {
    expect(() => aggregateHotspots([], { grid: 0 })).toThrow(/grid/)
    const out = aggregateHotspots(
      [rec({ speciesId: 'sp-01', lat: NaN, lng: 1 }), rec({ speciesId: 'sp-02', lat: 1, lng: 2, observer: 'A' })],
      { grid: 1 },
    )
    expect(out).toHaveLength(1)
    expect(out[0].speciesCount).toBe(1)
  })
})

describe('applyEbirdNames', () => {
  const ebird = [
    { id: 'L1', name: 'Near Park', country: 'CN', lat: 39.95, lng: 116.05, sourceUrl: 'https://ebird.org/hotspot/L1' },
    { id: 'L2', name: 'Far Park', country: 'CN', lat: 40.5, lng: 116.5, sourceUrl: 'https://ebird.org/hotspot/L2' },
  ]
  it('无名点就近命名并把 ebird 计入 sources；已有名/无近点不动', () => {
    const out = applyEbirdNames(
      [
        { id: 'a', name: undefined, country: 'CN', lat: 39.949, lng: 116.049, sources: ['xeno-canto'] },
        { id: 'b', name: '已有名', country: 'CN', lat: 39.949, lng: 116.049, sources: ['xeno-canto'] },
        { id: 'c', name: undefined, country: 'GB', lat: 20, lng: 30, sources: ['gbif'] },
      ],
      ebird,
      { maxKm: 3 },
    )
    expect(out[0]).toMatchObject({ name: 'Near Park', ebirdId: 'L1', sources: ['ebird', 'xeno-canto'] })
    expect(out[1]).toEqual({ id: 'b', name: '已有名', country: 'CN', lat: 39.949, lng: 116.049, sources: ['xeno-canto'] })
    expect(out[2]).toEqual({ id: 'c', name: undefined, country: 'GB', lat: 20, lng: 30, sources: ['gbif'] })
  })
})

describe('buildHotspotIndex / indexedNearest', () => {
  it('分桶后只在邻近桶找最近点，跨桶也命中', () => {
    const spots = [
      { id: 'a', lat: 39.9, lng: 116.4 },
      { id: 'b', lat: 40.01, lng: 116.4 },
      { id: 'far', lat: 10, lng: 10 },
    ]
    const idx = buildHotspotIndex(spots, { bucketDeg: 0.05 })
    expect(indexedNearest(idx, 39.949, 116.401, 10)?.id).toBe('a')
    expect(indexedNearest(idx, 40.005, 116.401, 10)?.id).toBe('b')
    expect(indexedNearest(idx, 0, 0, 10)).toBeNull()
  })
})
