/**
 * 036 前端消费层：地区键解析、分片读取、档位筛选与**降级链（绝不出空池）**。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetRegionCommonnessCache,
  filterByRegionTier,
  parseRegionKey,
  regionTierOf,
  regionTierMap,
} from '../provinceCommonness'
import type { BankSpecies } from '../bank'

const sp = (id: string): BankSpecies => ({
  id,
  nameZh: id,
  nameSci: id,
  family: 'F',
  commonness: 3,
  desc: '',
  location: '',
  habit: '',
  image: null,
  audio: null,
})

const CN_PROVINCE = {
  schemaVersion: 1,
  country: 'CN',
  level: 'province',
  generatedAt: 'test',
  tiersByCode: {
    'CN-11': { a: 1, b: 2, c: 3, d: 4, e: 5 },
    'CN-44': { a: 5, b: 4 },
  },
}
const CN_COUNTRY = {
  schemaVersion: 1,
  country: 'CN',
  level: 'country',
  generatedAt: 'test',
  tiers: { a: 1, b: 2 },
}

/** 按 URL 分派 fetch 桩 */
function stubFetch(map: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      for (const [key, body] of Object.entries(map)) {
        if (url.endsWith(key)) {
          return body === null ? new Response('nf', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
        }
      }
      return new Response('nf', { status: 404 })
    }),
  )
}

describe('parseRegionKey（地区键）', () => {
  it('国家码 / 省码 / ALL / 非法', () => {
    expect(parseRegionKey('CN')).toEqual({ cc: 'CN', code: null })
    // code 为**完整省码**（与产物分片键一致）
    expect(parseRegionKey('CN-11')).toEqual({ cc: 'CN', code: 'CN-11' })
    expect(parseRegionKey('gb-eng')).toEqual({ cc: 'GB', code: 'GB-ENG' })
    expect(parseRegionKey('ALL')).toBeNull()
    expect(parseRegionKey('')).toBeNull()
    expect(parseRegionKey('XYZ')).toBeNull()
  })
})

describe('regionTierMap（分片读取 + 降级链）', () => {
  beforeEach(() => _resetRegionCommonnessCache())

  it('省码 → 读省级分片的该省档位', async () => {
    stubFetch({ 'province-commonness/CN.json': CN_PROVINCE })
    const r = await regionTierMap('CN-11')
    expect(r?.level).toBe('province')
    expect(r?.tiers.get('a')).toBe(1)
    expect(r?.tiers.get('e')).toBe(5)
  })

  it('省码在该国分片中不存在 → 降级到国家级', async () => {
    stubFetch({ 'province-commonness/CN.json': CN_PROVINCE, 'province-commonness/CN.country.json': CN_COUNTRY })
    const r = await regionTierMap('CN-99')
    expect(r?.level).toBe('country')
    expect(r?.tiers.get('a')).toBe(1)
  })

  it('省级分片缺失 → 降级国家级', async () => {
    stubFetch({ 'province-commonness/CN.json': null, 'province-commonness/CN.country.json': CN_COUNTRY })
    const r = await regionTierMap('CN-11')
    expect(r?.level).toBe('country')
  })

  it('两者都缺失 → null（调用方回退全局 commonness）', async () => {
    stubFetch({})
    expect(await regionTierMap('CN-11')).toBeNull()
  })

  it('纯国家码 → 直接读国家级', async () => {
    stubFetch({ 'province-commonness/CN.country.json': CN_COUNTRY })
    const r = await regionTierMap('CN')
    expect(r?.level).toBe('country')
  })
})

describe('filterByRegionTier（严格 → 表内放宽 → 兜底，绝不出空）', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map(sp)
  const tiers = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]])

  it('严格档位筛（足够时）', () => {
    const out = filterByRegionTier(pool, tiers, [1, 2], 2)
    expect(out.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('严格筛不足 min → 放宽为「表内任意档位」（而非原池）', () => {
    // L1 允许 [1,2]；严格只有 a → 放宽为表内全部（a..e，本地稀有也比外地鸟贴近语义）
    const out = filterByRegionTier(pool, tiers, [1, 2], 4)
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('表外物种不因放宽而回归（放宽仍限表内）', () => {
    const out = filterByRegionTier(pool, new Map([['a', 1]]), [1], 10)
    expect(out.map((s) => s.id)).toEqual(['a'])
  })

  it('档位表为空 → 返回原池（不做筛选）', () => {
    const out = filterByRegionTier(pool, new Map(), [1], 4)
    expect(out).toEqual(pool)
  })

  it('池中物种都不在档位表 → 返回原池（绝不出空）', () => {
    const out = filterByRegionTier(pool, new Map([['zzz', 1]]), [1], 2)
    expect(out).toEqual(pool)
  })
})

describe('regionTierOf', () => {
  it('有则返回，无则 null', () => {
    const tiers = new Map([['a', 3]])
    expect(regionTierOf(tiers, 'a')).toBe(3)
    expect(regionTierOf(tiers, 'b')).toBeNull()
    expect(regionTierOf(null, 'a')).toBeNull()
  })
})
