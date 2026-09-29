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

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: vi.fn<() => Promise<Manifest>>(async () => manifest),
}))

import { useQuizStore } from '../quiz'

describe('quiz store · D4 多轮 session', () => {
  beforeEach(() => setActivePinia(createPinia()))

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
