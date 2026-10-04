/**
 * 025 M1:全球国家矩阵聚合纯函数单测。
 */
import { describe, expect, it } from 'vitest'
import { aggregateCountryMatrix, shortCode, toByCountryObject } from '../distribution-global-lib.mjs'

describe('shortCode', () => {
  it('去 avibase- 前缀', () => {
    expect(shortCode('avibase-BB5650EB')).toBe('BB5650EB')
  })
  it('非法 taxonKey 抛错', () => {
    expect(() => shortCode('BB5650EB')).toThrow(/非法/)
    expect(() => shortCode('')).toThrow(/非法/)
  })
})

describe('aggregateCountryMatrix', () => {
  const nameToCode = new Map([
    ['pycnonotus sinensis', 'BB5650EB'],
    ['corvus corone', 'E4EE9AC4'],
  ])

  it('聚合 + 作者/亚种归并 + 去重 + 未收录学名/非法国家码丢弃计数', () => {
    const rows = [
      { scientificname: 'Pycnonotus sinensis (Gmelin, 1789)', countrycode: 'cn', n: 10 },
      { scientificname: 'Pycnonotus sinensis hainanus', countrycode: 'CN', n: 3 },
      { scientificname: 'Pycnonotus sinensis', countrycode: 'JP', n: 1 },
      { scientificname: 'Corvus corone', countrycode: 'DE', n: 5 },
      { scientificname: 'Nonsense weirdus', countrycode: 'FR', n: 1 },
      { scientificname: 'Corvus corone', countrycode: 'XX1', n: 2 },
      { scientificname: '', countrycode: 'CN', n: 1 },
      { scientificname: 'Corvus corone', countrycode: 'ZZ', n: 9 },
      { scientificname: 'Corvus corone', countrycode: 'XK', n: 4 },
    ]
    const { byCountry, skipped } = aggregateCountryMatrix(rows, nameToCode)
    expect(byCountry.get('CN')).toEqual(new Set(['BB5650EB'])) // 作者注记/亚种行并入种
    expect(byCountry.get('JP')).toEqual(new Set(['BB5650EB']))
    expect(byCountry.get('DE')).toEqual(new Set(['E4EE9AC4']))
    expect(byCountry.has('ZZ')).toBe(false)
    expect(skipped).toEqual({ unknownName: 2, badCountry: 1, deniedCountry: 2 })
  })

  it('空输入安全', () => {
    const { byCountry, skipped } = aggregateCountryMatrix([], nameToCode)
    expect(byCountry.size).toBe(0)
    expect(skipped).toEqual({ unknownName: 0, badCountry: 0, deniedCountry: 0 })
  })
})

describe('toByCountryObject', () => {
  it('国家按物种数降序、同数按码序;短码升序', () => {
    const m = new Map([
      ['ZA', new Set(['B', 'A'])],
      ['CN', new Set(['C'])],
      ['AA', new Set(['C'])],
    ])
    const out = toByCountryObject(m)
    expect(Object.keys(out)).toEqual(['ZA', 'AA', 'CN'])
    expect(out.ZA).toEqual(['A', 'B'])
  })
})
