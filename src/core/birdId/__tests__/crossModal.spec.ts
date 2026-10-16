import { describe, it, expect } from 'vitest'
import { compare, type CrossResult } from '../crossModal'

const A = (over: Partial<CrossResult> = {}): CrossResult => ({
  modality: 'audio',
  speciesId: 'turdus-merula',
  label: 'Turdus merula_Common Blackbird',
  score: 0.62,
  ...over,
})

describe('跨模态互证判定', () => {
  it('两路一致 → 判为互相印证，且不再建议换模态', () => {
    const v = compare(A(), A({ modality: 'image' }), true)
    expect(v.agree).toBe(true)
    expect(v.suggest).toBeNull()
    expect(v.textKey).toBe('birdId.cross.agree')
  })

  it('第一路没认出种 → 建议换照片（最该换的时候）', () => {
    const v = compare(A({ speciesId: null }), null, true)
    expect(v.degraded).toBe(true)
    expect(v.suggest).toBe('image')
    expect(v.textKey).toBe('birdId.cross.noSpecies')
  })

  it('认出了种但项目没有另一模态素材 → 不建议换（换了也没东西印证）', () => {
    const v = compare(A(), null, false)
    expect(v.suggest).toBeNull()
    expect(v.textKey).toBe('birdId.cross.noOtherMedia')
  })

  it('认出种且有另一模态素材 → 建议去复核（不逼用户，留空文案由 UI 渲染）', () => {
    const v = compare(A(), null, true)
    expect(v.suggest).toBe('image')
    expect(v.textKey).toBe('')
  })

  it('两路冲突 → 明说可能是某一路认错，不硬圆场', () => {
    const v = compare(A(), A({ modality: 'image', speciesId: 'erithacus-rubecula' }), true)
    expect(v.agree).toBe(false)
    expect(v.suggest).toBeNull()
    expect(v.textKey).toBe('birdId.cross.mismatch')
  })

  it('第二路反而更笼统 → 以第一路为准', () => {
    const v = compare(A(), A({ modality: 'image', speciesId: null }), true)
    expect(v.degraded).toBe(true)
    expect(v.textKey).toBe('birdId.cross.imageWeaker')
  })
})
