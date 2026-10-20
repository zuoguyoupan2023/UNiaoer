import { describe, it, expect } from 'vitest'
import { percentileSorted } from '../aggregate'

describe('percentileSorted(75)', () => {
  it('单窗原样返回', () => {
    expect(percentileSorted([0.42])).toBeCloseTo(0.42, 6)
  })

  it('两窗与 numpy 的线性插值一致', () => {
    // np.percentile([0.1, 0.9], 75) = 0.7
    expect(percentileSorted([0.1, 0.9])).toBeCloseTo(0.7, 6)
  })

  it('三窗与 numpy 的线性插值一致', () => {
    // np.percentile([0.1, 0.5, 0.9], 75) = 0.7
    expect(percentileSorted([0.1, 0.5, 0.9])).toBeCloseTo(0.7, 6)
  })

  it('空数组安全返回 0', () => {
    expect(percentileSorted([])).toBe(0)
  })

  it('不修改原数组（调用方仍可复用排序结果）', () => {
    const a = [0.1, 0.5, 0.9]
    percentileSorted(a)
    expect(a).toEqual([0.1, 0.5, 0.9])
  })
})
