import { describe, expect, it } from 'vitest'
import { hotspotsInProvince, hotspotsOf, type HotspotData } from '../hotspots'

const data: HotspotData = {
  schemaVersion: 1,
  generatedAt: '',
  method: '',
  grid: 0.1,
  thresholds: { minRecords: 20, minSpecies: 5, minObservers: 3 },
  sources: [],
  countries: ['US', 'CN'],
  hotspotCount: 5,
  hotspots: [
    { id: 'us-b', country: 'US', lat: 34, lng: -118, speciesCount: 8, recordCount: 50, observerCount: 6, topSpecies: [], sources: ['gbif'], subnational1: 'US-CA' },
    { id: 'us-a', country: 'US', lat: 47, lng: -122, speciesCount: 5, recordCount: 50, observerCount: 4, topSpecies: [], sources: ['gbif'], subnational1: 'US-WA' },
    { id: 'us-n', country: 'US', lat: 40, lng: -100, speciesCount: 3, recordCount: 9, observerCount: 2, topSpecies: [], sources: ['gbif'] },
    { id: 'cn-a', country: 'CN', lat: 39.9, lng: 116.4, speciesCount: 12, recordCount: 80, observerCount: 9, topSpecies: [], sources: ['gbif'], subnational1: 'CN-11' },
    { id: 'cn-s', country: 'CN', lat: 31.2, lng: 121.5, speciesCount: 6, recordCount: 20, observerCount: 3, topSpecies: [], sources: ['gbif'], subnational1: 'CN-31' },
  ],
}

describe('hotspotsOf', () => {
  it('按国家过滤；recordCount 降序，同数量按 id', () => {
    expect(hotspotsOf(data, 'US').map((h) => h.id)).toEqual(['us-a', 'us-b', 'us-n'])
    expect(hotspotsOf(data, 'CN').map((h) => h.id)).toEqual(['cn-a', 'cn-s'])
  })
  it('无数据/未知国家返回空', () => {
    expect(hotspotsOf(data, 'JP')).toEqual([])
    expect(hotspotsOf(null, 'US')).toEqual([])
  })
})

describe('hotspotsInProvince（省下钻，2026-10-09）', () => {
  it('按 subnational1 过滤到省；无省码的点归入 unassigned（不算作该省）', () => {
    const cn = hotspotsInProvince(data, 'CN', 'CN-31')
    expect(cn.matched.map((h) => h.id)).toEqual(['cn-s'])
    expect(cn.unassigned).toEqual([]) // CN 夹具两点都有省码

    const us = hotspotsInProvince(data, 'US', 'US-CA')
    expect(us.matched.map((h) => h.id)).toEqual(['us-b'])
    expect(us.unassigned.map((h) => h.id)).toEqual(['us-n'])
  })

  it('未选省 → 返回该国全部（unassigned 为空）', () => {
    const all = hotspotsInProvince(data, 'CN', '')
    expect(all.matched.map((h) => h.id)).toEqual(['cn-a', 'cn-s'])
    expect(all.unassigned).toEqual([])
  })

  it('该省无点 → matched 空（调用方决定是否回退全国）', () => {
    const none = hotspotsInProvince(data, 'CN', 'CN-99')
    expect(none.matched).toEqual([])
  })

  it('数据缺失安全', () => {
    expect(hotspotsInProvince(null, 'CN', 'CN-31')).toEqual({ matched: [], unassigned: [] })
  })
})
