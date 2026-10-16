/**
 * 地域先验重排（src/core/birdId/regionPrior.ts）
 *
 * 存在理由：SpeciesNet 输出概率饱和到 99%+，按分数排等于按噪声排；
 * 而「你拍到的鸟在当地」是极强的真实约束（Merlin 认得准主要就靠它）。
 *
 * 这些用例把「不删候选」「null 不等于不存在」「同档位仍看分数」钉死。
 */
import { describe, it, expect } from 'vitest'
import { applyRegionPrior } from '../regionPrior'
import type { Candidate } from '../types'

const cand = (label: string, speciesId: string | null, score: number): Candidate => ({
  label,
  score,
  entry: { s: speciesId, t: speciesId ? 1 : 5, z: null },
  speciesId,
})

describe('applyRegionPrior', () => {
  const tiers = new Map([
    ['common-here', 1],
    ['mid-here', 3],
    ['rare-here', 5],
  ])

  it('按当地档位重排：档位小的排前面，即使模型分低', () => {
    const r = applyRegionPrior(
      [cand('a', 'unknown-here', 0.99), cand('b', 'common-here', 0.6), cand('c', 'mid-here', 0.8)],
      tiers,
    )
    expect(r.map((c) => c.speciesId)).toEqual(['common-here', 'mid-here', 'unknown-here'])
  })

  it('不删任何候选 —— 稀有鸟与迷鸟仍要展示', () => {
    const input = [cand('a', 'rare-here', 0.1), cand('b', null, 0.2)]
    expect(applyRegionPrior(input, tiers)).toHaveLength(2)
  })

  it('同档位内仍按模型分数排序', () => {
    const t = new Map([
      ['x', 2],
      ['y', 2],
    ])
    const r = applyRegionPrior([cand('a', 'x', 0.4), cand('b', 'y', 0.9)], t)
    expect(r.map((c) => c.speciesId)).toEqual(['y', 'x'])
  })

  it('查不到档位 = null，不是「当地没有」，且排在有档位的之后', () => {
    const r = applyRegionPrior([cand('a', 'no-record', 0.99), cand('b', 'rare-here', 0.5)], tiers)
    expect(r[0]!.regionTier).toBe(5)
    expect(r[1]!.regionTier).toBeNull()
  })

  it('无地区数据时原样返回（保持模型顺序，行为与加此层之前一致）', () => {
    const input = [cand('a', 'x', 0.9), cand('b', 'y', 0.8)]
    const r = applyRegionPrior(input, null)
    expect(r.map((c) => c.speciesId)).toEqual(['x', 'y'])
    expect(r.every((c) => c.regionTier === null)).toBe(true)
  })
})