import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _resetRegionRecordsCache,
  countryRecordCount,
  countryRecordTotal,
  loadCountryRecords,
  loadRegionRecordsIndex,
  type CountryRecordsShard,
  type RegionRecordsIndex,
} from '../regionRecords'

afterEach(() => {
  _resetRegionRecordsCache()
  vi.unstubAllGlobals()
})

const index: RegionRecordsIndex = {
  schemaVersion: 1,
  generatedAt: '',
  method: '',
  sources: [],
  threshold: { minRecords: 2 },
  scope: { countries: 1 },
  counts: {
    rows: 3,
    rawRecords: 100,
    pairs: 2,
    species: 2,
    matchedRecords: 90,
    matchedShare: 0.9,
    viaBridge: 0,
    unmatchedNames: 0,
  },
  totals: { BR: 90 },
  sharding: { dir: 'region-records', files: ['BR.json'], bytes: {}, maxBytes: 0, totalBytes: 0 },
}

const shard: CountryRecordsShard = {
  schemaVersion: 1,
  cc: 'BR',
  count: 90,
  species: 2,
  bySpecies: { 'pitan-sulphuratus': 60, 'coragyps-atratus': 30 },
}

describe('regionRecords（P0-5 国家层记录数）', () => {
  it('索引与分片按国懒加载并缓存', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation((async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        const body = url.endsWith('index.json') ? index : shard
        return { ok: true, json: async () => body } as Response
      }) as unknown as typeof fetch),
    )
    expect((await loadRegionRecordsIndex())?.totals.BR).toBe(90)
    await loadRegionRecordsIndex()
    expect((await loadCountryRecords('br'))?.bySpecies['pitan-sulphuratus']).toBe(60)
    await loadCountryRecords('BR')
    expect(calls.filter((u) => u.endsWith('index.json'))).toHaveLength(1)
    expect(calls.filter((u) => u.endsWith('/BR.json'))).toHaveLength(1)
  })

  it('空国家码不发请求；取数/合计有兜底', async () => {
    const f = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', f)
    expect(await loadCountryRecords('')).toBeNull()
    expect(f).not.toHaveBeenCalled()
    expect(countryRecordCount(null, 'x')).toBe(0)
    expect(countryRecordCount(shard, 'nope')).toBe(0)
    expect(countryRecordTotal(index, 'BR')).toBe(90)
    expect(countryRecordTotal(index, 'ZZ')).toBeNull()
  })

  it('产物缺失/网络失败 → null（页面退回无记录数，不报错）', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
    expect(await loadRegionRecordsIndex()).toBeNull()
    expect(await loadCountryRecords('BR')).toBeNull()
  })
})
