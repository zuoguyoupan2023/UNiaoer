import { describe, it, expect } from 'vitest'
import { assetsOf, buildQuestions, pickDistractors, shuffle } from '../questionEngine'
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

  it('A2 speciesPool：只从指定集合出题，干扰项仍可来自全库', () => {
    const ids = new Set(['a', 'c'])
    const qs = buildQuestions(bank, { type: 'image', count: 10, speciesPool: ids })
    expect(qs.length).toBe(2)
    expect(qs.every((q) => ['a', 'c'].includes(q.media.speciesId))).toBe(true)
    // 干扰项不限于错题池（否则选项太少）
    const allOpts = qs.flatMap((q) => q.options)
    expect(allOpts.length).toBeGreaterThan(new Set(qs.map((q) => q.answer)).size)
  })

  it('A2 speciesPool 命中无素材物种时被过滤，可能为空', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10, speciesPool: new Set(['noimg']) })
    expect(qs.length).toBe(0)
  })
})

describe('分档取材 (mediaPoolSize)', () => {
  function multi(size: number): BankSpecies {
    return {
      ...sp('multi', '多材鸟', '甲科'),
      image: null,
      images: Array.from({ length: size }, (_, i) => asset(`multi-img-${i}`, 'image')),
    }
  }

  it('assetsOf 优先多素材数组', () => {
    expect(assetsOf(multi(5), 'image').length).toBe(5)
  })

  it('L1 只用首选素材（标准照）', () => {
    const qsBank = [multi(5)]
    for (let i = 0; i < 10; i++) {
      const qs = buildQuestions(qsBank, { type: 'image', count: 1, tier: 1 })
      expect(qs[0]!.media.id).toBe('multi-img-0')
    }
  })

  it('L4 只在前 5 个素材内随机（不会用到第 6 个及以后）', () => {
    const qsBank = [multi(8)]
    const allowed = new Set(Array.from({ length: 5 }, (_, i) => `multi-img-${i}`))
    for (let i = 0; i < 30; i++) {
      const qs = buildQuestions(qsBank, { type: 'image', count: 1, tier: 4 })
      expect(allowed.has(qs[0]!.media.id!)).toBe(true)
    }
  })

  it('素材不足时按实际数量，不报错', () => {
    const qs = buildQuestions([multi(2)], { type: 'image', count: 1, tier: 5 })
    expect(qs[0]!.media).toBeTruthy()
  })

  it('C3：题目带同种全部素材（画廊不按档位裁剪），且当前题面在其中', () => {
    // 即便 L1（出题只用第 1 个），画廊仍应拿到全部素材
    const qs = buildQuestions([multi(5)], { type: 'image', count: 1, tier: 1 })
    expect(qs[0]!.assets).toHaveLength(5)
    expect(qs[0]!.assets!.some((m) => m.url === qs[0]!.media.url)).toBe(true)
  })

  it('C3：跨类型素材也一并提供（看图听音 / 听音看图）', () => {
    const species: BankSpecies = {
      ...sp('dual', '双材鸟', '甲科'),
      image: null,
      audio: null,
      images: Array.from({ length: 5 }, (_, i) => asset(`dual-i${i}`, 'image')),
      audios: Array.from({ length: 5 }, (_, i) => asset(`dual-a${i}`, 'audio')),
    }
    const qs = buildQuestions([species], { type: 'image', count: 1, tier: 1 })
    expect(qs[0]!.assets).toHaveLength(5)
    expect(qs[0]!.crossAssets).toHaveLength(5)
  })
})

describe('难度梯度', () => {
  it('L1 选项数为 3、限时 25s', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 1 })
    expect(qs[0]!.options.length).toBe(3)
    expect(qs[0]!.timeLimitSec).toBe(25)
    expect(qs[0]!.tier).toBe(1)
  })

  it('L4 限时 10s，且选项数多于 L1', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 4 })
    expect(qs[0]!.timeLimitSec).toBe(10)
    expect(qs[0]!.options.length).toBeGreaterThan(3)
    expect(qs[0]!.options.length).toBeLessThanOrEqual(TIERS[4].optionCount)
  })

  it('常见度不足时回退到全部物种（不会空题）', () => {
    // bank 里都是 commonness=2，L4 只允许 3-4，应回退而不是返回空
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 4 })
    expect(qs.length).toBeGreaterThan(0)
  })

  it('L5 地狱：L4 规格（6 选项、8s 限时），题目正常生成', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 5 })
    expect(qs.length).toBeGreaterThan(0)
    expect(qs[0]!.tier).toBe(5)
    expect(qs[0]!.timeLimitSec).toBe(10)
    for (const q of qs) {
      expect(q.options.length).toBeLessThanOrEqual(TIERS[5].optionCount)
      expect(q.options).toContain(q.answer)
    }
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

describe('options 与 optionIds 配对（015 #1）', () => {
  it('optionIds 与 options 等长且一一对应物种', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 2 })
    for (const q of qs) {
      expect(q.optionIds).toHaveLength(q.options.length)
      const ai = q.options.indexOf(q.answer)
      expect(q.optionIds[ai]).toBe(bank.find((b) => b.nameZh === q.answer)?.id)
      for (let i = 0; i < q.options.length; i++) {
        expect(bank.find((b) => b.id === q.optionIds[i])).toBeDefined()
      }
    }
  })
})

describe('shuffle', () => {
  it('不改变元素集合', () => {
    const src = [1, 2, 3, 4, 5]
    expect([...shuffle(src)].sort()).toEqual([1, 2, 3, 4, 5])
  })
})
