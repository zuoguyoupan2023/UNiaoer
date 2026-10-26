import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Manifest, BankSpecies } from '@/core/bank'
import { buildInputQuestions } from '@/core/questionEngine'

function asset(id: string, url: string, type: 'image' | 'audio') {
  return {
    id,
    speciesId: id,
    type,
    url,
    license: 'CC-BY',
    licenseUrl: '',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

function sp(id: string, nameZh: string): BankSpecies {
  return {
    id,
    nameZh,
    nameEn: `Bird ${id}`,
    nameSci: `${id} sci`,
    family: `科${Number(id.slice(1)) % 2}`,
    commonness: 3,
    desc: '',
    location: '',
    habit: '',
    image: asset(id, `https://img.test/${id}.jpg`, 'image'),
    audio: asset(id, `https://img.test/${id}.mp3`, 'audio'),
  }
}

const bank: BankSpecies[] = Array.from({ length: 30 }, (_, i) => sp(`s${i}`, `鸟${i}`))

const manifest: Manifest = {
  generatedAt: '',
  policy: 'relaxed',
  mediaMode: 'remote',
  total: 30,
  stats: { withImage: 30, withAudio: 30 },
  species: bank,
}

const { listRoundsMock, wrongBookMock } = vi.hoisted(() => ({
  listRoundsMock: vi.fn<() => Promise<unknown[]>>(),
  wrongBookMock: vi.fn<() => Promise<unknown[]>>(),
}))

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: vi.fn<() => Promise<Manifest>>(async () => manifest),
}))
vi.mock('@/core/historyDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/historyDb')>()),
  listRounds: (...args: unknown[]) => listRoundsMock(...(args as [])),
  getWrongBook: (...args: unknown[]) => wrongBookMock(...(args as [])),
}))

import { useQuizStore } from '../quiz'
import { isCorrectAnswer } from '@/core/nameMatch'

describe('引擎 buildInputQuestions（L7 输入题）', () => {
  it('answerMode=input、无选项、tier=7、限时按题型（图 15s / 音 18s）、素材池携带', async () => {
    const qs = await buildInputQuestions(bank, { type: 'image' })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.tier).toBe(7)
      expect(q.answerMode).toBe('input')
      expect(q.options).toEqual([])
      expect(q.optionIds).toEqual([])
      expect(q.timeLimitSec).toBe(15)
      expect(q.assets?.length).toBeGreaterThan(0)
      expect(q.answer).toBeTruthy()
    }
    const qa = await buildInputQuestions(bank, { type: 'audio' })
    for (const q of qa) expect(q.timeLimitSec).toBe(18)
  })

  it('池子语义与经典一致：无图物种不进题；nameMode 过滤在最前', async () => {
    const noImg: BankSpecies = { ...sp('noimg', '无图鸟'), image: null }
    const qs = await buildInputQuestions([...bank, noImg], { type: 'image' })
    expect(qs.every((q) => q.media.speciesId !== 'noimg')).toBe(true)
  })
})

describe('quiz store · L7 第七档（start tier=7）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listRoundsMock.mockResolvedValue([])
    wrongBookMock.mockResolvedValue([])
  })

  it('start tier=7：输入题 + 中心判分（nameZh 简体对；错词错）', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 7 })
    expect(quiz.error).toBe('')
    expect(quiz.tier).toBe(7)
    expect(quiz.total).toBe(10)
    for (const q of quiz.questions) {
      expect(q.answerMode).toBe('input')
      expect(q.options).toEqual([])
    }
    // 判分链路：答对第一题（用题目 answer）
    quiz.answer(quiz.questions[0]!.answer)
    expect(quiz.correctCount).toBe(1)
    // 错答自由文本判错
    quiz.index = 1
    quiz.answer('完全不存在的鸟')
    expect(quiz.correctCount).toBe(1)
  })

  it("L7 学名模式（nameMode 'sci'）与「再来一轮」保卷", async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 7, nameMode: 'sci' })
    expect(quiz.nameMode).toBe('sci')
    for (const q of quiz.questions) {
      expect(q.nameMode).toBe('sci')
      // 判分：完整学名（大小写不敏感）对；中文名错（D-8）
      expect(isCorrectAnswer(q, q.sci.toUpperCase())).toBe(true)
      expect(isCorrectAnswer(q, q.answer === q.sci ? '不是鸟名' : q.answer)).toBe(q.answer === q.sci)
    }
    await quiz.nextRound()
    expect(quiz.nameMode).toBe('sci')
  })

  it('L7 走洲级地区（方案 B）：region 快照为洲码', async () => {
    const quiz = useQuizStore()
    const settings = (await import('../settings')).useSettingsStore()
    settings.region = 'ASIA'
    await quiz.start('image', { tier: 7 })
    expect(quiz.region).toBe('ASIA')
    settings.region = 'ALL'
  })
})
