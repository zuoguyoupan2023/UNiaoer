/**
 * 029 M0:常见度合成纯函数单测(logNorm / scoreSignals / tierOf / binomialName)。
 */
import { describe, expect, it } from 'vitest'
import { logNorm, scoreSignals, tierOf, binomialName, SIGNAL_CAPS, SIGNAL_WEIGHTS } from '../commonness-lib.mjs'

describe('logNorm', () => {
  it('0 / 负值 / 非数 → 0', () => {
    expect(logNorm(0, 100)).toBe(0)
    expect(logNorm(-5, 100)).toBe(0)
    expect(logNorm(Number.NaN, 100)).toBe(0)
    expect(logNorm(undefined, 100)).toBe(0)
  })

  it('达到参考上限 → 1；超过也 clamp 1', () => {
    expect(logNorm(SIGNAL_CAPS.xcRecordings, SIGNAL_CAPS.xcRecordings)).toBeCloseTo(1, 6)
    expect(logNorm(1e9, 1e7)).toBe(1)
  })

  it('单调递增且落在 [0,1]', () => {
    const a = logNorm(1, 1e7)
    const b = logNorm(1000, 1e7)
    const c = logNorm(1e6, 1e7)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(c).toBeLessThanOrEqual(1)
  })
})

describe('scoreSignals', () => {
  it('全零 → 0', () => {
    expect(scoreSignals({ gbifRecords: 0, countries: 0, xcRecordings: 0 })).toBe(0)
  })

  it('三信号全满 → 1', () => {
    expect(scoreSignals({ gbifRecords: 1e7, countries: 249, xcRecordings: 1e4 })).toBeCloseTo(1, 6)
  })

  it('权重:单信号满值 + 其他零 → 该信号权重', () => {
    expect(scoreSignals({ gbifRecords: 1e7, countries: 0, xcRecordings: 0 })).toBeCloseTo(SIGNAL_WEIGHTS.gbifRecords, 6)
    expect(scoreSignals({ gbifRecords: 0, countries: 249, xcRecordings: 0 })).toBeCloseTo(SIGNAL_WEIGHTS.countries, 6)
  })

  it('信号缺失时按实际参与的键重归一(缺失 GBIF 不会把全体推向稀有)', () => {
    // 只剩 countries 满值 → 归一到 1.0(而非 0.3)
    expect(scoreSignals({ countries: 249 })).toBeCloseTo(1, 6)
    // 空对象 → 0
    expect(scoreSignals({})).toBe(0)
  })
})

describe('tierOf', () => {
  it('五等分带边界(score 越高越常见)', () => {
    expect(tierOf(1)).toBe(1)
    expect(tierOf(0.8)).toBe(1)
    expect(tierOf(0.799)).toBe(2)
    expect(tierOf(0.6)).toBe(2)
    expect(tierOf(0.599)).toBe(3)
    expect(tierOf(0.4)).toBe(3)
    expect(tierOf(0.399)).toBe(4)
    expect(tierOf(0.2)).toBe(4)
    expect(tierOf(0.199)).toBe(5)
    expect(tierOf(0)).toBe(5)
  })

  it('非法输入按 0 处理', () => {
    expect(tierOf(Number.NaN)).toBe(5)
    expect(tierOf(-1)).toBe(5)
    expect(tierOf(undefined)).toBe(5)
  })
})

describe('binomialName', () => {
  it('双名归一:小写、去作者引文/三名法尾巴', () => {
    expect(binomialName('Turdus merula')).toBe('turdus merula')
    expect(binomialName('Turdus merula Linnaeus, 1758')).toBe('turdus merula')
    expect(binomialName('Corvus corone cornix')).toBe('corvus corone')
    expect(binomialName('  PASSER  domesticus ')).toBe('passer domesticus')
  })

  it('空值 → 空串', () => {
    expect(binomialName('')).toBe('')
    expect(binomialName(undefined)).toBe('')
  })
})
