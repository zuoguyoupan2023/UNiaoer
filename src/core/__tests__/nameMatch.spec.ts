import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { acceptedAnswers, isCorrectAnswer } from '../nameMatch'
import { loadNameVariants, _resetNameVariantsCache, type NameVariant } from '../nameVariants'
import type { Question } from '@/types'

/** 最小 Question（判分只看 nameMode/answer/sci） */
function q(partial: Partial<Question>): Question {
  return {
    id: 'x',
    tier: 7,
    type: 'image',
    media: {} as Question['media'],
    answer: '',
    sci: '',
    family: '',
    options: [],
    optionIds: [],
    answerMode: 'choice',
    ...partial,
  }
}

/** stub fetch 返回成品子集并预载（测同步判分的变体路径） */
async function primeVariants(bySci: Record<string, NameVariant>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ bySci }) })),
  )
  await loadNameVariants()
}

describe('nameMatch（085 §4.1 判分口径）', () => {
  beforeEach(() => {
    _resetNameVariantsCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    _resetNameVariantsCache()
  })

  it('中文卷（未加载变体字典）：nameZh 精确匹配；空白归一；空/超时=错；体系锁定（D-8）', () => {
    const item = q({ answer: '白头鹎', sci: 'Pycnonotus sinensis', nameMode: 'zh' })
    expect(isCorrectAnswer(item, '白头鹎')).toBe(true)
    expect(isCorrectAnswer(item, '  白头鹎  ')).toBe(true)
    expect(isCorrectAnswer(item, '')).toBe(false)
    expect(isCorrectAnswer(item, null)).toBe(false)
    expect(isCorrectAnswer(item, '白头鸭')).toBe(false)
    // 跨体系一律判错（中文名卷不收学名/英文/拼音）
    expect(isCorrectAnswer(item, 'Pycnonotus sinensis')).toBe(false)
    expect(isCorrectAnswer(item, 'Light-vented Bulbul')).toBe(false)
    expect(isCorrectAnswer(item, 'baitoubei')).toBe(false)
  })

  it('学名卷：大小写不敏感、空白归一；缩写 P. sinensis 不接受', () => {
    const item = q({ answer: 'Pycnonotus sinensis', sci: 'Pycnonotus sinensis', nameMode: 'sci' })
    expect(isCorrectAnswer(item, 'pycnonotus sinensis')).toBe(true)
    expect(isCorrectAnswer(item, '  PYCNONOTUS   SINENSIS ')).toBe(true)
    expect(isCorrectAnswer(item, 'P. sinensis')).toBe(false)
    expect(isCorrectAnswer(item, '白头鹎')).toBe(false)
  })

  it('英文卷：大小写不敏感；中文/学名判错', () => {
    const item = q({ answer: 'Light-vented Bulbul', sci: 'Pycnonotus sinensis', nameMode: 'en' })
    expect(isCorrectAnswer(item, 'light-vented bulbul')).toBe(true)
    expect(isCorrectAnswer(item, '白头鹎')).toBe(false)
    expect(isCorrectAnswer(item, 'Pycnonotus sinensis')).toBe(false)
  })

  it('choice 题等价退化（answer 命中即对，旧行为）', () => {
    const item = q({ answer: '乌鸫', sci: 'Turdus merula', answerMode: 'choice' })
    expect(isCorrectAnswer(item, '乌鸫')).toBe(true)
    expect(isCorrectAnswer(item, '乌鹅')).toBe(false)
  })

  it('变体字典：港台名（不同词）与同词繁体字形都判对；混合词形判错（D-9）', async () => {
    await primeVariants({
      'Platalea minor': { tw: '黑面琵鷺', trad: '黑臉琵鷺' },
    })
    const item = q({ answer: '黑脸琵鹭', sci: 'Platalea minor', nameMode: 'zh' })
    expect(isCorrectAnswer(item, '黑脸琵鹭')).toBe(true) // 大陆简体
    expect(isCorrectAnswer(item, '黑面琵鷺')).toBe(true) // 港台正式名（不同词）
    expect(isCorrectAnswer(item, '黑臉琵鷺')).toBe(true) // 同词繁体字形
    expect(isCorrectAnswer(item, '黑脸琵鷺')).toBe(false) // 简体词+繁体字（不属于任何规范写法）
  })

  it('acceptedAnswers：中文卷集合含变体；sci 卷只有归一学名', async () => {
    await primeVariants({ 'Platalea minor': { tw: '黑面琵鷺' } })
    const zh = acceptedAnswers(q({ answer: '黑脸琵鹭', sci: 'Platalea minor', nameMode: 'zh' }))
    expect(zh.has('黑脸琵鹭')).toBe(true)
    expect(zh.has('黑面琵鷺')).toBe(true)
    const sci = acceptedAnswers(q({ answer: 'x', sci: 'Platalea minor', nameMode: 'sci' }))
    expect([...sci]).toEqual(['platalea minor'])
  })

  it('全角输入归一（中文卷全角空格/英文卷全角字母）', async () => {
    await primeVariants({})
    const zh = q({ answer: '白头鹎', sci: 'Pycnonotus sinensis', nameMode: 'zh' })
    expect(isCorrectAnswer(zh, '　白头鹎')).toBe(true) // 全角空格
    const en = q({ answer: 'Light-vented Bulbul', sci: 'x', nameMode: 'en' })
    expect(isCorrectAnswer(en, 'Ｌｉｇｈｔ-ｖｅｎｔｅｄ Ｂｕｌｂｕｌ'.toLowerCase())).toBe(true)
  })
})
