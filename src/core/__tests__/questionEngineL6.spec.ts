import { describe, it, expect } from 'vitest'
import { buildNameQuestions } from '../questionEngine'
import { L6_TIERS } from '../difficulty'
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
  names: { zh?: string; en?: string; sci?: string },
  family: string,
  has: { img?: boolean; aud?: boolean } = {},
): BankSpecies {
  return {
    id,
    nameZh: names.zh ?? '',
    nameEn: names.en,
    nameSci: names.sci ?? `${id} scientific`,
    family,
    commonness: 2,
    desc: '',
    location: '',
    habit: '',
    image: has.img === false ? null : asset(id, 'image'),
    audio: has.aud === false ? null : asset(id, 'audio'),
  }
}

/** 8 只甲科（zh+en+sci 名）+ 4 只乙科 + 1 只无中文名 + 1 只无图 */
const bank: BankSpecies[] = [
  ...['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((id) =>
    sp(id, { zh: `甲鸟${id}`, en: `Bird ${id}`, sci: `Jia ${id}` }, '甲科'),
  ),
  ...['b1', 'b2', 'b3', 'b4'].map((id) =>
    sp(id, { zh: `乙鸟${id}`, en: `Bird ${id}`, sci: `Yi ${id}` }, '乙科'),
  ),
  sp('nozh', { en: 'Nozh bird', sci: 'Nozh scientific' }, '丙科'),
  sp('noimg', { zh: '无图鸟', en: 'Noimg bird', sci: 'Noimg scientific' }, '丁科', { img: false }),
  sp('noaud', { zh: '无音鸟', en: 'Noaud bird', sci: 'Noaud scientific' }, '丁科', { aud: false }),
]

describe('buildNameQuestions（L6 半鸟人）', () => {
  it('全部选项都带素材且与 options 平行（图 6 选项）', async () => {
    const qs = await buildNameQuestions(bank, { type: 'image', count: 10 })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.tier).toBe(6)
      expect(q.answerMode).toBe('choice')
      expect(q.timeLimitSec).toBe(L6_TIERS.image.timeLimitSec)
      expect(q.options.length).toBe(L6_TIERS.image.optionCount)
      expect(q.optionsMedia?.length).toBe(q.options.length)
      expect(q.options).toContain(q.answer)
      expect(new Set(q.options).size).toBe(q.options.length)
      for (const m of q.optionsMedia ?? []) {
        expect(m.url).toBeTruthy()
        expect(m.type).toBe('image')
      }
      // 无图物种不能出现在任何选项里
      expect(q.optionIds).not.toContain('noimg')
    }
  })

  it('听音版 4 选项、限时 25s，且只用有音频的物种', async () => {
    const qs = await buildNameQuestions(bank, { type: 'audio', count: 10 })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.options.length).toBe(L6_TIERS.audio.optionCount)
      expect(q.timeLimitSec).toBe(L6_TIERS.audio.timeLimitSec)
      for (const m of q.optionsMedia ?? []) expect(m.type).toBe('audio')
      expect(q.optionIds).not.toContain('noaud')
    }
  })

  it('中文卷不收无中文名的种（严格本体系，不跨卷）', async () => {
    const qs = await buildNameQuestions(bank, { type: 'image', count: 10 })
    for (const q of qs) {
      expect(q.optionIds).not.toContain('nozh')
      expect(q.answer).not.toBe('')
    }
  })

  it('学名卷：题干与全部选项都是学名（D-8 体系锁定）', async () => {
    const qs = await buildNameQuestions(bank, { type: 'image', count: 10, nameMode: 'sci' })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.nameMode).toBe('sci')
      for (const name of q.options) expect(name).toMatch(/^(Jia|Yi|Nozh|Noimg|Noaud) /)
      expect(q.options).toContain(q.answer)
    }
  })

  it('英文卷：选项用英文名', async () => {
    const qs = await buildNameQuestions(bank, { type: 'image', count: 10, nameMode: 'en' })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.nameMode).toBe('en')
      for (const name of q.options) expect(name).toMatch(/^(Bird |Nozh bird|Noimg bird|Noaud bird)/)
    }
  })

  it('干扰项同科优先（same 策略：同科够时全同科）', async () => {
    const qs = await buildNameQuestions(bank, { type: 'image', count: 10 })
    const byId = new Map(bank.map((s) => [s.id, s]))
    for (const q of qs) {
      const answer = byId.get(q.optionIds[q.options.indexOf(q.answer)]!)
      if (answer?.family !== '甲科') continue // 只对甲科答案断言（同科候选充足）
      const sameFamily = q.optionIds.filter((id) => byId.get(id)?.family === '甲科').length
      expect(sameFamily).toBe(L6_TIERS.image.optionCount)
      break
    }
  })

  it('轮内答案不重复；每题媒体取自答案物种（记录/署名语义与经典卷一致）', async () => {
    const qs = await buildNameQuestions(bank, { type: 'image', count: 10 })
    const answerIds = qs.map((q) => q.optionIds[q.options.indexOf(q.answer)])
    expect(new Set(answerIds).size).toBe(answerIds.length)
    for (const q of qs) {
      const answerId = q.optionIds[q.options.indexOf(q.answer)]
      expect(q.media.speciesId).toBe(answerId)
      // 题干名与答案名一致（题干就是名字本身）
      expect(q.optionsMedia?.[q.options.indexOf(q.answer)]?.url).toBe(q.media.url)
    }
  })

  it('池子不足一个整题的选项数时不出题', async () => {
    const tiny = ['x1', 'x2', 'x3'].map((id) => sp(id, { zh: `小池${id}` }, '小科'))
    const qs = await buildNameQuestions(tiny, { type: 'image', count: 10 })
    expect(qs).toEqual([])
  })

  it('中文卷受名字覆盖影响池变小：无中文名的种不进池（观测计数）', async () => {
    let stats: { unique: number } | null = null
    await buildNameQuestions(bank, {
      type: 'image',
      count: 10,
      onStats: (s) => (stats = s),
    })
    // 15 种里：无中文名 1（nozh）+ 无图 1（noimg）→ 13 可玩 ∧ 有中文名
    expect(stats!.unique).toBe(13)
  })
})
