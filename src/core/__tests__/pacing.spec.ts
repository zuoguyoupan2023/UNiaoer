import { describe, it, expect } from 'vitest'
import {
  AUTO_NEXT_DELAY_CORRECT_MS,
  AUTO_NEXT_DELAY_WRONG_MS,
  OPTION_REVEAL_RATIO,
  optionsHiddenFor,
  secondsUntilReveal,
} from '../pacing'
import { TIERS } from '../difficulty'

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

  it('可显式指定隐藏时长（如 L1：25s 限时、前 5s 隐藏）', () => {
    expect(optionsHiddenFor(25, 25, 5)).toBe(true) // 已用 0s
    expect(optionsHiddenFor(25, 21, 5)).toBe(true) // 已用 4s
    expect(optionsHiddenFor(25, 20, 5)).toBe(false) // 已用 5s，到点显示
  })

  it('L1 配置：25s 限时 + 5s 隐藏', () => {
    const l1 = TIERS[1]
    expect(l1.timeLimitSec).toBe(25)
    expect(l1.optionRevealSec).toBe(5)
    expect(optionsHiddenFor(25, 25, 5)).toBe(true)
    expect(optionsHiddenFor(25, 20, 5)).toBe(false)
  })

  it('比例常量为 1/3；答对自动 3000ms、都自动的错题 4000ms', () => {
    expect(OPTION_REVEAL_RATIO).toBeCloseTo(1 / 3)
    expect(AUTO_NEXT_DELAY_CORRECT_MS).toBe(3000)
    expect(AUTO_NEXT_DELAY_WRONG_MS).toBe(4000)
  })

  it('secondsUntilReveal：与 optionsHiddenFor 同步（null = 已显示），倒计时逐秒递减', () => {
    // L1：25s 限时、前 5s 隐藏
    expect(secondsUntilReveal(25, 25, 5)).toBe(5)
    expect(secondsUntilReveal(25, 23, 5)).toBe(3)
    expect(secondsUntilReveal(25, 21, 5)).toBe(1)
    expect(secondsUntilReveal(25, 20, 5)).toBeNull()
    // 与隐藏判定一致
    for (const left of [25, 24, 23, 22, 21, 20, 19]) {
      expect((secondsUntilReveal(25, left, 5) !== null)).toBe(optionsHiddenFor(25, left, 5))
    }
    // 比例隐藏：20s 限时 1/3 ≈ 6.67 → 7→…→1
    expect(secondsUntilReveal(20, 20)).toBe(7)
    expect(secondsUntilReveal(20, 15)).toBe(2)
    expect(secondsUntilReveal(20, 13)).toBeNull()
    // 不限时不显示倒计时
    expect(secondsUntilReveal(undefined, null)).toBeNull()
  })
})
