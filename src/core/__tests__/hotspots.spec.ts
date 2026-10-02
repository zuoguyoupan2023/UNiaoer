import { describe, expect, it } from 'vitest'
import { hotspotsOf, type HotspotData } from '../hotspots'

const data: HotspotData = {
  schemaVersion: 1,
  generatedAt: '',
  method: '',
  grid: 0.1,
  thresholds: { minRecords: 20, minSpecies: 5, minObservers: 3 },
  sources: [],
  countries: ['US', 'CN'],
  hotspotCount: 3,
  hotspots: [
    { id: 'us-b', country: 'US', lat: 34, lng: -118, speciesCount: 8, recordCount: 50, observerCount: 6, topSpecies: [], sources: ['gbif'] },
    { id: 'us-a', country: 'US', lat: 47, lng: -122, speciesCount: 5, recordCount: 50, observerCount: 4, topSpecies: [], sources: ['gbif'] },
    { id: 'cn-a', country: 'CN', lat: 39.9, lng: 116.4, speciesCount: 12, recordCount: 80, observerCount: 9, topSpecies: [], sources: ['gbif'] },
  ],
}

describe('hotspotsOf', () => {
  it('按国家过滤；recordCount 降序，同数量按 id', () => {
    expect(hotspotsOf(data, 'US').map((h) => h.id)).toEqual(['us-a', 'us-b'])
    expect(hotspotsOf(data, 'CN').map((h) => h.id)).toEqual(['cn-a'])
  })
  it('无数据/未知国家返回空', () => {
    expect(hotspotsOf(data, 'JP')).toEqual([])
    expect(hotspotsOf(null, 'US')).toEqual([])
  })
})
