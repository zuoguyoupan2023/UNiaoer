import { describe, expect, it } from 'vitest'
import {
  buildCountryIndex,
  continentOf,
  countriesInContinent,
  countryStats,
  filterCountries,
  normalizeCountry,
  presentContinents,
} from '../region'

const bySpecies: Record<string, string[]> = {
  a: ['CN', 'JP', 'US'],
  b: ['CN', 'US'],
  c: ['CN'],
  d: ['BR'],
}

describe('normalizeCountry（港澳台并入中国）', () => {
  it('HK/MO/TW → CN，其余原样', () => {
    expect(normalizeCountry('HK')).toBe('CN')
    expect(normalizeCountry('MO')).toBe('CN')
    expect(normalizeCountry('TW')).toBe('CN')
    expect(normalizeCountry('JP')).toBe('JP')
  })
})

describe('continentOf（七大洲归类）', () => {
  it('主要大洲 + 未收录返回 undefined', () => {
    expect(continentOf('CN')).toBe('asia')
    expect(continentOf('DE')).toBe('europe')
    expect(continentOf('US')).toBe('northAmerica')
    expect(continentOf('BR')).toBe('southAmerica')
    expect(continentOf('AU')).toBe('oceania')
    expect(continentOf('AQ')).toBe('antarctica')
    expect(continentOf('DT')).toBeUndefined()
  })

  it('港澳台按中国所在大洲（亚洲）归类', () => {
    expect(continentOf('HK')).toBe('asia')
    expect(continentOf('TW')).toBe('asia')
  })
})

describe('buildCountryIndex（C7 国家→物种反查）', () => {
  it('按国家聚合并保持物种顺序', () => {
    expect(buildCountryIndex(bySpecies)).toEqual({
      CN: ['a', 'b', 'c'],
      JP: ['a'],
      US: ['a', 'b'],
      BR: ['d'],
    })
  })

  it('港澳台并入中国并去重（同一物种不重复计数）', () => {
    expect(buildCountryIndex({ x: ['TW', 'HK', 'MO', 'CN'], y: ['TW'] })).toEqual({
      CN: ['x', 'y'],
    })
  })
})

describe('countryStats（C7 国家统计）', () => {
  it('按物种数降序、同数量按 code 升序', () => {
    expect(countryStats(bySpecies)).toEqual([
      { code: 'CN', count: 3 },
      { code: 'US', count: 2 },
      { code: 'BR', count: 1 },
      { code: 'JP', count: 1 },
    ])
  })
})

describe('filterCountries（C7 国家搜索）', () => {
  const stats = countryStats(bySpecies)
  const nameOf = (c: string) => ({ CN: '中国', US: '美国', JP: '日本', BR: '巴西' })[c] ?? c

  it('空查询返回全部', () => {
    expect(filterCountries(stats, '   ', nameOf)).toHaveLength(stats.length)
  })

  it('按代码或本地化名称匹配（大小写不敏感）', () => {
    expect(filterCountries(stats, 'cn', nameOf).map((s) => s.code)).toEqual(['CN'])
    expect(filterCountries(stats, '中国', nameOf).map((s) => s.code)).toEqual(['CN'])
    expect(filterCountries(stats, '美', nameOf).map((s) => s.code)).toEqual(['US'])
  })
})

describe('countriesInContinent / presentContinents（七大洲筛选）', () => {
  const stats = countryStats({ a: ['CN', 'DE'], b: ['US'], c: ['BR'], d: ['AU'] })

  it('按大洲筛出国家', () => {
    expect(countriesInContinent(stats, 'asia').map((s) => s.code)).toEqual(['CN'])
    expect(countriesInContinent(stats, 'europe').map((s) => s.code)).toEqual(['DE'])
    expect(countriesInContinent(stats, 'northAmerica').map((s) => s.code)).toEqual(['US'])
  })

  it('presentContinents 按固定顺序、只保留有数据的', () => {
    expect(presentContinents(stats)).toEqual(['asia', 'europe', 'northAmerica', 'southAmerica', 'oceania'])
  })
})
