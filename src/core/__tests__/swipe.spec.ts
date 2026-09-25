import { describe, it, expect } from 'vitest'
import { isLeftSwipe, SWIPE_MAX_DY, SWIPE_MIN_DX } from '../swipe'

describe('swipe', () => {
  it('向左滑动超过阈值且纵向偏移小 → 成立', () => {
    expect(isLeftSwipe(-SWIPE_MIN_DX, 0)).toBe(true)
    expect(isLeftSwipe(-120, 10)).toBe(true)
  })

  it('位移不足或纵向偏移过大 → 不成立', () => {
    expect(isLeftSwipe(-(SWIPE_MIN_DX - 1), 0)).toBe(false)
    expect(isLeftSwipe(-120, SWIPE_MAX_DY + 1)).toBe(false)
    expect(isLeftSwipe(120, 0)).toBe(false)
  })
})
