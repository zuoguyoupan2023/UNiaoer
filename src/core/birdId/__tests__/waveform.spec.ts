import { describe, expect, it } from 'vitest'
import { computePeaks } from '../waveform'

describe('computePeaks', () => {
  it('空样本返回全 0，且长度等于桶数', () => {
    const p = computePeaks(new Float32Array(0), 8)
    expect(p.length).toBe(8)
    expect(Array.from(p)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('取每桶绝对值的最大值（负峰值也算）', () => {
    // 4 桶 × 2 点：[-1, 0.5] [0.25, -0.75] [0, 0] [0.1, 0.2]
    const p = computePeaks(new Float32Array([-1, 0.5, 0.25, -0.75, 0, 0, 0.1, 0.2]), 4)
    expect(p[0]).toBeCloseTo(1)
    expect(p[1]).toBeCloseTo(0.75)
    expect(p[2]).toBe(0)
    expect(p[3]).toBeCloseTo(0.2)
  })

  it('按本段最大值归一化：安静录音也能画满', () => {
    const p = computePeaks(new Float32Array([0.01, 0.02, 0.005, 0.015]), 2)
    expect(p[0]).toBeCloseTo(1) // 0.02 / 0.02
    expect(p[1]).toBeCloseTo(0.75) // 0.015 / 0.02
  })

  it('全静音不做除法（保持全 0）', () => {
    const p = computePeaks(new Float32Array(1024), 16)
    expect(p.every((v) => v === 0)).toBe(true)
  })

  it('桶数多于样本数时也不崩', () => {
    const p = computePeaks(new Float32Array([0.5, -0.5]), 10)
    expect(p.length).toBe(10)
    expect(p.some((v) => v === 1)).toBe(true)
  })
})
