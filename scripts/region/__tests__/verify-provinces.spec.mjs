import { describe, expect, it } from 'vitest'
import { buildIndex } from '../adapters/iso3166.mjs'
import { aggregateSqlRows, buildSpeciesMap, compareProvinces, normBinomial } from '../verify-provinces-lib.mjs'

const subs = {
  US: { 'US-CA': 'California', 'US-WA': 'Washington' },
  CN: { 'CN-11': 'Beijing', 'CN-44': 'Guangdong' },
}
const index = buildIndex(subs)
const speciesMap = buildSpeciesMap([
  { id: 'pycnonotus-sinensis', nameSci: 'Pycnonotus sinensis' },
  { id: 'tyto-alba', nameSci: 'Tyto alba' },
])

describe('normBinomial', () => {
  it('去作者/亚种/变音符，取前两词', () => {
    expect(normBinomial('Pycnonotus sinensis (Gmelin, 1789)')).toBe('pycnonotus sinensis')
    expect(normBinomial('Lamprotornis splendidus splendidus (Vieillot, 1822)')).toBe('lamprotornis splendidus')
    expect(normBinomial('Tōkyō')).toBe('tokyo')
    expect(normBinomial('')).toBe('')
  })
})

describe('aggregateSqlRows', () => {
  it('学名映射 + 省级名映射，亚种归并累加；未匹配计数', () => {
    const out = aggregateSqlRows(
      [
        { countrycode: 'US', stateprovince: 'California', scientificname: 'Tyto alba (Scopoli, 1769)', n: '10' },
        { countrycode: 'us', stateprovince: 'California', scientificname: 'Tyto alba alba', n: '5' },
        { countrycode: 'CN', stateprovince: 'Guangdong', scientificname: 'Pycnonotus sinensis (Gmelin)', n: '7' },
        { countrycode: 'CN', stateprovince: 'Nowhere', scientificname: 'Pycnonotus sinensis', n: '3' },
        { countrycode: 'US', stateprovince: 'California', scientificname: 'Unknown species', n: '9' },
      ],
      { index, speciesMap },
    )
    expect(out.bySpecies['tyto-alba']).toEqual({ US: { 'US-CA': 15 } })
    expect(out.bySpecies['pycnonotus-sinensis']).toEqual({ CN: { 'CN-44': 7 } })
    expect(out.mappedRows).toBe(3)
    expect(out.totalRows).toBe(5)
    expect([...out.unmatchedProvinces.keys()]).toEqual(['CN\tNowhere'])
    expect([...out.unmatchedNames.keys()]).toEqual(['Unknown species'])
  })
})

describe('compareProvinces', () => {
  it('单元格三级分类 + 记录数汇总', () => {
    const existing = { a: { US: { 'US-CA': 100, 'US-WA': 50 } } }
    const sql = { a: { US: { 'US-CA': 120 } }, b: { CN: { 'CN-11': 5 } } }
    const s = compareProvinces(existing, sql)
    expect(s.species).toEqual({ existing: 1, sql: 2, both: 1 })
    expect(s.cells).toEqual({ existing: 2, sql: 2, both: 1, onlyExisting: 1, onlySql: 1 })
    expect(s.records).toMatchObject({ existing: 150, sql: 125, bothExisting: 100, bothSql: 120 })
    expect(s.byCountry.US).toMatchObject({ cellsBoth: 1, cellsExisting: 2, cellsSql: 1 })
    expect(s.byCountry.CN).toMatchObject({ cellsSql: 1, cellsExisting: 0 })
  })
})
