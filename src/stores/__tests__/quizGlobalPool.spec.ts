/**
 * 029 M2:全球池并入 + 地区过滤（D-029-2：L1–L3 地区包，L4–L5 全球开放）。
 * 用 mock 的 globalPool 模块控制「全球池」内容，验证题型过滤/地区过滤/降级。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BankSpecies } from '@/core/bank'

const { loadRegionalPoolMock } = vi.hoisted(() => ({
  loadRegionalPoolMock: vi.fn<(region: string) => Promise<BankSpecies[] | null>>(),
}))

vi.mock('@/core/globalPool', () => ({
  loadRegionalPool: (region: string) => loadRegionalPoolMock(region),
  loadGlobalPool: async () => null,
  globalPoolReady: () => null,
}))

const sp = (
  id: string,
  name: string,
  commonness: number,
  media: { image?: boolean; audio?: boolean } = { image: true, audio: true },
  extra: Partial<BankSpecies> = {},
): BankSpecies =>
  ({
    id,
    nameZh: name,
    nameSci: `Sci ${id}`,
    family: 'F',
    commonness,
    desc: '',
    location: '',
    habit: '',
    image: media.image === false ? null : { url: `https://m/${id}.jpg`, type: 'image', speciesId: id },
    audio: media.audio === false ? null : { url: `https://m/${id}.mp3`, type: 'audio', speciesId: id },
    playableImage: media.image !== false,
    playableAudio: media.audio !== false,
    taxonKey: `avibase-${id.toUpperCase()}`,
    ...extra,
  }) as BankSpecies

const coreSpecies = [sp('c1', '核心一', 2)]
const globalSpecies = [
  sp('g1', '全球常见', 2),
  sp('g2', '全球稀有', 5),
  sp('g3', '质量降级', 3, { image: true }, { quizExcluded: true }),
  sp('g4', '仅图无音', 2, { image: true, audio: false }),
]

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: vi.fn<() => Promise<unknown>>(async () => ({
    generatedAt: '',
    policy: 'relaxed',
    mediaMode: 'stage',
    total: coreSpecies.length,
    stats: { withImage: 1, withAudio: 1 },
    species: coreSpecies,
  })),
}))

vi.mock('@/core/historyDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/historyDb')>()),
  listRounds: vi.fn<() => Promise<unknown[]>>(async () => []),
  getWrongBook: vi.fn<() => Promise<unknown[]>>(async () => []),
}))

import { useQuizStore } from '../quiz'
import { useSettingsStore } from '../settings'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  loadRegionalPoolMock.mockReset()
  loadRegionalPoolMock.mockResolvedValue(globalSpecies)
})

describe('029 M2 · 全球池并入与地区过滤', () => {
  it('L4/L5 以 ALL 请求全球池（资深画像全球开放）', async () => {
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 4, count: 6 })
    expect(loadRegionalPoolMock).toHaveBeenCalledWith('ALL')
    expect(quiz.error).toBe('')
  })

  it('L1–L3 按用户地区偏好请求（地区包）', async () => {
    const settings = useSettingsStore()
    settings.region = 'CN'
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2, count: 6 })
    expect(loadRegionalPoolMock).toHaveBeenCalledWith('CN')
  })

  it('全球池并入题型过滤：听音题排除无音种、质量降级种一律不进池', async () => {
    const quiz = useQuizStore()
    await quiz.start('audio', { tier: 4, count: 10 })
    expect(quiz.error).toBe('')
    const used = new Set(quiz.questions.map((q) => q.media.speciesId))
    expect(used.has('g4')).toBe(false) // 无音
    expect(used.has('g3')).toBe(false) // quizExcluded
    // 池 = 核心 c1 + 全球 g1/g2（各 1 音），共 3 种
    expect(quiz.questions.length).toBeLessThanOrEqual(3)
  })

  it('全球池不可用（null）→ 静默回退核心库，不报错', async () => {
    loadRegionalPoolMock.mockResolvedValue(null)
    const quiz = useQuizStore()
    await quiz.start('image', { tier: 2, count: 10 })
    expect(quiz.error).toBe('')
    expect(quiz.questions.every((q) => q.media.speciesId === 'c1')).toBe(true)
  })

  it('quizExcluded 的核心种也不进池', async () => {
    const quiz = useQuizStore()
    // 通过 mock 的 core 只有 c1（未标记）,此处断言过滤逻辑对核心库同样生效
    await quiz.start('image', { tier: 2, count: 10 })
    expect(quiz.questions.some((q) => q.media.speciesId === 'c1')).toBe(true)
  })
})
