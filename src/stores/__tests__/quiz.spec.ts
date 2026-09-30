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
    nameSci: `${id} sci`,
    family: `科${id}`,
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
  total: 6,
  stats: { withImage: 6, withAudio: 6 },
  species: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => sp(id, `鸟${id}`)),
}

const { listRoundsMock, wrongBookMock } = vi.hoisted(() => ({
  listRoundsMock: vi.fn<() => Promise<unknown[]>>(),
  wrongBookMock: vi.fn<() => Promise<unknown[]>>(),
}))

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: vi.fn<() => Promise<Manifest>>(async () => manifest),
}))

// 赛制选池依赖轮次/错题本：mock 以控制练习史
vi.mock('@/core/historyDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/historyDb')>()),
  listRounds: (...args: unknown[]) => listRoundsMock(...(args as [])),
  getWrongBook: (...args: unknown[]) => wrongBookMock(...(args as [])),
}))

import { useQuizStore } from '../quiz'

describe('quiz store · A2 赛制选题池（013 §4）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listRoundsMock.mockResolvedValue([])
    wrongBookMock.mockResolvedValue([])
  })

  function practicedRound(items: { sid: string; correct: boolean }[]) {
    return {
      id: 'r', at: Date.now(), category: 'bird', mode: 'image' as const, tier: 2,
      total: items.length, correct: items.filter((i) => i.correct).length,
      accuracy: 50, durationMs: 1,
      items: items.map((i) => ({
        speciesId: i.sid, answer: '', sci: '', family: '', type: 'image' as const,
        chosen: null, correct: i.correct, timedOut: false, mediaUrl: '', source: '', author: '', license: '',
      })),
    }
  }

  it('标准赛只出未练过的物种（物种×类型粒度）', async () => {
    listRoundsMock.mockResolvedValue([practicedRound([{ sid: 'a', correct: true }])])
    const store = useQuizStore()
    await store.start('image', { tier: 2, count: 6 })
    expect(store.error).toBe('')
    expect(store.questions.every((q) => q.answer !== '鸟a')).toBe(true)
    expect(store.questions.length).toBe(5)
  })

  it('标准赛池空 → standardPoolEmpty 引导去专项赛/新建档案', async () => {
    listRoundsMock.mockResolvedValue([
      practicedRound(['a', 'b', 'c', 'd', 'e', 'f'].map((sid) => ({ sid, correct: true }))),
    ])
    const store = useQuizStore()
    await store.start('image', { tier: 2, count: 6 })
    expect(store.error).toBe('standardPoolEmpty')
    expect(store.questions).toHaveLength(0)
  })

  it('复习赛只出练过的；强化赛只出练对过的', async () => {
    listRoundsMock.mockResolvedValue([
      practicedRound([
        { sid: 'a', correct: true },
        { sid: 'b', correct: false },
      ]),
    ])
    const store = useQuizStore()
    await store.start('image', { tier: 2, count: 6, regime: 'review' })
    const answers = store.questions.map((q) => q.answer)
    expect(answers).toContain('鸟a')
    expect(answers).toContain('鸟b')
    expect(answers).not.toContain('鸟c')

    await store.start('image', { tier: 2, count: 6, regime: 'reinforce' })
    const answers2 = store.questions.map((q) => q.answer)
    expect(answers2).toContain('鸟a')
    expect(answers2).not.toContain('鸟b')
  })

  it('复活赛只出错题本物种；池空 → wrongPoolEmpty', async () => {
    wrongBookMock.mockResolvedValue([{ speciesId: 'c' }])
    const store = useQuizStore()
    await store.start('image', { tier: 2, count: 6, regime: 'revival' })
    expect(store.questions.every((q) => q.answer === '鸟c')).toBe(true)

    wrongBookMock.mockResolvedValue([])
    await store.start('image', { tier: 2, count: 6, regime: 'revival' })
    expect(store.error).toBe('wrongPoolEmpty')
  })

  it('随机赛不做池过滤；错题重练入口把赛制切到复活赛', async () => {
    const store = useQuizStore()
    await store.start('image', { tier: 2, count: 6, regime: 'random' })
    expect(store.questions.length).toBe(6)

    store.startWrongBook('image')
    expect(store.regime).toBe('revival')
  })
})

describe('quiz store · D4 多轮 session', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listRoundsMock.mockResolvedValue([]) // D4 用例不涉及练习史（标准赛全池）
    wrongBookMock.mockResolvedValue([])
  })

  it('nextRound：累计轮次并入 session，且以同难度开新一轮', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 1, count: 5 })
    expect(quiz.sessionRound).toBe(1)

    quiz.answer(quiz.current!.answer)
    const correct1 = quiz.correctCount
    expect(correct1).toBe(1)

    await quiz.nextRound()
    expect(quiz.sessionRound).toBe(2)
    expect(quiz.sessionTotal).toBe(5)
    expect(quiz.sessionCorrect).toBe(1)
    expect(quiz.index).toBe(0)
    expect(quiz.answered).toBe(false)
    expect(quiz.pendingContinue).toBe(true)
    expect(quiz.tier).toBe(1)
  })

  it('全新 start 会重置 session', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 1, count: 5 })
    quiz.answer(quiz.current!.answer)
    await quiz.nextRound()
    expect(quiz.sessionRound).toBe(2)

    await quiz.start('audio', { tier: 1, count: 5 })
    expect(quiz.sessionRound).toBe(1)
    expect(quiz.sessionCorrect).toBe(0)
    expect(quiz.sessionTotal).toBe(0)
  })

  it('overallAccuracy 融合同 session 各轮', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 1, count: 5 })
    for (let i = 0; i < quiz.total; i++) {
      quiz.answer(quiz.current!.answer)
      quiz.next()
    }
    expect(quiz.accuracy).toBe(100)
    expect(quiz.overallAccuracy).toBe(100)

    await quiz.nextRound()
    expect(quiz.sessionCorrect).toBe(5)
    expect(quiz.sessionTotal).toBe(5)

    for (let i = 0; i < quiz.total; i++) {
      const wrong = quiz.current!.options.find((o) => o !== quiz.current!.answer)!
      quiz.answer(wrong)
      quiz.next()
    }
    expect(quiz.accuracy).toBe(0)
    expect(quiz.overallAccuracy).toBe(50)
  })
})
