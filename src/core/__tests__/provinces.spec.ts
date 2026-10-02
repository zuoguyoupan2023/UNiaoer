import { describe, expect, it } from 'vitest'
import {
  provinceCount,
  provinceStats,
  provincesOf,
  speciesInProvince,
  type ProvinceData,
} from '../provinces'

const data: ProvinceData = {
  schemaVersion: 1,
  generatedAt: '',
  method: '',
  sources: [],
  countries: ['CN'],
  byCountry: { CN: { 'CN-11': '北京市', 'CN-44': '广东省', 'CN-91': '中国香港' } },
  byCountryAlt: { CN: { 'CN-11': 'Beijing', 'CN-44': 'Guangdong', 'CN-91': 'Hong Kong, China' } },
  bySpecies: {
    a: { CN: { 'CN-11': 5, 'CN-44': 2 } },
    b: { CN: { 'CN-44': 3 } },
    c: { CN: { 'CN-91': 1 } },
  },
}

describe('provincesOf（按 locale 取 zh / en 展示名，按名排序）', () => {
  it('zh 用 byCountry，en 用 byCountryAlt', () => {
    expect(provincesOf(data, 'CN').map((p) => p.name)).toEqual(['北京市', '广东省', '中国香港'])
    expect(provincesOf(data, 'CN', 'en').map((p) => p.name)).toEqual([
      'Beijing',
      'Guangdong',
      'Hong Kong, China',
    ])
  })
  it('无数据返回空', () => {
    expect(provincesOf(data, 'US')).toEqual([])
    expect(provincesOf(null, 'CN')).toEqual([])
  })
})

describe('provinceStats（每省鸟种数，供二级排序/展示）', () => {
  it('count = 该省有记录的物种数', () => {
    const stats = provinceStats(data, 'CN')
    const by = Object.fromEntries(stats.map((s) => [s.code, s.count]))
    expect(by).toEqual({ 'CN-11': 1, 'CN-44': 2, 'CN-91': 1 })
  })
})

describe('speciesInProvince / provinceCount', () => {
  it('该省物种集合与单条记录数', () => {
    expect([...speciesInProvince(data, 'CN', 'CN-44')].sort()).toEqual(['a', 'b'])
    expect(speciesInProvince(data, 'CN', '')).toEqual(new Set())
    expect(provinceCount(data, 'a', 'CN', 'CN-11')).toBe(5)
    expect(provinceCount(data, 'a', 'CN', 'CN-99')).toBe(0)
  })
})
