import { describe, expect, it } from 'vitest'
import { logPct, logTicks, logTop, tickLabel, trimLeadingZeros } from '../statsChart'

describe('logTop', () => {
  it('取不小于最大值+1 的 10 的整数次幂', () => {
    expect(logTop(1)).toBe(10)
    expect(logTop(9)).toBe(10)
    expect(logTop(12)).toBe(20)
    expect(logTop(50)).toBe(50)
    expect(logTop(99)).toBe(100)
    expect(logTop(179)).toBe(200)
    expect(logTop(263)).toBe(500)
    expect(logTop(1000)).toBe(1000)
    expect(logTop(1001)).toBe(2000)
  })

  it('负数/0 也给一个可用的顶（至少 10）', () => {
    expect(logTop(0)).toBe(10)
    expect(logTop(-5)).toBe(10)
  })
})

describe('logPct', () => {
  it('0 轮不画柱子', () => {
    expect(logPct(0, 1000)).toBe(0)
  })

  it('1 轮也有可见高度（不会被大数压成 0）', () => {
    const pct = logPct(1, 1000)
    expect(pct).toBeGreaterThan(8)
    expect(pct).toBeLessThan(20)
  })

  it('顶刻度处接近 100%，且单调递增', () => {
    expect(logPct(1000, 1000)).toBeGreaterThan(99)
    const seq = [1, 3, 10, 50, 179].map((n) => logPct(n, 1000))
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]!)
  })
})

describe('tickLabel', () => {
  it('千位缩写，避免刻度文字过长', () => {
    expect(tickLabel(1)).toBe('1')
    expect(tickLabel(100)).toBe('100')
    expect(tickLabel(1000)).toBe('1k')
    expect(tickLabel(10000)).toBe('10k')
  })
})

describe('logTicks', () => {
  it('1-2-5 序列，位置随 top 变化', () => {
    const ticks = logTicks(1000)
    expect(ticks.map((t) => t.v)).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000])
    expect(ticks[ticks.length - 1]!.pct).toBeGreaterThan(99)
    expect(ticks[0]!.pct).toBeLessThan(20)
    expect(ticks.every((t, i) => i === 0 || t.pct > ticks[i - 1]!.pct)).toBe(true)
  })
})

describe('trimLeadingZeros', () => {
  const days = [
    { day: '09-21', n: 0 },
    { day: '09-22', n: 0 },
    { day: '10-01', n: 2 },
    { day: '10-02', n: 0 },
    { day: '10-03', n: 5 },
  ]

  it('只裁开头的 0，末尾的 0 保留（今天还没人玩也是信息）', () => {
    const out = trimLeadingZeros(days)
    expect(out.map((d) => d.day)).toEqual(['10-01', '10-02', '10-03'])
  })

  it('全 0 返回空数组', () => {
    expect(trimLeadingZeros([{ n: 0 }, { n: 0 }])).toEqual([])
  })

  it('首日就有数据时原样返回', () => {
    expect(trimLeadingZeros(days.slice(2)).length).toBe(3)
  })
})
