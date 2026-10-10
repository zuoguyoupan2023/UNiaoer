/**
 * 029 M2:全球池(懒加载 + 地区过滤)单测。
 * 关注:加载并发去重、地区过滤正确性、区系缺失降级、缓存清空。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetGlobalPoolCache,
  countryOfRegion,
  globalPoolReady,
  loadGlobalPool,
  loadRegionalPool,
  speciesInRegion,
} from '../globalPool'
import { _resetSpeciesIndexCaches } from '../speciesIndex'

/** 最小池条目(带 taxonKey;短码 = 去 avibase- 前缀) */
const sp = (id: string, key: string, extra: Record<string, unknown> = {}) => ({
  id,
  nameZh: '',
  nameSci: id,
  family: '',
  commonness: 3,
  taxonKey: `avibase-${key}`,
  image: { url: `https://m/${id}.webp`, type: 'image' },
  audio: null,
  desc: '',
  location: '',
  habit: '',
  ...extra,
})

const poolSpecies = [
  sp('sp-cn', 'AAA00001'),
  sp('sp-us', 'BBB00002'),
  sp('sp-both', 'CCC00003'),
]

const globalDoc = { layer: 'meta', total: poolSpecies.length, species: poolSpecies, buckets: [] }
const distribution = {
  schemaVersion: 1,
  sources: [],
  counts: {},
  byCountry: { CN: ['AAA00001', 'CCC00003'], US: ['BBB00002', 'CCC00003'] },
}

function stubFetch(opts: { pool?: boolean; dist?: boolean; fail?: boolean } = {}) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const u = String(input)
      calls.push(u)
      if (u.includes('manifest-meta.json')) {
        if (opts.fail) throw new Error('network')
        if (opts.pool === false) return new Response('nope', { status: 404 })
        return new Response(JSON.stringify(globalDoc), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (u.includes('species-distribution.json')) {
        if (opts.dist === false) return new Response('nope', { status: 404 })
        return new Response(JSON.stringify(distribution), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )
  return calls
}

beforeEach(() => {
  _resetGlobalPoolCache()
  _resetSpeciesIndexCaches()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadGlobalPool', () => {
  it('加载成功并缓存;并发调用只发一次请求', async () => {
    const calls = stubFetch()
    const [a, b] = await Promise.all([loadGlobalPool(), loadGlobalPool()])
    expect(a).toHaveLength(3)
    expect(b).toBe(a)
    expect(calls.filter((u) => u.includes('manifest-meta.json'))).toHaveLength(1)
    expect(globalPoolReady()).toHaveLength(3)
  })

  it('请求失败返回 null(调用方回退核心库)', async () => {
    stubFetch({ fail: true })
    expect(await loadGlobalPool()).toBeNull()
  })

  it('404 返回 null', async () => {
    stubFetch({ pool: false })
    expect(await loadGlobalPool()).toBeNull()
  })
})

describe('loadRegionalPool', () => {
  it('ALL / 空值返回全量池', async () => {
    stubFetch()
    expect(await loadRegionalPool('ALL')).toHaveLength(3)
    expect(await loadRegionalPool('')).toHaveLength(3)
  })

  it('按国家过滤(短码匹配)', async () => {
    stubFetch()
    const cn = await loadRegionalPool('CN')
    expect(cn?.map((s) => s.id).sort()).toEqual(['sp-both', 'sp-cn'])
    const us = await loadRegionalPool('US')
    expect(us?.map((s) => s.id).sort()).toEqual(['sp-both', 'sp-us'])
  })

  it('未知国家返回空数组;区系缺失返回 null(降级为不过滤)', async () => {
    stubFetch()
    expect(await loadRegionalPool('ZZ')).toEqual([])
    _resetGlobalPoolCache()
    _resetSpeciesIndexCaches()
    stubFetch({ dist: false })
    expect(await loadRegionalPool('CN')).toBeNull()
  })

  it('池不可用时返回 null', async () => {
    stubFetch({ fail: true })
    expect(await loadRegionalPool('CN')).toBeNull()
  })

  /**
   * 036：出题地区支持**省码**（CN-11）。
   * 区系层只有国家级数据，故省码必须归一到国家再过滤——
   * 否则 byCountry['CN-11'] 查不到 → 空集 → 全球池被清空（题池骤减）。
   */
  it('省码按所属国家过滤（与国家级结果一致）', async () => {
    stubFetch()
    const byCountry = await loadRegionalPool('CN')
    _resetGlobalPoolCache()
    _resetSpeciesIndexCaches()
    stubFetch()
    const byProvince = await loadRegionalPool('CN-11')
    expect(byProvince?.map((s) => s.id).sort()).toEqual(byCountry?.map((s) => s.id).sort())
    expect(byProvince?.length).toBeGreaterThan(0)
  })
})

describe('countryOfRegion（省码 → 国家码）', () => {
  it('国家码原样；省码取前两位；ALL/空值归一', () => {
    expect(countryOfRegion('CN')).toBe('CN')
    expect(countryOfRegion('cn-11')).toBe('CN')
    expect(countryOfRegion('GB-ENG')).toBe('GB')
    expect(countryOfRegion('US-CA')).toBe('US')
    expect(countryOfRegion('ALL')).toBe('ALL')
    expect(countryOfRegion('')).toBe('ALL')
  })
})

describe('speciesInRegion', () => {
  it('按区系判断;ALL 恒 true;无 taxonKey 返回 null', async () => {
    stubFetch()
    expect(await speciesInRegion('avibase-AAA00001', 'CN')).toBe(true)
    expect(await speciesInRegion('avibase-AAA00001', 'US')).toBe(false)
    expect(await speciesInRegion('avibase-AAA00001', 'ALL')).toBe(true)
    expect(await speciesInRegion(undefined, 'CN')).toBeNull()
  })

  it('省码按所属国家判断（036）', async () => {
    stubFetch()
    expect(await speciesInRegion('avibase-AAA00001', 'CN-11')).toBe(true)
    expect(await speciesInRegion('avibase-AAA00001', 'US-CA')).toBe(false)
  })
})
