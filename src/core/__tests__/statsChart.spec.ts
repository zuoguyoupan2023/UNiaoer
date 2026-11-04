import { describe, expect, it } from 'vitest'
import {
  dailyBuckets,
  logPct,
  logTicks,
  logTop,
  movingAverage,
  tickLabel,
  trimLeadingZeros,
} from '../statsChart'

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

/* ── 正确率趋势的移动平均（2026-11-04）────────────────────────────────
 * 这两条是踩过的坑，必须锁住：
 *  - 窗口没填满就出点 → 「3 日均线」从第 1 天开始画，用户当场发现不对；
 *  - 同一天多轮不合并 → 一天两个点，曲线看着像噪音。
 */
describe('dailyBuckets', () => {
  const day = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()

  it('同一天多轮按题数加权合并成一个桶', () => {
    const out = dailyBuckets([
      { at: day(2026, 11, 1, 9), total: 10, correct: 3 },
      { at: day(2026, 11, 1, 20), total: 30, correct: 27 }, // 同日：合并后 30/40
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.questions).toBe(40)
    expect(out[0]!.correct).toBe(30)
    expect(out[0]!.accuracy).toBe(75)
    expect(out[0]!.indices).toEqual([0, 1])
  })

  it('按时间正序返回，即使输入是乱序', () => {
    const out = dailyBuckets([
      { at: day(2026, 11, 5), total: 10, correct: 5 },
      { at: day(2026, 11, 1), total: 10, correct: 1 },
      { at: day(2026, 11, 3), total: 10, correct: 3 },
    ])
    expect(out.map((b) => new Date(b.at).getDate())).toEqual([1, 3, 5])
  })
})

describe('movingAverage（3 日）', () => {
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10).getTime()
  const r = (at: number, correct: number, total = 10) => ({ at, total, correct })

  it('窗口未满 3 个记录日时不出任何点（不从第一天就开始）', () => {
    expect(movingAverage([])).toEqual([])
    expect(movingAverage([r(day(2026, 11, 1), 5)])).toEqual([])
    expect(movingAverage([r(day(2026, 11, 1), 5), r(day(2026, 11, 2), 7)])).toEqual([])
  })

  it('恰好 3 个记录日出 1 个点，值为三天加权平均', () => {
    const out = movingAverage([
      r(day(2026, 11, 1), 3),
      r(day(2026, 11, 2), 6),
      r(day(2026, 11, 3), 9),
    ])
    expect(out).toHaveLength(1)
    // (3 + 6 + 9) / 30 = 60%
    expect(out[0]!.accuracy).toBe(60)
    expect(new Date(out[0]!.at).getDate()).toBe(3) // 落在第 3 天
  })

  it('第 4 天起滑动：窗口只含最近 3 个记录日，最早一天被移出', () => {
    const out = movingAverage([
      r(day(2026, 11, 1), 0), // 会被移出
      r(day(2026, 11, 2), 5),
      r(day(2026, 11, 3), 7),
      r(day(2026, 11, 4), 9),
    ])
    expect(out).toHaveLength(2)
    expect(out[0]!.accuracy).toBe(40) // (0+5+7)/30
    expect(out[1]!.accuracy).toBe(70) // (5+7+9)/30 —— 第 1 天的 0 已不含
  })

  it('中间有空档时仍按「有记录的日子」推进，不补空白天', () => {
    // 11-01 / 11-10 / 11-25 三个记录日（中间全无记录）
    const out = movingAverage([
      r(day(2026, 11, 1), 0),
      r(day(2026, 11, 10), 5),
      r(day(2026, 11, 25), 10),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.accuracy).toBe(50) // (0+5+10)/30，三个记录日等权
    expect(new Date(out[0]!.at).getDate()).toBe(25)
  })

  it('同一天多轮只推进一天（不会因为一天两轮就提前出点）', () => {
    const out = movingAverage([
      r(day(2026, 11, 1), 10, 10),
      r(day(2026, 11, 2), 10, 10),
      r(day(2026, 11, 2), 0, 10), // 同日第二轮
    ])
    // 只有 2 个记录日 → 不出点
    expect(out).toEqual([])
  })

  it('window=1 退化为日均值（每个记录日一个点）', () => {
    const out = movingAverage(
      [r(day(2026, 11, 1), 4), r(day(2026, 11, 2), 8)],
      1,
    )
    expect(out.map((p) => p.accuracy)).toEqual([40, 80])
  })

  it('题数为 0 的轮次不产生 NaN', () => {
    const out = movingAverage([
      r(day(2026, 11, 1), 0, 0),
      r(day(2026, 11, 2), 0, 0),
      r(day(2026, 11, 3), 0, 0),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.accuracy).toBe(0)
  })
})
