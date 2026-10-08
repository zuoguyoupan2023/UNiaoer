/**
 * 029 M3:质量降级判定（isDegraded）单测。
 */
import { describe, expect, it } from 'vitest'
import { isDegraded } from '../quality.mjs'

const M = (url) => ({ url })

describe('isDegraded（029 M3 质量降级判定）', () => {
  it('全部素材被隔离 → 降级', () => {
    const rec = { images: [M('a1'), M('a2')], audios: [M('b1')] }
    expect(isDegraded(rec, new Set(['a1', 'a2', 'b1']))).toBe(true)
  })

  it('某类型有素材但全被隔离 → 降级（即使另一类型完好）', () => {
    expect(isDegraded({ images: [M('a1')], audios: [M('b1')] }, new Set(['a1']))).toBe(true)
  })

  it('部分素材被隔离（还有替补）→ 不降级', () => {
    expect(isDegraded({ images: [M('a1'), M('a2')], audios: [] }, new Set(['a1']))).toBe(false)
  })

  it('无隔离清单 / 空清单 → 不降级', () => {
    expect(isDegraded({ images: [M('a1')] }, new Set())).toBe(false)
    expect(isDegraded({ images: [M('a1')] }, null)).toBe(false)
  })

  it('无素材的种 → 不降级（本就 playable=false，语义上不属于"降级"）', () => {
    expect(isDegraded({ images: [], audios: [] }, new Set(['x']))).toBe(false)
  })

  it('兼容旧单值 image/audio 形态', () => {
    expect(isDegraded({ image: M('a1'), audio: null }, new Set(['a1']))).toBe(true)
    expect(isDegraded({ image: null, audio: M('b1') }, new Set(['b1']))).toBe(true)
  })
})
