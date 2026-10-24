import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Manifest, BankSpecies } from '@/core/bank'

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
    family: `科${Number(id.slice(1)) % 2}`, // 两科轮换：同科干扰项充足
    commonness: 1,
    desc: '',
    location: '',
    habit: '',
    image: asset(id, `https://img.test/${id}.jpg`, 'image'),
    audio: asset(id, `https://img.test/${id}.mp3`, 'audio'),
  }
}

const manifest: Manifest = {
  generatedAt: '',
  policy: 'relaxed',
  mediaMode: 'remote',
  total: 60,
  stats: { withImage: 60, withAudio: 60 },
  // 60 种、两科轮换（同科干扰项充足），撑满 10 题 × 6 选项
  species: Array.from({ length: 60 }, (_, i) => sp(`s${i}`, `鸟${i}`)),
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

describe('quiz store · L6 半鸟人（startName）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listRoundsMock.mockResolvedValue([])
    wrongBookMock.mockResolvedValue([])
  })

  it('startName：tier=6、kind=name、题干是名字、选项带素材', async () => {
    const quiz = useQuizStore()
    await quiz.startName('image', { nameMode: 'zh' })
    expect(quiz.error).toBe('')
    expect(quiz.kind).toBe('name')
    expect(quiz.tier).toBe(6)
    expect(quiz.nameMode).toBe('zh')
    expect(quiz.total).toBe(10)
    for (const q of quiz.questions) {
      expect(q.tier).toBe(6)
      expect(q.answerMode).toBe('choice')
      expect(q.timeLimitSec).toBe(10)
      expect(q.optionsMedia?.length).toBe(q.options.length)
      expect(q.options).toContain(q.answer)
    }
  })

  it('学名卷 nameMode 落进题目（D-2/D-8）', async () => {
    const quiz = useQuizStore()
    await quiz.startName('image', { nameMode: 'sci' })
    expect(quiz.nameMode).toBe('sci')
    for (const q of quiz.questions) {
      expect(q.nameMode).toBe('sci')
      for (const name of q.options) expect(name).toMatch(/ sci/)
    }
  })

  it('nextRound 保持 kind=name 与 session 累计（再来一轮沿用 L6）', async () => {
    const quiz = useQuizStore()
    await quiz.startName('image', { nameMode: 'zh' })
    // 答满本轮全部答对
    for (let i = 0; i < quiz.total; i++) {
      quiz.index = i
      quiz.answer(quiz.questions[i]!.answer)
    }
    expect(quiz.correctCount).toBe(quiz.total)
    const prevRound = quiz.sessionRound
    await quiz.nextRound()
    expect(quiz.kind).toBe('name')
    expect(quiz.tier).toBe(6)
    expect(quiz.sessionRound).toBe(prevRound + 1)
    expect(quiz.pendingContinue).toBe(true)
    expect(quiz.total).toBe(10)
  })

  it('classic 的 start 不受 L6 影响（回归保护）', async () => {
    const quiz = useQuizStore()
    await quiz.startName('image', { nameMode: 'zh' })
    await quiz.start('image', { tier: 2 })
    expect(quiz.kind).toBe('classic')
    expect(quiz.tier).toBe(2)
    for (const q of quiz.questions) expect(q.optionsMedia).toBeUndefined()
  })

  it('reset 归位 kind=classic', async () => {
    const quiz = useQuizStore()
    await quiz.startName('audio', { nameMode: 'en' })
    quiz.reset()
    expect(quiz.kind).toBe('classic')
  })
})
