import { describe, expect, it } from 'vitest'
import {
  buildCountryIndex,
  continentClickAction,
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

describe('continentClickAction（2026-10-25：点洲一次即选中）', () => {
  it('当前选国家/全球/另一洲 → 点洲 = 选中并展开（一次点击生效）', () => {
    expect(continentClickAction('ASIA', null, false)).toEqual({ select: true, open: true })
    expect(continentClickAction('ASIA', null, true)).toEqual({ select: true, open: true })
    expect(continentClickAction('ASIA', 'EUROPE', false)).toEqual({ select: true, open: true })
  })

  it('已选中该洲 → 点击只切换展开/收起（选中态保持）', () => {
    expect(continentClickAction('ASIA', 'ASIA', true)).toEqual({ select: false, open: false })
    expect(continentClickAction('ASIA', 'ASIA', false)).toEqual({ select: false, open: true })
  })
})

describe('SUBREGION_OF_CN（2026-10-26：港澳台归入中国，不和国家并列）', () => {
  it('香港/澳门/台湾在排除集合里，中国本身不在', async () => {
    const { SUBREGION_OF_CN } = await import('../region')
    expect(SUBREGION_OF_CN.has('HK')).toBe(true)
    expect(SUBREGION_OF_CN.has('MO')).toBe(true)
    expect(SUBREGION_OF_CN.has('TW')).toBe(true)
    expect(SUBREGION_OF_CN.has('CN')).toBe(false)
  })

  it('每个洲去掉港澳台后不再包含这三个码，但中国仍在亚洲', async () => {
    const { COUNTRIES_BY_CONTINENT, SUBREGION_OF_CN, CONTINENTS } = await import('../region')
    for (const key of CONTINENTS) {
      const kept = COUNTRIES_BY_CONTINENT[key].filter((c) => !SUBREGION_OF_CN.has(c))
      expect(kept).not.toContain('HK')
      expect(kept).not.toContain('MO')
      expect(kept).not.toContain('TW')
    }
    expect(COUNTRIES_BY_CONTINENT.asia).toContain('CN')
  })

  it('洲并集口径不受影响（区系/出题仍按各自码取数）', async () => {
    const { countriesOfContinent } = await import('../region')
    const asia = countriesOfContinent('ASIA')
    expect(asia).toContain('HK')
    expect(asia).toContain('TW')
  })
})
