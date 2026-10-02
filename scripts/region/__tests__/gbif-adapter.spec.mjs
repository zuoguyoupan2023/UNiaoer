import { describe, expect, it } from 'vitest'
import { facetCounts, fillSummary, provinceRecords } from '../adapters/gbif.mjs'

const payload = {
  count: 123,
  facets: [
    { field: 'COUNTRY', counts: [{ name: 'US', count: 9 }] },
    {
      field: 'STATE_PROVINCE',
      counts: [
        { name: 'California', count: 50 },
        { name: 'New York', count: 70 },
        { name: '', count: 5 },
        { name: 'Nowhere', count: 0 },
      ],
    },
  ],
}

describe('facetCounts', () => {
  it('取目标 facet、降序、去空名/0 值', () => {
    expect(facetCounts(payload, 'stateProvince')).toEqual([
      { name: 'New York', count: 70 },
      { name: 'California', count: 50 },
    ])
  })
  it('无 facet → 空数组', () => {
    expect(facetCounts(null, 'MONTH')).toEqual([])
    expect(facetCounts({}, 'MONTH')).toEqual([])
  })
})

describe('provinceRecords', () => {
  it('映射为 kind:record 的 RegionRecord，缺 country 抛错', () => {
    const recs = provinceRecords(payload, { speciesId: 'sp-01', country: 'US' })
    expect(recs).toHaveLength(2)
    expect(recs[0]).toMatchObject({
      speciesId: 'sp-01',
      region: { country: 'US', subnational1: 'New York' },
      kind: 'record',
      count: 70,
      source: 'gbif',
    })
    expect(() => provinceRecords(payload, { speciesId: 'sp-01' })).toThrow(/country/)
  })
})

describe('fillSummary', () => {
  it('存在率与省级填率分开计算（物种不在该国不计入填率分母）', () => {
    const s = fillSummary([
      { country: 'US', present: true, provinceCount: 3, records: 100 },
      { country: 'US', present: true, provinceCount: 0, records: 10 },
      { country: 'US', present: false, provinceCount: 0, records: 0 },
      { country: 'JP', present: true, provinceCount: 1, records: 5 },
    ])
    expect(s.US).toMatchObject({ species: 3, present: 2, withProvince: 1, provinceFillRate: 50, presenceRate: 67 })
    expect(s.JP).toMatchObject({ species: 1, present: 1, provinceFillRate: 100, presenceRate: 100 })
  })
})
