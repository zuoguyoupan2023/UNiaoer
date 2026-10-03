import { describe, expect, it } from 'vitest'
import { buildSpeciesMap } from '../verify-provinces-lib.mjs'
import {
  aggregateSqlMonths,
  compareHotspotSets,
  compareSeasonality,
  sqlCellsToHotspots,
} from '../verify-sql-lib.mjs'

const speciesMap = buildSpeciesMap([
  { id: 'pycnonotus-sinensis', nameSci: 'Pycnonotus sinensis' },
  { id: 'tyto-alba', nameSci: 'Tyto alba' },
])

describe('aggregateSqlMonths / compareSeasonality', () => {
  it('按月聚合、亚种归并；对比存在月份', () => {
    const agg = aggregateSqlMonths(
      [
        { scientificname: 'Tyto alba (Scopoli)', month: '5', n: '10' },
        { scientificname: 'Tyto alba alba', month: '5', n: '2' },
        { scientificname: 'Tyto alba', month: '9', n: '3' },
        { scientificname: 'Unknown x', month: '5', n: '99' },
        { scientificname: 'Tyto alba', month: '13', n: '1' },
      ],
      speciesMap,
    )
    expect(agg.bySpecies['tyto-alba']).toEqual({ 5: 12, 9: 3 })
    expect(agg.mappedRows).toBe(3)
    expect(agg.unmatchedNames.size).toBe(1)

    const stats = compareSeasonality(
      { 'tyto-alba': { months: [0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0] } },
      agg.bySpecies,
    )
    expect(stats.species).toEqual({ existing: 1, sql: 1, both: 1 })
    expect(stats.months).toMatchObject({ existing: 1, sql: 2, both: 1, onlySql: 1 })
  })
})

describe('sqlCellsToHotspots / compareHotspotSets', () => {
  it('阈值过滤 + 中心坐标 + 同格命中', () => {
    const rows = [
      { countrycode: 'US', latb: '340', lngb: '-1183', records: '10', species: '4', observers: '3' },
      { countrycode: 'US', latb: '340', lngb: '-1183', records: '1', species: '1', observers: '1' },
      { countrycode: 'CN', latb: '399', lngb: '1164', records: '8', species: '5', observers: '2' },
    ]
    const hs = sqlCellsToHotspots(rows, { grid: 0.1, minRecords: 5, minSpecies: 3, minObservers: 3 })
    expect(hs).toHaveLength(1)
    expect(hs[0]).toMatchObject({ country: 'US', recordCount: 10, speciesCount: 4, observerCount: 3 })
    expect(hs[0].lat).toBeCloseTo(34.05, 4)
    expect(hs[0].lng).toBeCloseTo(-118.25, 4)

    const existing = [{ country: 'US', lat: 34.055, lng: -118.245 }]
    const cmp = compareHotspotSets(existing, hs, { grid: 0.1 })
    expect(cmp.counts).toMatchObject({ existing: 1, sql: 1, both: 1, onlyExisting: 0, onlySql: 0 })
  })
})
