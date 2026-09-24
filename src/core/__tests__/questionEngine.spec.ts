import { describe, it, expect } from 'vitest'
import { buildQuestions, pickDistractors, shuffle } from '../questionEngine'
import { TIERS } from '../difficulty'
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

function sp(
  id: string,
  nameZh: string,
  family: string,
  has: { img?: boolean; aud?: boolean; commonness?: number } = {},
): BankSpecies {
  return {
    id,
    nameZh,
    nameSci: `${id} scientific`,
    family,
    commonness: has.commonness ?? 2,
    desc: '',
    location: '',
    habit: '',
    image: has.img === false ? null : asset(id, 'image'),
    audio: has.aud === false ? null : asset(id, 'audio'),
  }
}

const bank: BankSpecies[] = [
  sp('a', '甲鸟', '甲科'),
  sp('b', '乙鸟', '甲科'),
  sp('c', '丙鸟', '乙科'),
  sp('d', '丁鸟', '乙科'),
  sp('e', '戊鸟', '丙科'),
  sp('noimg', '无图鸟', '丁科', { img: false }),
]

describe('buildQuestions', () => {
  it('只使用具备所需媒体的物种', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10 })
    expect(qs.every((q) => q.type === 'image')).toBe(true)
    expect(qs.find((q) => q.answer === '无图鸟')).toBeUndefined()
    expect(qs.length).toBe(5)
  })

  it('音频模式只取有音频的物种', () => {
    const qs = buildQuestions(bank, { type: 'audio', count: 10 })
    expect(qs.length).toBe(6)
  })

  it('每题选项包含正确答案且无重复，数量不超过档位配置', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10, tier: 2 })
    for (const q of qs) {
      expect(q.options).toContain(q.answer)
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.options.length).toBeLessThanOrEqual(TIERS[2].optionCount)
    }
  })

  it('携带学名与科，便于反馈展示', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 1 })
    expect(qs[0]!.sci).toContain('scientific')
    expect(qs[0]!.family).toBeTruthy()
  })

  it('数量受 count 限制', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 2 })
    expect(qs.length).toBe(2)
  })
})

describe('难度梯度', () => {
  it('L1 选项数为 3、不限时', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 1 })
    expect(qs[0]!.options.length).toBe(3)
    expect(qs[0]!.timeLimitSec).toBeUndefined()
    expect(qs[0]!.tier).toBe(1)
  })

  it('L4 限时 8s，且选项数多于 L1', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 4 })
    expect(qs[0]!.timeLimitSec).toBe(8)
    expect(qs[0]!.options.length).toBeGreaterThan(3)
    expect(qs[0]!.options.length).toBeLessThanOrEqual(TIERS[4].optionCount)
  })

  it('常见度不足时回退到全部物种（不会空题）', () => {
    // bank 里都是 commonness=2，L4 只允许 3-4，应回退而不是返回空
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 4 })
    expect(qs.length).toBeGreaterThan(0)
  })
})

describe('pickDistractors', () => {
  it('mixed：优先放 1 个同科，且不含答案', () => {
    const target = bank[0]! // 甲鸟 / 甲科
    const names = pickDistractors(target, bank, 3, 'mixed')
    expect(names).not.toContain('甲鸟')
    expect(names[0]).toBe('乙鸟')
    expect(names.length).toBe(3)
  })

  it('cross：优先跨科（不同科在前）', () => {
    const target = bank[0]! // 甲科
    const names = pickDistractors(target, bank, 2, 'cross')
    // 乙鸟同科应排后，跨科的丙/丁/戊在前
    expect(names[0]).not.toBe('乙鸟')
  })

  it('same：同科优先', () => {
    const target = bank[0]!
    const names = pickDistractors(target, bank, 2, 'same')
    expect(names[0]).toBe('乙鸟')
  })
})

describe('shuffle', () => {
  it('不改变元素集合', () => {
    const src = [1, 2, 3, 4, 5]
    expect([...shuffle(src)].sort()).toEqual([1, 2, 3, 4, 5])
  })
})
