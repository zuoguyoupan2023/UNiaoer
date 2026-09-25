import { describe, it, expect } from 'vitest'
import { AUTO_NEXT_DELAY_MS, OPTION_REVEAL_RATIO, optionsHiddenFor } from '../pacing'

describe('pacing', () => {
  it('不限时不隐藏', () => {
    expect(optionsHiddenFor(undefined, null)).toBe(false)
    expect(optionsHiddenFor(undefined, 0)).toBe(false)
  })

  it('刚开始（timeLeft 为 null）按已用时 0 处理 → 隐藏', () => {
    expect(optionsHiddenFor(20, null)).toBe(true)
  })

  it('前 1/3 时间内隐藏，到达 1/3 后显示', () => {
    // 20s 限时：1/3 ≈ 6.67s
    expect(optionsHiddenFor(20, 20)).toBe(true)
    expect(optionsHiddenFor(20, 15)).toBe(true) // 已用 5s
    expect(optionsHiddenFor(20, 13)).toBe(false) // 已用 7s
  })

  it('比例常量为 1/3，自动延时为 2000ms', () => {
    expect(OPTION_REVEAL_RATIO).toBeCloseTo(1 / 3)
    expect(AUTO_NEXT_DELAY_MS).toBe(2000)
  })
})
