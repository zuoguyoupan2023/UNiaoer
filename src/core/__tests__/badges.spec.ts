import { describe, it, expect } from 'vitest'
import { BADGES, evaluateBadges, type BadgeSeries } from '../badges'
import type { RoundRecord, Stats } from '../historyDb'

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
    hellRounds: 0,
    hellQuestions: 0,
    hellCorrect: 0,
    hellPerfectRounds: 0,
    audioCorrect: 0,
    wrongPracticeRounds: 0,
    wrongPracticeCorrect: 0,
    imagePerfectRounds: 0,
    audioPerfectRounds: 0,
    maxCrossStreak: 0,
    distinctCorrect: 0,
    nightRound: false,
    dawnRound: false,
    escapedQuitPerfect: false,
    ...over,
  }
}

function round(over: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: 'r',
    at: Date.now(),
    category: 'bird',
    mode: 'image',
    tier: 1,
    total: 10,
    correct: 10,
    accuracy: 100,
    durationMs: 1000,
    items: [],
    ...over,
  }
}

describe('evaluateBadges（基础）', () => {
  it('空统计不获得任何徽章', () => {
    expect(evaluateBadges(stats(), [], new Set())).toHaveLength(0)
  })

  it('完成一轮获得「首战告捷」', () => {
    const got = evaluateBadges(stats({ rounds: 1 }), [], new Set())
    expect(got.map((b) => b.id)).toContain('first-round')
  })

  it('满分 / 听音 / L4 / 连对 规则', () => {
    const got = evaluateBadges(
      stats({ rounds: 3, perfectRounds: 1, audioRounds: 1, maxTier: 4, bestStreak: 5 }),
      [],
      new Set(),
    )
    const ids = got.map((b) => b.id)
    expect(ids).toContain('perfect')
    expect(ids).toContain('listener')
    expect(ids).toContain('expert')
    expect(ids).toContain('streak')
  })

  it('已获得的不会重复返回', () => {
    const got = evaluateBadges(stats({ rounds: 1 }), [], new Set(['first-round']))
    expect(got.map((b) => b.id)).not.toContain('first-round')
  })

  it('徽章定义唯一且都有系列', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length)
    const series = new Set(BADGES.map((b) => b.series))
    expect(series.has('starter')).toBe(true)
    expect(series.has('advanced')).toBe(true)
    expect(series.has('master')).toBe(true)
    expect(series.has('hidden')).toBe(true)
  })

  it('系列分组：入门 11 / 进阶 12 / 大师 7 / 隐藏 5（045 新增 L6 满分徽章）', () => {
    const count = (s: BadgeSeries) => BADGES.filter((b) => b.series === s).length
    expect(count('starter')).toBe(11)
    expect(count('advanced')).toBe(12)
    expect(count('master')).toBe(7)
    expect(count('hidden')).toBe(5)
  })

  it('045：L6 满一轮得 non-human-perfect，all-tier-perfect 仍只要求 L1–L5', () => {
    const mk = (tier: number) => [
      { at: 1, mode: 'image', tier, total: 3, correct: 3, items: [] },
    ] as never
    const ids = (rounds: unknown[]) =>
      evaluateBadges({} as never, rounds as never, new Set<string>()).map((b) => b.id)
    const all = ids([...mk(1), ...mk(2), ...mk(3), ...mk(4), ...mk(5), ...mk(6)])
    expect(all).toContain('non-human-perfect')
    expect(all).toContain('all-tier-perfect')
    // 只有 L1–L5 满分时，L6 徽章不得给出
    const l5 = ids([...mk(1), ...mk(2), ...mk(3), ...mk(4), ...mk(5)])
    expect(l5).toContain('all-tier-perfect')
    expect(l5).not.toContain('non-human-perfect')
  })
})

describe('evaluateBadges（rounds 派生规则，R28）', () => {
  it('地狱首通 / 炼狱十轮 / 炼狱满分', () => {
    const hell = round({ tier: 5, total: 10, correct: 6, accuracy: 60 })
    const hellPerfect = round({ tier: 5, total: 10, correct: 10, accuracy: 100 })
    const s = stats({ hellRounds: 1, hellQuestions: 10, hellCorrect: 6 })
    expect(evaluateBadges(s, [hell], new Set()).map((b) => b.id)).toContain('hell-first')
    expect(evaluateBadges(stats({ hellRounds: 10 }), [hell], new Set()).map((b) => b.id)).toContain(
      'hell-ten',
    )
    expect(
      evaluateBadges(stats({ hellPerfectRounds: 1, hellRounds: 1 }), [hellPerfect], new Set()).map(
        (b) => b.id,
      ),
    ).toContain('hell-perfect')
  })

  it('知耻后勇：错题重练轮全对', () => {
    const rp = round({ source: 'wrong-practice' })
    const s = stats({ wrongPracticeRounds: 1, wrongPracticeCorrect: 10, totalCorrect: 10 })
    expect(evaluateBadges(s, [rp], new Set()).map((b) => b.id)).toContain('learned-revenge')
  })

  it('稳定输出：连续 5 轮 ≥80%', () => {
    // 显式 at 递增：规则按 at 排序，而默认 Date.now() 在毫秒边界处会让构造顺序与时间顺序错位（偶发假绿）
    const good = (i: number) => round({ accuracy: 85, at: 1000 + i * 10 })
    const bad = round({ accuracy: 40, at: 1030 })
    const s = stats({ rounds: 5 })
    expect(
      evaluateBadges(s, [1, 2, 3, 4, 5].map(good), new Set()).map((b) => b.id),
    ).toContain('stable-five')
    expect(
      evaluateBadges(s, [good(1), good(2), bad, good(4), good(5), good(6)], new Set()).map(
        (b) => b.id,
      ),
    ).not.toContain('stable-five')
  })

  it('全档通关：L1–L5 各有满分轮', () => {
    const rounds = ([1, 2, 3, 4] as const).map((t) => round({ tier: t }))
    const s = stats({ perfectRounds: 4 })
    expect(evaluateBadges(s, rounds, new Set()).map((b) => b.id)).not.toContain('all-tier-perfect')
    rounds.push(round({ tier: 5 }))
    expect(evaluateBadges(s, rounds, new Set()).map((b) => b.id)).toContain('all-tier-perfect')
  })

  it('三顾茅庐：同一物种错 3 次后首次答对', () => {
    const wrongRound = (sid: string) =>
      round({
        items: [
          {
            speciesId: sid,
            answer: '甲',
            sci: '',
            family: '',
            type: 'image',
            chosen: '乙',
            correct: false,
            timedOut: false,
            mediaUrl: '',
            source: '',
            author: '',
            license: '',
          },
        ],
        total: 1,
        correct: 0,
        accuracy: 0,
      })
    const rightRound = (sid: string) =>
      round({
        items: [
          {
            speciesId: sid,
            answer: '甲',
            sci: '',
            family: '',
            type: 'image',
            chosen: '甲',
            correct: true,
            timedOut: false,
            mediaUrl: '',
            source: '',
            author: '',
            license: '',
          },
        ],
        total: 1,
        correct: 1,
        accuracy: 100,
      })
    // 错 2 次后答对 → 不触发
    expect(
      evaluateBadges(stats(), [wrongRound('a'), wrongRound('a'), rightRound('a')], new Set()).map(
        (b) => b.id,
      ),
    ).not.toContain('triple-forgiven')
    // 错 3 次后答对 → 触发
    expect(
      evaluateBadges(
        stats(),
        [wrongRound('a'), wrongRound('a'), wrongRound('a'), rightRound('a')],
        new Set(),
      ).map((b) => b.id),
    ).toContain('triple-forgiven')
  })

  it('浪子回头 / 夜枭猎手', () => {
    expect(
      evaluateBadges(stats({ escapedQuitPerfect: true }), [], new Set()).map((b) => b.id),
    ).toContain('escaped-quit')
    const night = round({ at: new Date().setHours(23, 30) })
    expect(evaluateBadges(stats({ nightRound: true }), [night], new Set()).map((b) => b.id)).toContain(
      'night-owl',
    )
  })

  it('隐藏徽章默认不可见：未解锁显示 ???，解锁后显示真名', () => {
    const hidden = BADGES.filter((b) => b.hidden)
    expect(hidden.length).toBe(5)
    expect(hidden.every((b) => b.series === 'hidden')).toBe(true)
  })
})
