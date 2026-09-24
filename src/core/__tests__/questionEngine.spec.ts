import { describe, it, expect } from 'vitest'
import { buildQuestions, pickDistractors, shuffle } from '../questionEngine'
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

function sp(id: string, nameZh: string, family: string, has: { img?: boolean; aud?: boolean }): BankSpecies {
  return {
    id,
    nameZh,
    nameSci: `${id} scientific`,
    family,
    commonness: 2,
    desc: '',
    location: '',
    habit: '',
    image: has.img === false ? null : asset(id, 'image'),
    audio: has.aud === false ? null : asset(id, 'audio'),
  }
}

const bank: BankSpecies[] = [
  sp('a', '甲鸟', '甲科', {}),
  sp('b', '乙鸟', '甲科', {}),
  sp('c', '丙鸟', '乙科', {}),
  sp('d', '丁鸟', '乙科', {}),
  sp('e', '戊鸟', '丙科', {}),
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

  it('每题选项包含正确答案且无重复', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10, optionCount: 4 })
    for (const q of qs) {
      expect(q.options).toContain(q.answer)
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.options.length).toBeLessThanOrEqual(4)
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

describe('pickDistractors', () => {
  it('优先同科，且不包含答案本身', () => {
    const target = bank[0]! // 甲鸟 / 甲科
    const names = pickDistractors(target, bank, 3)
    expect(names).not.toContain('甲鸟')
    expect(names[0]).toBe('乙鸟') // 同科优先
    expect(names.length).toBe(3)
  })
})

describe('shuffle', () => {
  it('不改变元素集合', () => {
    const src = [1, 2, 3, 4, 5]
    expect([...shuffle(src)].sort()).toEqual([1, 2, 3, 4, 5])
  })
})
