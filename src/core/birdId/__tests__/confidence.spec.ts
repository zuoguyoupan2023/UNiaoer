import { describe, it, expect } from 'vitest'
import { bandOf, present, CONF_OK, CONF_LOW } from '../confidence'
import { TIER_GENUS, TIER_NONE, type BirdIdResult, type Candidate } from '../types'

/** 断言锚点来自 experiments/birdid/out/ACCURACY.md 的实测结论：
 *  top1 ≥30% 的子集 → top-3 准确率 82.1%；<10% 时不该展示候选。 */
const cand = (label: string, score: number, entry: Candidate['entry'], speciesId: string | null): Candidate => ({
  label,
  score,
  entry,
  speciesId,
})
const exact = { s: 'cettia-cetti', t: 1, z: '宽尾树莺', g: null }
// 「收录了但没素材」——判据是名录给的 p===false（不是 speciesId 缺失）
const noMedia = { s: 'anthracoceros-albirostris', t: 1, z: '东方冠斑犀鸟', g: null, p: false as const }
const genus = { s: null, t: TIER_GENUS, z: null, g: 'accipiter' }
const none = { s: null, t: TIER_NONE, z: null, g: null }

const res = (cs: Candidate[]): BirdIdResult => ({ candidates: cs, durationSec: 3, windows: 1 })

describe('bandOf 置信度分流', () => {
  it('阈值取自实测：≥30% 视为可信', () => {
    expect(bandOf(0.9)).toBe('ok')
    expect(bandOf(CONF_OK)).toBe('ok')
    expect(bandOf(CONF_OK - 0.001)).toBe('low')
    expect(bandOf(CONF_LOW)).toBe('low')
    expect(bandOf(CONF_LOW - 0.001)).toBe('none')
    expect(bandOf(0)).toBe('none')
  })
})

describe('present 三档行为', () => {
  it('高置信度：带上 speciesId，且低于噪声底线的尾部候选被抑制', () => {
    const v = present(res([cand('a', 0.98, exact, 'cettia-cetti'), cand('b', 0.02, exact, 'other'), cand('c', 0.01, exact, 'other2')]))
    expect(v.band).toBe('ok')
    expect(v.shown[0]!.speciesId).toBe('cettia-cetti')
    // 依据 ACCURACY.md：未命中时 top-1 置信度中位数只有 3.3%(iNat 池)/10.2%(R2 池)，
    // 所以 1~2% 的尾部基本是噪声，展示它们等于把用户往错种上引。
    expect(v.shown).toHaveLength(1)
    expect(v.all).toHaveLength(3) // 完整结果仍保留，调试/解释用
  })

  it('三个候选都在可信区间时全部展示', () => {
    const v = present(res([
      cand('a', 0.55, exact, 'x'),
      cand('b', 0.25, exact, 'y'),
      cand('c', 0.12, exact, 'z'),
    ]))
    expect(v.shown).toHaveLength(3)
  })

  it('低置信度：仍然展示（不再提示"不确定"——置信度不呈现给用户）', () => {
    const v = present(res([cand('a', 0.2, exact, 'x'), cand('b', 0.05, exact, 'y')]))
    expect(v.band).toBe('low')
    expect(v.shown.length).toBeGreaterThan(0)
    // 不再出现任何置信度数字或「不确定」字样：文案是 i18n key，不含数字
    expect(v.messageKey).not.toContain('%')
    expect(v.messageKey).not.toContain('confidence')
  })

  it('极低置信度：不展示任何候选（避免误导）', () => {
    const v = present(res([cand('a', 0.09, exact, 'x'), cand('b', 0.05, exact, 'y')]))
    expect(v.band).toBe('none')
    expect(v.shown).toHaveLength(0)
    expect(v.all).toHaveLength(2) // 仍保留完整结果供调试
    // 文案 key 指向「没太听出来」那句
    expect(v.messageKey).toBe('birdId.band.none')
    expect(v.messageKey).not.toContain('%')
  })

  it('空结果也有话可说', () => {
    const v = present(res([]))
    expect(v.band).toBe('none')
    expect(v.messageKey).toBe('birdId.band.noResult')
    expect(v.messageKey).not.toContain('%')
  })
})

describe('present 三种状态标记（ACCURACY §5 UI 验收标准）', () => {
  it('标出「本项目收录了但暂无素材」（判据为 p===false）', () => {
    const v = present(res([cand('a', 0.9, noMedia, 'anthracoceros-albirostris')]))
    expect(v.hasMappedButNoMedia).toBe(true)
    expect(v.shown[0]!.speciesId).toBe('anthracoceros-albirostris')
  })

  it('标出「只能确定到属」', () => {
    const v = present(res([cand('a', 0.9, genus, null)]))
    expect(v.hasGenusOnly).toBe(true)
  })

  it('全是名录外的非鸟：给出明确解释而不是硬给候选', () => {
    const v = present(res([cand('frog', 0.8, none, null)]))
    expect(v.hasMappedButNoMedia).toBe(false)
    expect(v.messageKey).toBe('birdId.band.notOurBirds')
  })

  it('正常命中时 messageKey 留空（避免噪声）', () => {
    const v = present(res([cand('a', 0.9, exact, 'cettia-cetti')]))
    expect(v.messageKey).toBe('')
  })
})
