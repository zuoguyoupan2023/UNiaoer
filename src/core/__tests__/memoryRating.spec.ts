import { describe, expect, it } from 'vitest'
import { formatMemoryTime, memoryRatingFor, memoryThresholdSec } from '../memoryRating'
import { MEMORY_BOARDS, MEMORY_DEFAULT_BOARD } from '../difficulty'

describe('memoryRatingFor（2026-10-27 改定：大盘 60/90s、小盘 30/60s，图音同一套）', () => {
  const std = MEMORY_BOARDS.standard.pairs
  const mini = MEMORY_BOARDS.compact.pairs

  it('大盘：≤60s 天才 / ≤90s 厉害 / 之后做完即再接再砺', () => {
    expect(memoryRatingFor(0, std)).toBe('genius')
    expect(memoryRatingFor(60_000, std)).toBe('genius') // 含边界
    expect(memoryRatingFor(60_001, std)).toBe('awesome')
    expect(memoryRatingFor(90_000, std)).toBe('awesome')
    expect(memoryRatingFor(90_001, std)).toBe('good')
    expect(memoryRatingFor(10 * 60_000, std)).toBe('good')
  })

  it('小盘：≤30s 天才 / ≤60s 厉害 / 之后做完即再接再砺', () => {
    expect(memoryRatingFor(30_000, mini)).toBe('genius')
    expect(memoryRatingFor(30_001, mini)).toBe('awesome')
    expect(memoryRatingFor(60_000, mini)).toBe('awesome')
    expect(memoryRatingFor(60_001, mini)).toBe('good')
  })

  it('同一用时在两档盘面得到不同评语（阈值真的按盘面走）', () => {
    // 50s：大盘仍是天才，小盘已掉到厉害
    expect(memoryRatingFor(50_000, std)).toBe('genius')
    expect(memoryRatingFor(50_000, mini)).toBe('awesome')
  })

  it('常量与定稿一致（改阈值必须是有意行为）', () => {
    expect(MEMORY_BOARDS.standard.geniusMs).toBe(60_000)
    expect(MEMORY_BOARDS.standard.awesomeMs).toBe(90_000)
    expect(MEMORY_BOARDS.compact.geniusMs).toBe(30_000)
    expect(MEMORY_BOARDS.compact.awesomeMs).toBe(60_000)
    expect(std).toBe(12)
    expect(mini).toBe(6)
    expect(MEMORY_DEFAULT_BOARD).toBe('standard')
  })

  it('memoryThresholdSec 与判定同源（结果页提示不会说错）', () => {
    expect(memoryThresholdSec(std)).toEqual({ genius: 60, awesome: 90 })
    expect(memoryThresholdSec(mini)).toEqual({ genius: 30, awesome: 60 })
  })

  it('未知对数回退标准盘（旧记录/异常输入不出错）', () => {
    expect(memoryRatingFor(59_000, 99)).toBe('genius')
    expect(memoryRatingFor(61_000, 99)).toBe('awesome')
  })
})

describe('formatMemoryTime', () => {
  it('一分钟内显示到 0.1 秒', () => {
    expect(formatMemoryTime(0)).toBe('0.0″')
    expect(formatMemoryTime(39_950)).toBe('40.0″') // 阈值边界的展示形态
    expect(formatMemoryTime(59_940)).toBe('59.9″')
  })

  it('超过一分钟显示 分′秒″，进位归入下一分钟', () => {
    expect(formatMemoryTime(61_000)).toBe('1′01″')
    expect(formatMemoryTime(75_300)).toBe('1′15″')
    expect(formatMemoryTime(59_960)).toBe('1′00″') // 59.96s → 四舍五入 60s → 进位
  })

  it('负值/异常输入不产生负数', () => {
    expect(formatMemoryTime(-5)).toBe('0.0″')
  })
})
