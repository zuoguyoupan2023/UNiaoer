import { describe, it, expect } from 'vitest'
import { evaluateTitles, levelScore, TITLE_TRACKS } from '../titles'
import type { RoundItem, RoundRecord } from '../historyDb'

function item(correct: boolean): RoundItem {
  return {
    speciesId: correct ? 'a' : 'b',
    answer: correct ? '甲鸟' : '乙鸟',
    sci: '',
    family: '',
    type: 'image',
    chosen: correct ? '甲鸟' : '乙鸟',
    correct,
    timedOut: false,
    mediaUrl: '',
    source: '',
    author: '',
    license: '',
  }
}

function round(over: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: 'r',
    at: Date.now(),
    category: 'bird',
    mode: 'image',
    tier: 2,
    total: 10,
    correct: 10,
    accuracy: 100,
    durationMs: 1000,
    items: Array.from({ length: 10 }, () => item(true)),
    ...over,
  }
}

function makeStats(over: Partial<Parameters<typeof evaluateTitles>[0]> = {}) {
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

describe('levelScore（008 §3 水平分）', () => {
  it('全对 = 100，全错 = 0', () => {
    expect(levelScore([round()])).toBe(100)
    const allWrong = round({
      items: Array.from({ length: 10 }, () => item(false)),
      correct: 0,
      accuracy: 0,
    })
    expect(levelScore([allWrong])).toBe(0)
  })

  it('难度加权：L5 的错比 L1 的错拖累更大（对称组合分数偏离 50 的方向相反）', () => {
    const allCorrect = (tier: 1 | 5) =>
      round({ tier, items: Array.from({ length: 10 }, () => item(true)) })
    const allWrong = (tier: 1 | 5) =>
      round({ tier, items: Array.from({ length: 10 }, () => item(false)) })
    // L1 全对 + L5 全错：错在高权重上 → 低于 50
    expect(levelScore([allCorrect(1), allWrong(5)])).toBeLessThan(50)
    // L5 全对 + L1 全错：对在高权重上 → 高于 50
    expect(levelScore([allCorrect(5), allWrong(1)])).toBeGreaterThan(50)
  })

  it('时间衰减：久远的高权重错误拖累小于近期的（老错题影响淡化）', () => {
    const l1Correct = round({ tier: 1, items: Array.from({ length: 10 }, () => item(true)) })
    const l5WrongRecent = round({
      tier: 5,
      at: Date.now(),
      items: Array.from({ length: 10 }, () => item(false)),
    })
    const l5WrongOld = round({
      tier: 5,
      at: Date.now() - 400 * 86_400_000,
      items: Array.from({ length: 10 }, () => item(false)),
    })
    // 错题发生在 400 天前：权重衰减（0.6），对水平分的拖累小于发生在近期
    expect(levelScore([l1Correct, l5WrongOld])).toBeGreaterThan(
      levelScore([l1Correct, l5WrongRecent]),
    )
  })

  it('无记录为 0', () => {
    expect(levelScore([])).toBe(0)
  })
})

describe('evaluateTitles（称号轨道）', () => {
  it('新用户只有段位起步身份「见习鸟人」', () => {
    const titles = evaluateTitles(makeStats(), [])
    expect(titles.map((t) => t.trackId)).toEqual(['rank'])
    expect(titles[0]!.label).toBe('见习鸟人')
  })

  it('题量阶梯按阈值升级', () => {
    const s = makeStats({ totalQuestions: 1000 })
    const t = evaluateTitles(s, []).find((x) => x.trackId === 'volume')!
    expect(t.level).toBe(2)
    expect(t.label).toBe('林间漫步者')
  })

  it('T7 物种之友带物种名', () => {
    // 12 轮 × 每轮 1 题 = 同一物种答对 12 次 → L1（10 ≤ 12 < 25）
    const rounds = Array.from({ length: 12 }, (_, i) =>
      round({ id: `r${i}`, total: 1, correct: 1, accuracy: 100, items: [item(true)] }),
    )
    const t = evaluateTitles(makeStats(), rounds).find((x) => x.trackId === 'species-friend')!
    expect(t.level).toBe(1)
    expect(t.label).toBe('甲鸟之友')
  })

  it('T0 段位跟随分数可降（old 低分记录拉低段位）', () => {
    const high = evaluateTitles(makeStats(), [round()]).find((t) => t.trackId === 'rank')!
    const oldWrong = round({
      at: Date.now() - 400 * 86_400_000,
      items: Array.from({ length: 100 }, () => item(false)),
    })
    const low = evaluateTitles(makeStats(), [round(), oldWrong]).find(
      (t) => t.trackId === 'rank',
    )!
    expect(high.level).toBeGreaterThanOrEqual(2)
    expect(low.level).toBeLessThan(high.level)
  })

  it('轨道定义唯一', () => {
    expect(new Set(TITLE_TRACKS.map((t) => t.id)).size).toBe(TITLE_TRACKS.length)
  })
})
