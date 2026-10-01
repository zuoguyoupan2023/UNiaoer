import { describe, expect, it } from 'vitest'
import {
  buildEntry,
  countsFromGbifFacet,
  countsFromMedia,
  mergeShares,
  monthOf,
  toShare,
} from '../seasonality-lib.mjs'

describe('monthOf', () => {
  it('解析 ISO 日期/年月，无效返回 null', () => {
    expect(monthOf('2021-04-11')).toBe(4)
    expect(monthOf('2021-04')).toBe(4)
    expect(monthOf('2021-12-01T00:00:00Z')).toBe(12)
    expect(monthOf('2021-13-01')).toBeNull()
    expect(monthOf('')).toBeNull()
    expect(monthOf(null)).toBeNull()
  })
})

describe('countsFromMedia', () => {
  it('按 asset.month 聚合，缺月份不计入', () => {
    const counts = countsFromMedia([
      { month: 3 },
      { month: 3 },
      { month: 11 },
      {},
      null,
      { month: 13 }, // 非法月份忽略
    ])
    expect(counts[2]).toBe(2)
    expect(counts[10]).toBe(1)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3)
  })
})

describe('countsFromGbifFacet', () => {
  it('解析 MONTH facet；其他 facet 忽略', () => {
    const counts = countsFromGbifFacet({
      facets: [
        { field: 'COUNTRY', counts: [{ name: 'CN', count: 9 }] },
        { field: 'MONTH', counts: [{ name: '1', count: 7 }, { name: '12', count: 3 }, { name: '13', count: 99 }] },
      ],
    })
    expect(counts[0]).toBe(7)
    expect(counts[11]).toBe(3)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10)
  })
  it('空响应返回全 0', () => {
    expect(countsFromGbifFacet(null).every((n) => n === 0)).toBe(true)
    expect(countsFromGbifFacet({}).every((n) => n === 0)).toBe(true)
  })
})

describe('toShare / mergeShares', () => {
  it('计数归一化为 0..100；总量 0 全 0', () => {
    expect(toShare([6, 4, ...Array(10).fill(0)])).toEqual([60, 40, ...Array(10).fill(0)])
    expect(toShare(Array(12).fill(0)).every((n) => n === 0)).toBe(true)
  })
  it('多源逐月取最大', () => {
    expect(
      mergeShares([
        [50, 0, 30, ...Array(9).fill(0)],
        [20, 90, 0, ...Array(9).fill(0)],
      ]),
    ).toEqual([50, 90, 30, ...Array(9).fill(0)])
  })
})

describe('buildEntry', () => {
  it('有数据的源才计入；sources 排序；recordCount 取单源最大', () => {
    const entry = buildEntry({
      gbif: [10, 0, 0, ...Array(9).fill(0)],
      xc: [4, 4, 4, ...Array(9).fill(0)],
      inat: Array(12).fill(0), // 全 0 视为无数据
    })
    expect(entry.sources).toEqual(['gbif', 'xc'])
    expect(entry.recordCount).toBe(12) // max(10, 12)
    expect(entry.months[0]).toBe(100) // gbif 单月全量 → 100；xc 第1月 4/12=33
    expect(entry.months[1]).toBe(33)
    expect(entry.months[2]).toBe(33)
    expect(entry.months.slice(3).every((n) => n === 0)).toBe(true)
  })
  it('全空返回 null（薄数据不出条目）', () => {
    expect(buildEntry({ gbif: Array(12).fill(0), xc: Array(12).fill(0) })).toBeNull()
    expect(buildEntry(null)).toBeNull()
  })
})
