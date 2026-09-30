import { describe, expect, it } from 'vitest'
import {
  buildCountryIndex,
  continentOf,
  countriesInContinent,
  countryStats,
  filterCountries,
  presentContinents,
} from '../region'

const bySpecies: Record<string, string[]> = {
  a: ['CN', 'JP', 'US'],
  b: ['CN', 'US'],
  c: ['CN'],
  d: ['BR'],
}

describe('continentOf（七大洲归类，港澳台属亚洲）', () => {
  it('主要大洲 + 未收录返回 undefined', () => {
    expect(continentOf('CN')).toBe('asia')
    expect(continentOf('HK')).toBe('asia')
    expect(continentOf('MO')).toBe('asia')
    expect(continentOf('TW')).toBe('asia')
    expect(continentOf('DE')).toBe('europe')
    expect(continentOf('US')).toBe('northAmerica')
    expect(continentOf('BR')).toBe('southAmerica')
    expect(continentOf('AU')).toBe('oceania')
    expect(continentOf('AQ')).toBe('antarctica')
    expect(continentOf('DT')).toBeUndefined()
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

  it('港澳台单独成条目（不与 CN 合并），同物种同码去重', () => {
    expect(buildCountryIndex({ x: ['TW', 'HK', 'MO', 'CN'], y: ['TW'] })).toEqual({
      TW: ['x', 'y'],
      HK: ['x'],
      MO: ['x'],
      CN: ['x'],
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

describe('filterCountries（C7 国家搜索，含中国地区特别标注）', () => {
  const stats = countryStats({ a: ['CN', 'TW'], b: ['TW'] })
  const nameOf = (c: string) =>
    ({ CN: '中国', TW: '中国台湾' })[c] ?? c

  it('空查询返回全部', () => {
    expect(filterCountries(stats, '   ', nameOf)).toHaveLength(stats.length)
  })

  it('按代码或本地化名称匹配（大小写不敏感）', () => {
    expect(filterCountries(stats, 'cn', nameOf).map((s) => s.code)).toEqual(['CN'])
    expect(filterCountries(stats, '中国台湾', nameOf).map((s) => s.code)).toEqual(['TW'])
  })
})

describe('countriesInContinent / presentContinents（七大洲筛选）', () => {
  const stats = countryStats({ a: ['CN', 'DE'], b: ['US'], c: ['BR'], d: ['AU'] })

  it('按大洲筛出国家（DT 等无大洲归属的被排除）', () => {
    const mixed = countryStats({ a: ['CN', 'DE'], b: ['US'], c: ['BR'], d: ['AU'], e: ['DT'] })
    expect(countriesInContinent(mixed, 'asia').map((s) => s.code)).toEqual(['CN'])
    expect(countriesInContinent(mixed, 'europe').map((s) => s.code)).toEqual(['DE'])
    expect(countriesInContinent(mixed, 'northAmerica').map((s) => s.code)).toEqual(['US'])
  })

  it('presentContinents 按固定顺序、只保留有数据的', () => {
    expect(presentContinents(stats)).toEqual([
      'asia',
      'europe',
      'northAmerica',
      'southAmerica',
      'oceania',
    ])
  })
})
