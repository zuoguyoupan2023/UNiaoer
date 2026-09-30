import { describe, expect, it } from 'vitest'
import type { RoundRecord } from '../historyDb'
import { recentAccuracy, suggestTier } from '../adaptive'

function round(over: Partial<RoundRecord>): RoundRecord {
  return {
    id: 'r',
    at: 0,
    category: '',
    mode: 'image',
    tier: 2,
    total: 10,
    correct: 0,
    accuracy: 0,
    durationMs: 0,
    items: [],
    ...over,
  }
}

describe('recentAccuracy（D5 滚动正确率）', () => {
  it('只统计同模式、非错题重练，按时间取最近 window 轮', () => {
    const rounds = [
      round({ id: 'a', at: 1, mode: 'image', correct: 10, total: 10 }),
      round({ id: 'b', at: 2, mode: 'image', correct: 0, total: 10 }),
      round({ id: 'c', at: 3, mode: 'audio', correct: 10, total: 10 }),
      round({ id: 'd', at: 4, mode: 'image', correct: 5, total: 10, source: 'wrong-practice' }),
    ]
    const { accuracy, sample } = recentAccuracy(rounds, 'image')
    expect(sample).toBe(2)
    expect(accuracy).toBe(50) // (10 + 0) / (10 + 10)
  })

  it('无样本时 accuracy 为 null、sample 为 0', () => {
    expect(recentAccuracy([], 'image')).toEqual({ accuracy: null, sample: 0 })
  })
})

describe('suggestTier（D5 升降档建议）', () => {
  const hi = (n: number, at: number) => round({ at, correct: 10, total: 10 })

  it('样本不足（<3 轮）保持当前档', () => {
    const s = suggestTier([hi(1, 1), hi(1, 2)], 'image', 2)
    expect(s.change).toBe('stay')
    expect(s.tier).toBe(2)
    expect(s.sample).toBe(2)
  })

  it('高正确率（≥90%）升一档', () => {
    const s = suggestTier([hi(1, 1), hi(1, 2), hi(1, 3)], 'image', 2)
    expect(s.change).toBe('up')
    expect(s.tier).toBe(3)
    expect(s.accuracy).toBe(100)
  })

  it('低正确率（≤50%）降一档', () => {
    const rounds = [1, 2, 3].map((at) => round({ at, correct: 3, total: 10 }))
    const s = suggestTier(rounds, 'image', 3)
    expect(s.change).toBe('down')
    expect(s.tier).toBe(2)
  })

  it('已到上限/下限则不再越界', () => {
    const up = suggestTier([hi(1, 1), hi(1, 2), hi(1, 3)], 'image', 5)
    expect(up.change).toBe('stay')
    expect(up.tier).toBe(5)
    const down = suggestTier(
      [1, 2, 3].map((at) => round({ at, correct: 0, total: 10 })),
      'image',
      1,
    )
    expect(down.change).toBe('stay')
    expect(down.tier).toBe(1)
  })

  it('中等正确率保持当前档', () => {
    const rounds = [1, 2, 3].map((at) => round({ at, correct: 7, total: 10 }))
    expect(suggestTier(rounds, 'image', 3).tier).toBe(3)
  })

  it('错题重练不计入、且按模式隔离', () => {
    const rounds = [1, 2, 3].map((at) => round({ at, correct: 10, total: 10, source: 'wrong-practice' }))
    expect(suggestTier(rounds, 'image', 2).change).toBe('stay')
    const audio = [1, 2, 3].map((at) => round({ at, mode: 'audio', correct: 10, total: 10 }))
    expect(suggestTier(audio, 'image', 2).change).toBe('stay')
  })
})
