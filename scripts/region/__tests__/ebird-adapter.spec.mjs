import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { distanceKm, hotspotRecords, nearestHotspot, subnational1Regions } from '../adapters/ebird.mjs'

const fixture = (name) => JSON.parse(readFileSync(path.resolve(process.cwd(), 'tests/fixtures/region/ebird', name), 'utf8'))

describe('hotspotRecords', () => {
  it('映射真实 eBird 响应，丢弃无坐标/无国家/无 id', () => {
    const recs = hotspotRecords(fixture('hotspot-US-DC.json'))
    expect(recs.length).toBeGreaterThan(0)
    const h = recs[0]
    expect(h).toMatchObject({ country: 'US', subnational1: 'US-DC', source: 'ebird' })
    expect(h.id).toMatch(/^L\d+$/)
    expect(h.sourceUrl).toBe(`https://ebird.org/hotspot/${h.id}`)
    expect(Number.isFinite(h.lat) && Number.isFinite(h.lng)).toBe(true)

    const dirty = hotspotRecords([
      { locId: 'L1', countryCode: 'us', lat: 1, lng: 2 },
      { locid: 'L2', countryCode: 'US', lat: 1, lng: 2 },
      { locId: 'L3', countryCode: 'US', lat: 'x', lng: 2 },
      { locId: 'L4', lat: 1, lng: 2 },
      { countryCode: 'US', lat: 1, lng: 2 },
    ])
    expect(dirty.map((r) => r.id)).toEqual(['L1', 'L2'])
    expect(dirty[0].country).toBe('US')
  })
})

describe('subnational1Regions', () => {
  it('保留 code+name，去空', () => {
    expect(subnational1Regions(fixture('subnational1-CN.json'))).toEqual(
      fixture('subnational1-CN.json').map((r) => ({ code: r.code, name: r.name })),
    )
    expect(subnational1Regions([{ code: 'X' }, { name: 'Y' }, { code: 'CN-11', name: 'Beijing' }])).toEqual([
      { code: 'CN-11', name: 'Beijing' },
    ])
  })
})

describe('distanceKm / nearestHotspot', () => {
  it('1 纬度 ≈ 111km', () => {
    expect(Math.round(distanceKm(0, 0, 1, 0))).toBe(111)
  })
  it('命中 maxKm 内最近点；超出返回 null', () => {
    const spots = [
      { id: 'far', lat: 40.0, lng: 116.0 },
      { id: 'near', lat: 39.95, lng: 116.05 },
    ]
    expect(nearestHotspot(39.949, 116.049, spots, { maxKm: 10 })?.id).toBe('near')
    expect(nearestHotspot(39.949, 116.049, spots, { maxKm: 0.1 })).toBeNull()
  })
})
