import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Manifest, BankSpecies } from '@/core/bank'

function asset(id: string, type: 'image' | 'audio') {
  return {
    id,
    speciesId: id,
    type,
    url: `https://img.test/${id}-${type}`,
    license: 'CC-BY',
    licenseUrl: '',
    author: 't',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}
function sp(id: string): BankSpecies {
  return {
    id,
    nameZh: `鸟${id}`,
    nameSci: `${id} sci`,
    nameEn: `${id} en`,
    family: `科${id}`,
    commonness: 1,
    desc: '',
    location: '',
    habit: '',
    image: asset(id, 'image'),
    audio: asset(id, 'audio'),
  }
}

const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
const manifest: Manifest = {
  generatedAt: '',
  policy: 'relaxed',
  mediaMode: 'remote',
  total: IDS.length,
  stats: { withImage: IDS.length, withAudio: IDS.length },
  species: IDS.map(sp),
}

const { listRoundsMock, wrongBookMock, onlinePoolMock } = vi.hoisted(() => ({
  listRoundsMock: vi.fn<() => Promise<unknown[]>>(),
  wrongBookMock: vi.fn<() => Promise<unknown[]>>(),
  onlinePoolMock: vi.fn<(type: string, tier: number, region: string) => Promise<unknown>>(),
}))

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: async () => manifest,
}))
vi.mock('@/core/historyDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/historyDb')>()),
  listRounds: () => listRoundsMock(),
  getWrongBook: () => wrongBookMock(),
}))
vi.mock('@/core/globalPool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/globalPool')>()),
  loadRegionalPool: async () => null,
}))
vi.mock('@/core/provinceCommonness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/provinceCommonness')>()),
  regionTierMap: async () => null,
}))
vi.mock('@/core/onlinePool', () => ({
  fetchOnlinePool: (...a: unknown[]) => onlinePoolMock(...(a as [string, number, string])),
}))

import { useQuizStore } from '../quiz'

function round(sids: string[]) {
  return {
    id: 'r',
    at: Date.now(),
    category: 'bird',
    mode: 'image' as const,
    tier: 2,
    total: sids.length,
    correct: sids.length,
    accuracy: 100,
    durationMs: 1,
    items: sids.map((sid) => ({
      speciesId: sid,
      answer: '',
      sci: '',
      family: '',
      type: 'image' as const,
      chosen: null,
      correct: true,
      timedOut: false,
      mediaUrl: '',
      source: '',
      author: '',
      license: '',
    })),
  }
}

describe('quiz store · 072-a 出题链路快照（lastBuild）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listRoundsMock.mockResolvedValue([])
    wrongBookMock.mockResolvedValue([])
    onlinePoolMock.mockResolvedValue(null)
  })

  it('在线命中赛制池 → path=online，记录候选数与命中数', async () => {
    listRoundsMock.mockResolvedValue([round(['a', 'b', 'c'])])
    onlinePoolMock.mockResolvedValue({
      species: ['a', 'b', 'c', 'd', 'e'].map(sp),
      distractors: [],
      from: 'network',
    })
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2, count: 10, regime: 'review' })

    const d = quiz.lastBuild!
    expect(d).not.toBeNull()
    expect(d.path).toBe('online')
    expect(d.onlineTotal).toBe(5)
    expect(d.onlineHits).toBe(3)
    expect(d.regimePool).toBe(3)
    expect(d.want).toBe(10)
    // 现状：交集 3 → 只出 3 题（这正是要观测的短轮，本轮不修改行为）
    expect(d.built).toBe(3)
    expect(d.built).toBe(quiz.questions.length)
  })

  it('在线候选与赛制池零交集 → path=online-fallback，出题数回到目标值', async () => {
    listRoundsMock.mockResolvedValue([round(['a', 'b', 'c'])])
    onlinePoolMock.mockResolvedValue({
      species: ['d', 'e', 'f'].map(sp), // 都不在复习池
      distractors: [],
      from: 'network',
    })
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2, count: 3, regime: 'review' })
    const d = quiz.lastBuild!
    expect(d.path).toBe('online-fallback')
    expect(d.onlineHits).toBe(0)
    expect(d.built).toBe(3)
  })

  it('没有在线池（再来一轮/离线）→ path=local', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2, count: 4 })
    const d = quiz.lastBuild!
    expect(d.path).toBe('local')
    expect(d.onlineTotal).toBeNull()
    expect(d.onlineHits).toBeNull()
    expect(d.built).toBe(4)
  })

  it('reset 清空快照', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2, count: 4 })
    expect(quiz.lastBuild).not.toBeNull()
    quiz.reset()
    expect(quiz.lastBuild).toBeNull()
  })
})
