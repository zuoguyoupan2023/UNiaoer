/**
 * 036 省级常见度纯函数单测：分档尺寸合并、份额归一、异常守卫、人工覆盖优先级、边界。
 *
 * 守卫的必要性来自实测（docs/036 §1.3）：蒙古沙鸻占香港记录 94.7%、占北京 51.3%；
 * 358 省中 107 省 top1 份额 > 40%。若不守卫，这些省的"最常见鸟"全是那个异常种。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GUARDS,
  applyOverrides,
  bandProvince,
  bandSlices,
  buildRegionTiers,
  summarize,
} from '../province-commonness-lib.mjs'

describe('bandSlices（分档尺寸 + 最少种数合并）', () => {
  it('整除时等分', () => {
    expect(bandSlices(100, 5, 1)).toEqual([20, 20, 20, 20, 20])
  })

  it('不整除时余数给前几档', () => {
    expect(bandSlices(103, 5, 1)).toEqual([21, 21, 21, 20, 20])
  })

  it('档数随 minSize 收缩，且每档都 ≥ minSize', () => {
    // 22 种、每档至少 5 → floor(22/5)=4 档 → [6,6,5,5]
    const s22 = bandSlices(22, 5, 5)
    expect(s22).toEqual([6, 6, 5, 5])
    expect(Math.min(...s22)).toBeGreaterThanOrEqual(5)
    // 100 种、每档至少 30 → floor(100/30)=3 档 → [34,33,33]
    const s100 = bandSlices(100, 5, 30)
    expect(s100).toEqual([34, 33, 33])
    expect(Math.min(...s100)).toBeGreaterThanOrEqual(30)
  })

  it('物种数不足以填满 minSize 时退化为单档', () => {
    expect(bandSlices(12, 5, 30)).toEqual([12])
  })

  it('物种数少于档数时按物种数分档（每档 1 种）', () => {
    // 3 种、每档至少 1 → floor(3/1)=3 档（受上限 5 约束）→ [1,1,1]
    expect(bandSlices(3, 5, 1)).toEqual([1, 1, 1])
  })

  it('0 / 非法输入 → 空', () => {
    expect(bandSlices(0)).toEqual([])
    expect(bandSlices(-1)).toEqual([])
    expect(bandSlices(Number.NaN)).toEqual([])
  })
})

describe('bandProvince（份额归一 + 守卫 + 分档）', () => {
  /** 构造 entries：n 依次递减 */
  const entries = (ns) => ns.map((n, i) => ({ speciesId: `sp-${String(i).padStart(3, '0')}`, n }))

  it('正常省份：按份额降序分 5 档，1 = 最常见', () => {
    // 100 种、每档 20；total 与 sum(entries) 相同（无未匹配物种）
    const list = entries(Array.from({ length: 100 }, (_, i) => 1000 - i * 5))
    const total = list.reduce((s, e) => s + e.n, 0)
    // minBandSize=20（默认 30 时 100 种只会分 3 档——那是 D-036-3 的"每档最少 N 种"在起作用）
    const res = bandProvince(list, total, null, {
      ...DEFAULT_GUARDS,
      minBandSize: 20,
      minProvinceSpecies: 20,
    })
    expect(res.trusted).toBe(100)
    expect(res.bandSizes).toEqual([20, 20, 20, 20, 20])
    // 最大的那条是 1 档
    expect(res.tiers['sp-000']).toBe(1)
    // 最小的那条是末档
    expect(res.tiers['sp-099']).toBe(5)
  })

  it('守卫 dominance：份额 >40% 的种被剔除且计数（蒙古沙鸻场景）', () => {
    // 香港式：一个种占 94.7%，其余 20 种分剩下的
    const rest = entries(Array.from({ length: 20 }, (_, i) => 100 - i))
    const list = [{ speciesId: 'charadrius-mongolus', n: 5585 }, ...rest]
    const total = 5900 // 含未匹配物种的总量
    const res = bandProvince(list, total, null, DEFAULT_GUARDS)
    expect(res.guardsHit.dominance).toBe(1)
    expect(res.tiers['charadrius-mongolus']).toBeUndefined()
    // 其余 20 种仍被分档（>= minProvinceSpecies=20）
    expect(res.trusted).toBe(20)
  })

  it('守卫 spike：份额 >15% 且全球仅出现 ≤3 月 → 剔除', () => {
    const rest = entries(Array.from({ length: 20 }, (_, i) => 100 - i))
    const list = [{ speciesId: 'seasonal-visitor', n: 900 }, ...rest]
    const total = 3000
    const months = new Map([['seasonal-visitor', 2]]) // 只出现在 2 个月
    const res = bandProvince(list, total, months, DEFAULT_GUARDS)
    expect(res.guardsHit.spike).toBe(1)
    expect(res.tiers['seasonal-visitor']).toBeUndefined()
  })

  it('高份额但全年可见（非尖峰）→ 不触发 spike 守卫', () => {
    const rest = entries(Array.from({ length: 20 }, (_, i) => 100 - i))
    const list = [{ speciesId: 'resident-dominant', n: 900 }, ...rest]
    const months = new Map([['resident-dominant', 12]])
    const res = bandProvince(list, 3000, months, DEFAULT_GUARDS)
    expect(res.guardsHit.spike).toBe(0)
    expect(res.guardsHit.dominance).toBe(0)
    expect(res.tiers['resident-dominant']).toBe(1)
  })

  it('省份总量过小 → 整省不可信（空结果）', () => {
    const list = entries([500, 400, 300])
    const res = bandProvince(list, 1200, null, DEFAULT_GUARDS) // < minProvinceRecords=1000? 否 → 但物种太少
    expect(res.tiers).toEqual({})
  })

  it('小样本省份（总量 < 1000）→ 直接跳过', () => {
    const list = entries(Array.from({ length: 30 }, () => 10))
    const res = bandProvince(list, 300, null, DEFAULT_GUARDS)
    expect(res.tiers).toEqual({})
    expect(res.trusted).toBe(0)
  })

  it('可信物种不足 minProvinceSpecies → 整省跳过', () => {
    const list = entries(Array.from({ length: 5 }, () => 100))
    const res = bandProvince(list, 1200, null, DEFAULT_GUARDS) // minProvinceSpecies=20
    expect(res.tiers).toEqual({})
  })

  it('份额归一：total 含未匹配物种时，档位按真实份额而非绝对数', () => {
    // 20 种各 100 条；但该省总量 10,000（其余 8,000 条属未匹配物种）
    const list = entries(Array.from({ length: 30 }, () => 100))
    const res = bandProvince(list, 10_000, null, { ...DEFAULT_GUARDS, minBandSize: 1 })
    expect(res.trusted).toBe(30)
    expect(Object.values(res.tiers)).toContain(1)
  })
})

describe('buildRegionTiers（省级 + 国家级聚合）', () => {
  const rows = [
    // CN-11（北京）：30 种，sp-000 最常见
    ...Array.from({ length: 30 }, (_v, i) => ({ speciesId: `sp-${String(i).padStart(3, '0')}`, cc: 'CN', code: 'CN-11', n: 1000 - i * 10 })),
    // US-CA：30 种（不同物种）
    ...Array.from({ length: 30 }, (_v, i) => ({ speciesId: `us-${String(i).padStart(3, '0')}`, cc: 'US', code: 'US-CA', n: 2000 - i * 10 })),
  ]
  const provinceTotals = new Map([
    ['CN|CN-11', 60_000],
    ['US|US-CA', 90_000],
  ])
  const countryTotals = new Map([
    ['CN', 60_000],
    ['US', 90_000],
  ])

  it('逐省分档 + 国家级再聚合（两级都在产物里）', () => {
    const { tiers, countryTiers, stats } = buildRegionTiers(rows, provinceTotals, countryTotals, null, DEFAULT_GUARDS)
    expect(stats.provinces.trusted).toBe(2)
    expect(stats.countries.trusted).toBe(2)
    expect(tiers['sp-000']['CN-11']).toBe(1)
    expect(tiers['us-000']['US-CA']).toBe(1)
    expect(countryTiers['sp-000']['CN']).toBe(1)
  })

  it('小省被跳过并留痕（provinceReport 记录原因）', () => {
    const small = [{ speciesId: 'x', cc: 'CN', code: 'CN-99', n: 5 }]
    const { stats } = buildRegionTiers(
      small,
      new Map([['CN|CN-99', 5]]),
      new Map([['CN', 5]]),
      null,
      DEFAULT_GUARDS,
    )
    expect(stats.provinces.skippedSmall).toBe(1)
    expect(stats.provinceReport[0]).toMatchObject({ status: 'skipped-small' })
    expect(stats.provinces.trusted).toBe(0)
  })

  it('scope 可只算省级（跳过国家级）', () => {
    const { countryTiers, stats } = buildRegionTiers(rows, provinceTotals, countryTotals, null, DEFAULT_GUARDS, {
      countries: false,
    })
    expect(Object.keys(countryTiers)).toHaveLength(0)
    expect(stats.countries.total).toBe(0)
  })
})

describe('applyOverrides（人工覆盖最高优先，D-036-7）', () => {
  it('覆盖已有档位', () => {
    const tiers = { 'pica-serica': { 'CN-11': 3 } }
    const { applied } = applyOverrides(tiers, { 'CN-11': { 'pica-serica': 1 } })
    expect(applied).toBe(1)
    expect(tiers['pica-serica']['CN-11']).toBe(1)
  })

  it('可覆盖原本无档位的（种,省）组合', () => {
    const tiers = {}
    applyOverrides(tiers, { CN: { 'pycnonotus-sinensis': 1 } })
    expect(tiers['pycnonotus-sinensis']['CN']).toBe(1)
  })

  it('非法档位被拒绝并留痕', () => {
    const tiers = {}
    const { applied, unknown } = applyOverrides(tiers, { CN: { 'sp-x': 9 } })
    expect(applied).toBe(0)
    expect(unknown[0]).toContain('非法档位')
  })

  it('空/畸形覆盖表不炸', () => {
    expect(applyOverrides({}, null).applied).toBe(0)
    expect(applyOverrides({}, {}).applied).toBe(0)
    expect(applyOverrides({}, { CN: null }).applied).toBe(0)
  })
})

describe('summarize（产物 coverage）', () => {
  it('统计物种数/省码数/组合数/档位分布', () => {
    const tiers = {
      a: { 'CN-11': 1, 'CN-31': 2 },
      b: { 'CN-11': 5 },
    }
    const countryTiers = { a: { CN: 1 } }
    const s = summarize(tiers, countryTiers)
    expect(s.species).toBe(2)
    expect(s.provinceCodes).toBe(2)
    expect(s.pairs).toBe(3)
    expect(s.countryPairs).toBe(1)
    expect(s.tierHist[1]).toBe(1)
    expect(s.tierHist[5]).toBe(1)
  })
})
