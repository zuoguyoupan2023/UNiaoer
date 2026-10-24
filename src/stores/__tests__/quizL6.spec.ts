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

/**
 * L6 = 难度第六档（087 §4.8，用户定）：与 L1–L5 走同一个 start()，
 * 仅 tier=6 时引擎分支到 buildNameQuestions（名字 → 图/音）。
 */
describe('quiz store · L6 第六档（start tier=6）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listRoundsMock.mockResolvedValue([])
    wrongBookMock.mockResolvedValue([])
  })

  it('start tier=6：题干是名字、选项带素材、限时/选项数按题型（图 6 选项 10s）', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 6 })
    expect(quiz.error).toBe('')
    expect(quiz.tier).toBe(6)
    expect(quiz.nameMode).toBe('zh')
    expect(quiz.total).toBe(10)
    for (const q of quiz.questions) {
      expect(q.tier).toBe(6)
      expect(q.answerMode).toBe('choice')
      expect(q.timeLimitSec).toBe(10)
      expect(q.optionsMedia?.length).toBe(q.options.length)
      expect(q.options.length).toBe(6)
      expect(q.options).toContain(q.answer)
    }
  })

  it('听音版 L6：4 选项、25s', async () => {
    const quiz = useQuizStore()
    await quiz.start('audio', { tier: 6 })
    expect(quiz.error).toBe('')
    for (const q of quiz.questions) {
      expect(q.timeLimitSec).toBe(25)
      expect(q.options.length).toBe(4)
      for (const m of q.optionsMedia ?? []) expect(m.type).toBe('audio')
    }
  })

  it('nameMode 跟随界面语言（D-1；学名卷 switch 已挂起，引擎仍支持 nameMode 入参）', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 6 })
    expect(quiz.nameMode).toBe('zh') // 测试环境 locale 为 zh
    for (const q of quiz.questions) expect(q.nameMode).toBe('zh')
  })

  it('nextRound 保持 tier=6（再来一轮沿用第六档）', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 6 })
    for (let i = 0; i < quiz.total; i++) {
      quiz.index = i
      quiz.answer(quiz.questions[i]!.answer)
    }
    expect(quiz.correctCount).toBe(quiz.total)
    const prevRound = quiz.sessionRound
    await quiz.nextRound()
    expect(quiz.tier).toBe(6)
    expect(quiz.sessionRound).toBe(prevRound + 1)
    expect(quiz.pendingContinue).toBe(true)
    expect(quiz.total).toBe(10)
  })

  it('classic 档位回归保护：tier=2 仍是媒体作题干（无 optionsMedia）', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2 })
    expect(quiz.tier).toBe(2)
    expect(quiz.total).toBeGreaterThan(0)
    for (const q of quiz.questions) expect(q.optionsMedia).toBeUndefined()
  })

  it('赛制池对 L6 生效：revival 只出错题本物种', async () => {
    const quiz = useQuizStore()
    // 错题本里有 s1 → 复活赛池 = {s1}（revival 池来自 wrong store，非轮次史）
    wrongBookMock.mockResolvedValue([
      {
        speciesId: 's1', answer: '鸟1', sci: 's1 sci', family: '科1', type: 'image',
        mediaUrl: 'https://img.test/s1.jpg', source: 'iNaturalist', author: 'tester',
        license: 'CC-BY', wrongCount: 1, lastChosen: null, lastAt: Date.now(),
      },
    ])
    await quiz.start('image', { tier: 6, regime: 'revival' })
    expect(quiz.error).toBe('')
    for (const q of quiz.questions) {
      const answerId = q.optionIds[q.options.indexOf(q.answer)]
      expect(answerId).toBe('s1')
    }
  })
})
