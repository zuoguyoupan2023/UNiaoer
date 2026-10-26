import { describe, expect, it } from 'vitest'
import { formatMemoryTime, memoryRatingFor } from '../memoryRating'
import { MEMORY_PAIRS, MEMORY_THRESHOLDS_MS } from '../difficulty'

describe('memoryRatingFor（092 §4.2 三档硬阈值）', () => {
  it('看图版：≤40s 天才 / ≤60s 厉害 / 之后做完即再接再砺', () => {
    expect(memoryRatingFor('image', 0)).toBe('genius')
    expect(memoryRatingFor('image', 40_000)).toBe('genius') // 含边界
    expect(memoryRatingFor('image', 40_001)).toBe('awesome')
    expect(memoryRatingFor('image', 60_000)).toBe('awesome')
    expect(memoryRatingFor('image', 60_001)).toBe('good')
    expect(memoryRatingFor('image', 10 * 60_000)).toBe('good')
  })

  it('听音版阈值更宽（70/100s）', () => {
    expect(memoryRatingFor('audio', 40_000)).toBe('genius')
    expect(memoryRatingFor('audio', 70_000)).toBe('genius')
    expect(memoryRatingFor('audio', 70_001)).toBe('awesome')
    expect(memoryRatingFor('audio', 100_000)).toBe('awesome')
    expect(memoryRatingFor('audio', 100_001)).toBe('good')
  })

  it('阈值常量与 092 定稿一致（改阈值必须是有意行为）', () => {
    expect(MEMORY_THRESHOLDS_MS.image).toEqual({ genius: 40_000, awesome: 60_000 })
    expect(MEMORY_THRESHOLDS_MS.audio).toEqual({ genius: 70_000, awesome: 100_000 })
    expect(MEMORY_PAIRS).toBe(12)
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
