import { describe, expect, it } from 'vitest'
import { buildCountryIndex, countryStats, filterCountries } from '../region'

const bySpecies: Record<string, string[]> = {
  a: ['CN', 'JP', 'US'],
  b: ['CN', 'US'],
  c: ['CN'],
  d: ['BR'],
}

describe('buildCountryIndex（C7 国家→物种反查）', () => {
  it('按国家聚合并保持物种顺序', () => {
    expect(buildCountryIndex(bySpecies)).toEqual({
      CN: ['a', 'b', 'c'],
      JP: ['a'],
      US: ['a', 'b'],
      BR: ['d'],
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
