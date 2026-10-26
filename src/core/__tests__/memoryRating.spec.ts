import { describe, expect, it } from 'vitest'
import { formatMemoryTime, memoryRatingFor } from '../memoryRating'
import { MEMORY_BOARDS, MEMORY_DEFAULT_BOARD } from '../difficulty'

describe('memoryRatingFor（092 §4.2 三档硬阈值）', () => {
  it('标准盘（12 对）看图：≤40s 天才 / ≤60s 厉害 / 之后做完即再接再砺', () => {
    const n = MEMORY_BOARDS.standard.pairs
    expect(memoryRatingFor('image', 0, n)).toBe('genius')
    expect(memoryRatingFor('image', 40_000, n)).toBe('genius') // 含边界
    expect(memoryRatingFor('image', 40_001, n)).toBe('awesome')
    expect(memoryRatingFor('image', 60_000, n)).toBe('awesome')
    expect(memoryRatingFor('image', 60_001, n)).toBe('good')
    expect(memoryRatingFor('image', 10 * 60_000, n)).toBe('good')
  })

  it('标准盘听音阈值更宽（70/100s）', () => {
    const n = MEMORY_BOARDS.standard.pairs
    expect(memoryRatingFor('audio', 40_000, n)).toBe('genius')
    expect(memoryRatingFor('audio', 70_000, n)).toBe('genius')
    expect(memoryRatingFor('audio', 70_001, n)).toBe('awesome')
    expect(memoryRatingFor('audio', 100_000, n)).toBe('awesome')
    expect(memoryRatingFor('audio', 100_001, n)).toBe('good')
  })

  it('缩小盘（6 对）阈值独立（约减半暂定），与标准盘互不串档', () => {
    const n = MEMORY_BOARDS.compact.pairs
    expect(memoryRatingFor('image', 20_000, n)).toBe('genius')
    expect(memoryRatingFor('image', 20_001, n)).toBe('awesome')
    expect(memoryRatingFor('image', 30_001, n)).toBe('good')
    // 标准盘下同样的用时只是"厉害"，缩小盘阈值更严
    expect(memoryRatingFor('image', 25_000, MEMORY_BOARDS.standard.pairs)).toBe('genius')
    expect(memoryRatingFor('audio', 35_000, n)).toBe('genius')
    expect(memoryRatingFor('audio', 50_001, n)).toBe('good')
  })

  it('阈值常量与定稿一致（改阈值必须是有意行为）', () => {
    expect(MEMORY_BOARDS.standard.thresholds.image).toEqual({ genius: 40_000, awesome: 60_000 })
    expect(MEMORY_BOARDS.standard.thresholds.audio).toEqual({ genius: 70_000, awesome: 100_000 })
    expect(MEMORY_BOARDS.standard.pairs).toBe(12)
    expect(MEMORY_BOARDS.compact.pairs).toBe(6)
    expect(MEMORY_DEFAULT_BOARD).toBe('standard')
  })

  it('未知对数回退标准盘（旧记录/异常输入不出错）', () => {
    expect(memoryRatingFor('image', 39_000, 99)).toBe('genius')
    expect(memoryRatingFor('image', 41_000, 99)).toBe('awesome')
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
