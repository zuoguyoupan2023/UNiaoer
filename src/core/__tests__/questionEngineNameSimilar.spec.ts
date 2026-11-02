import { describe, it, expect } from 'vitest'
import { pickDistractorPairs, buildNameQuestions, buildSimilarQuestions } from '../questionEngine'
import { TIERS, L6_TIERS, TIER_LIST, S1_ENABLED } from '../difficulty'
import type { BankSpecies } from '../bank'
import type { MediaAsset } from '@/types'

function asset(id: string, type: 'image' | 'audio'): MediaAsset {
  return {
    id,
    speciesId: id,
    type,
    url: `https://example.test/${id}.${type === 'image' ? 'jpg' : 'mp3'}`,
    license: 'CC-BY',
    licenseUrl: '',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

function sp(id: string, nameZh: string, nameEn: string, family: string): BankSpecies {
  return {
    id,
    nameZh,
    nameEn,
    nameSci: `${id} scientific`,
    family,
    commonness: 2,
    desc: '',
    location: '',
    habit: '',
    image: asset(id, 'image'),
    audio: asset(id, 'audio'),
  }
}

// 099 §3.1 的回退链四层：同组(白头) / 同色异部位(白腹/白眉) / 同科无色 / 无关
const target = sp('target', '白头鹎', 'Light-vented Bulbul', '鹎科')
const bank: BankSpecies[] = [
  target,
  ...['g1', 'g2', 'g3'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, '其他科')), // 同 (白,头)
  sp('c1', '白腹鸟', 'White-bellied Bird', '其他科'), // 同色异部位
  sp('c2', '白眉鸟', 'White-browed Bird', '鹎科'), // 同色异部位 + 同科
  sp('f1', '鹎科鸟', 'Bulbul Bird', '鹎科'), // 同科无色
  ...['r1', 'r2'].map((id) => sp(id, `杂鸟${id}`, `Misc ${id}`, '杂科')),
]

describe('pickDistractorPairs（nameSimilar 策略 = 引擎能力，供 S1 系模式用）', () => {
  it('同组充足时全部来自同 (色,部位) 组', () => {
    const picked = pickDistractorPairs(target, bank, 3, 'nameSimilar')
    expect(picked.map((p) => p.id).sort()).toEqual(['g1', 'g2', 'g3'])
  })

  it('同组不足 3 → 回退同色，再同科，最后其余（桶间顺序确定）', () => {
    const pool = [target, sp('g0', '白头鸟', 'White-headed Bird', '其他科'), sp('c1', '白腹鸟', 'White-bellied Bird', '甲科'), sp('f1', '鹎科鸟', 'Bulbul Bird', '鹎科'), sp('r1', '杂鸟', 'Misc Bird', '杂科')]
    const picked = pickDistractorPairs(target, pool, 3, 'nameSimilar')
    const ids = picked.map((p) => p.id)
    expect(ids).toContain('g0') // 同组必进
    expect(ids.slice(1)).toEqual(expect.arrayContaining(['c1', 'f1'])) // 第二层同色 + 第三层同科
    expect(ids).not.toContain('r1') // 其余层只在前层不足时才被取到
  })

  it('组内按答案名去重（used 集合），不会推出同名干扰项', () => {
    const pool = [target, target, sp('dup', '白头鹎', 'Light-vented Bulbul', '鹎科'), sp('g1', '白头鸟', 'White-headed Bird', '其他科')]
    const picked = pickDistractorPairs(target, pool, 2, 'nameSimilar')
    expect(picked.map((p) => p.name)).not.toContain('白头鹎')
  })

  it('无 token 的种（八哥类）落回同科/其余层——解析不出不是错误', () => {
    const baghe = sp('myna', '八哥', 'Crested Myna', '椋鸟科')
    const pool = [baghe, sp('s1', '鹩哥', 'Common Hill Myna', '椋鸟科'), sp('r1', '杂鸟', 'Misc', '杂科')]
    const picked = pickDistractorPairs(baghe, pool, 1, 'nameSimilar')
    expect(picked.map((p) => p.id)).toEqual(['s1']) // 同科兜底
  })

  it('中英并集组身份：en 组员能被 zh 答案的组召回（099 §2.6）', () => {
    const zhTarget = sp('t2', '红嘴鸥', 'Black-headed Gull', '鸥科')
    const pool = [
      zhTarget,
      sp('en-mate', '无名氏', 'Black-headed Gull-lookalike', '鸻科'), // en (黑,头) 同组
      sp('zh-mate', '红嘴山鸦', 'Chough', '鸦科'), // zh (红,嘴) 同组
    ]
    const picked = pickDistractorPairs(zhTarget, pool, 2, 'nameSimilar')
    expect(picked.map((p) => p.id).sort()).toEqual(['en-mate', 'zh-mate'])
  })
})

describe('档位配置（2026-11-03 用户拍板：token 相似不混入 L1–L8）', () => {
  it('L1–L6 干扰项策略全部维持原状', () => {
    expect(TIERS[1].distractor).toBe('cross')
    expect(TIERS[2].distractor).toBe('mixed')
    expect(TIERS[3].distractor).toBe('same')
    expect(TIERS[4].distractor).toBe('same')
    expect(TIERS[5].distractor).toBe('same')
    expect(L6_TIERS.image.distractor).toBe('same')
    expect(L6_TIERS.audio.distractor).toBe('same')
  })

  it('S1 = 独立 tier 9，默认不上架、排在 L8 之后', () => {
    expect(TIERS[9].tier).toBe(9)
    expect(TIERS[9].labelKey).toBe('difficulty.s1.label')
    expect(S1_ENABLED).toBe(false)
    expect(TIER_LIST.some((t) => t.tier === 9)).toBe(false)
    expect(TIER_LIST.some((t) => t.tier === 8)).toBe(false) // L8 也未上架
  })

  it('L6 仍 same：token 组员不改变 L6 的同科优先', async () => {
    // 答案锁定 target；同科无色种 5 只 + 跨科同 token 组员 5 只 → L6 干扰项全来自同科
    const l6bank: BankSpecies[] = [
      target,
      ...['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => sp(id, `鹎科鸟${id}`, `Bulbul ${id}`, '鹎科')),
      ...['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
    ]
    const qs = await buildNameQuestions(l6bank, { type: 'image', count: 1, speciesPool: new Set(['target']) })
    expect(qs.length).toBe(1)
    const distractorIds = qs[0]!.optionIds.filter((id) => id !== 'target')
    expect(distractorIds.sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5'])
  })
})

describe('buildSimilarQuestions（S1 相似种挑战，严格同组）', () => {
  it('答案与全部选项来自同一 (色,部位) 组；tier=9', async () => {
    const s1bank: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      sp('x1', '杂鸟', 'Misc Bird', '杂科'),
      sp('c1', '白腹鸟', 'White-bellied Bird', '杂科'), // 同色异部位——组不够 6，不当答案也不进选项
    ]
    const qs = await buildSimilarQuestions(s1bank, { type: 'image', count: 1 })
    expect(qs.length).toBe(1)
    const q = qs[0]!
    expect(q.tier).toBe(9)
    expect(q.options.length).toBe(6)
    const names = new Set(q.options)
    expect(names.size).toBe(6)
    for (const n of names) expect(n.startsWith('白头鸟')).toBe(true) // 全部来自 (白,头) 组
  })

  it('组内不足 optionCount 的种不出题（宁缺毋滥，无回退）', async () => {
    const smallBank: BankSpecies[] = [
      sp('a1', '白头鸟', 'White-headed Bird', '甲科'),
      sp('a2', '白头鸟二', 'White-headed Bird 2', '乙科'),
      sp('r1', '杂鸟', 'Misc', '杂科'),
    ]
    const qs = await buildSimilarQuestions(smallBank, { type: 'image', count: 10 })
    expect(qs).toEqual([])
  })

  it('nameMode 过滤在前：en 卷只用有英文名的种（051 S1）', async () => {
    const mixed: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      sp('noen', '白头无名', '', '科x'), // 无英文名 → en 卷整体不可用
    ]
    const qs = await buildSimilarQuestions(mixed, { type: 'image', count: 1, nameMode: 'en' })
    expect(qs.length).toBe(1)
    for (const id of qs[0]!.optionIds) expect(id).not.toBe('noen')
  })

  it('一鸟多组取最大组；同名去重后不足整题则换候选', async () => {
    // g* 组 7 只（白,头）；dup 组 2 只（白,翅）
    const s1bank: BankSpecies[] = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`))
    const qs = await buildSimilarQuestions(s1bank, { type: 'audio', count: 3 })
    expect(qs.length).toBe(3)
    for (const q of qs) {
      expect(q.options.length).toBe(6)
      expect(q.timeLimitSec).toBe(TIERS[9].timeLimitSecAudio)
    }
  })

  it('speciesPool：答案只出池内，干扰项仍取全池同组（013 §4 同构）', async () => {
    const s1bank: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      sp('x1', '白头圈外', 'White-headed Outsider', '外科'), // 同组但不在赛制池
    ]
    const pool = new Set(['g0', 'g1', 'g2', 'g3', 'g4', 'g5'])
    const qs = await buildSimilarQuestions(s1bank, { type: 'image', count: 10, speciesPool: pool })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      const answerIdx = q.options.indexOf(q.answer)
      expect(pool.has(q.optionIds[answerIdx] ?? '')).toBe(true) // 答案必在池内（x1 绝不作答案）
      for (const id of q.optionIds) expect(id === 'x1' || pool.has(id)).toBe(true) // 选项 ⊆ 池 ∪ 同组圈外
    }
  })
})
