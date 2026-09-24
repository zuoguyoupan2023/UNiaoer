import { describe, it, expect } from 'vitest'
import { BADGES, evaluateBadges } from '../badges'
import type { Stats } from '../historyDb'

function stats(over: Partial<Stats> = {}): Stats {
  return {
    rounds: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    bestAccuracy: 0,
    perfectRounds: 0,
    distinctSpecies: 0,
    audioRounds: 0,
    maxTier: 0,
    bestStreak: 0,
    wrongCount: 0,
    ...over,
  }
}

describe('evaluateBadges', () => {
  it('空统计不获得任何徽章', () => {
    expect(evaluateBadges(stats(), new Set())).toHaveLength(0)
  })

  it('完成一轮获得「首战告捷」', () => {
    const got = evaluateBadges(stats({ rounds: 1 }), new Set())
    expect(got.map((b) => b.id)).toContain('first-round')
  })

  it('满分 / 听音 / L4 / 连对 规则', () => {
    const got = evaluateBadges(
      stats({ rounds: 3, perfectRounds: 1, audioRounds: 1, maxTier: 4, bestStreak: 5 }),
      new Set(),
    )
    const ids = got.map((b) => b.id)
    expect(ids).toContain('perfect')
    expect(ids).toContain('listener')
    expect(ids).toContain('expert')
    expect(ids).toContain('streak')
  })

  it('已获得的不会重复返回', () => {
    const got = evaluateBadges(stats({ rounds: 1 }), new Set(['first-round']))
    expect(got.map((b) => b.id)).not.toContain('first-round')
  })

  it('徽章定义唯一', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length)
  })
})
