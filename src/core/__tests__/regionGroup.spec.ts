import { describe, expect, it } from 'vitest'
import { groupRegions, splitRegion } from '../regionGroup'

describe('core/regionGroup · 073 地区统计分组', () => {
  it('splitRegion：国家 / 省 / 港澳台 / 全球', () => {
    expect(splitRegion('CN-11')).toEqual({ country: 'CN', province: 'CN-11' })
    expect(splitRegion('CN')).toEqual({ country: 'CN', province: '' })
    expect(splitRegion('US-CA')).toEqual({ country: 'US', province: 'US-CA' })
    expect(splitRegion('US')).toEqual({ country: 'US', province: '' })
    // 港澳台：归中国、做省级（铁律 6），不独立成国
    expect(splitRegion('HK')).toEqual({ country: 'CN', province: 'HK' })
    expect(splitRegion('MO')).toEqual({ country: 'CN', province: 'MO' })
    expect(splitRegion('TW')).toEqual({ country: 'CN', province: 'TW' })
    expect(splitRegion('ALL')).toBeNull()
    expect(splitRegion('')).toBeNull()
    expect(splitRegion('X')).toBeNull()
  })

  it('国家码 + 省码合并；省级只在同国内部', () => {
    const g = groupRegions([
      { region: 'CN-11', n: 5, mean: 80 },
      { region: 'CN-31', n: 5, mean: 60 },
      { region: 'CN', n: 5, mean: 70 },
      { region: 'US', n: 5, mean: 50 },
      { region: 'US-CA', n: 5, mean: 90 },
    ])
    // 国家：中国 = 80*5+60*5+70*5 = 1050/15 = 70；美国 = 50*5+90*5 = 700/10 = 70
    const cn = g.countries.find((c) => c.code === 'CN')!
    const us = g.countries.find((c) => c.code === 'US')!
    expect(cn.n).toBe(15)
    expect(cn.mean).toBe(70)
    expect(us.n).toBe(10)
    expect(us.mean).toBe(70)
    // 省级只在各自国家内
    expect(cn.provinces.map((p) => p.code)).toEqual(['CN-11', 'CN-31'])
    expect(us.provinces.map((p) => p.code)).toEqual(['US-CA'])
  })

  it('港澳台计入中国省级，不单独出现在国家榜', () => {
    const g = groupRegions([
      { region: 'CN-11', n: 5, mean: 60 },
      { region: 'HK', n: 5, mean: 90 },
      { region: 'TW', n: 5, mean: 50 },
      { region: 'MO', n: 5, mean: 70 },
    ])
    expect(g.countries.map((c) => c.code)).toEqual(['CN']) // 只有中国
    expect(g.countries[0]!.n).toBe(20)
    // 中国内部省级：香港 90 > 澳门 70 > 北京 60 > 台湾 50
    expect(g.countries[0]!.provinces.map((p) => p.code)).toEqual(['HK', 'MO', 'CN-11', 'TW'])
  })

  it('不做最小轮数剔除：1 轮的国家也进榜', () => {
    const g = groupRegions([
      { region: 'CN', n: 100, mean: 70 },
      { region: 'AU', n: 1, mean: 100 },
    ])
    expect(g.countries.map((c) => c.code)).toEqual(['AU', 'CN']) // 100% 排前，n=1 也保留
    expect(g.countries[0]!.n).toBe(1)
  })

  it('总计 / 仅国家 / 省级 三个口径分别给出（2026-10-22 用户要求）', () => {
    const g = groupRegions([
      { region: 'CN', n: 5, mean: 70 }, // 只选国家
      { region: 'CN-11', n: 5, mean: 90 }, // 国家+具体地区
      { region: 'ALL', n: 5, mean: 50 }, // 未指定
      { region: 'US', n: 5, mean: 60 },
    ])
    // 总计 = 全部 20 轮：(70+90+50+60)*5/20 = 67.5 → 68
    expect(g.total.n).toBe(20)
    expect(g.total.mean).toBe(68)
    // 未指定 = 只选「全球」的 5 轮
    expect(g.unspecified).toEqual({ n: 5, mean: 50 })
    // 中国：合计 10 轮 80%；其中「仅国家」5 轮 70%；省级 5 轮 90%
    const cn = g.countries.find((c) => c.code === 'CN')!
    expect(cn.n).toBe(10)
    expect(cn.mean).toBe(80)
    expect(cn.countryOnly).toEqual({ n: 5, mean: 70 })
    expect(cn.provinces).toEqual([{ code: 'CN-11', n: 5, mean: 90 }])
    // 美国：只选国家 → countryOnly 有值、没有省级行
    const us = g.countries.find((c) => c.code === 'US')!
    expect(us.countryOnly).toEqual({ n: 5, mean: 60 })
    expect(us.provinces).toEqual([])
  })

  it('ALL 单列为未指定，不参与国家比较', () => {
    const g = groupRegions([
      { region: 'ALL', n: 5, mean: 40 },
      { region: 'CN', n: 5, mean: 80 },
    ])
    expect(g.countries.map((c) => c.code)).toEqual(['CN'])
    expect(g.unspecified).toEqual({ n: 5, mean: 40 })
  })
})
