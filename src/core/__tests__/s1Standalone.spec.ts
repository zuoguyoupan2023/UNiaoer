/**
 * docs/100 §5 回归测试：S1（tier 9）是**独立模式**，不参与经典称号 / 徽章 / 统计 / 自适应。
 *
 * 这批断言锁住 2026-11-03 的修复（用户要求「S1 更独立」）：
 * - 缺陷 1：自适应降档曾把 S1 掉进 L8（`!== 8` 漏了 9）
 * - 缺陷 2：S1 的 maxTier=9 曾让「专家挑战」（maxTier>=4）白拿
 * - 缺陷 5：统计图表曾漏掉 S1
 *
 * 任何一条挂掉都说明「独立口径」被破坏——改口径请只改 difficulty.countsInClassicStats。
 */
import { describe, expect, it } from 'vitest'
import { countsInClassicStats, isSpecialModeTier, isStandaloneModeTier, TIERS } from '../difficulty'
import { evaluateBadges } from '../badges'
import { evaluateTitles } from '../titles'
import type { RoundRecord, Stats } from '../historyDb'
import type { Tier } from '@/types'

/** 造一轮最小可用的记录（够 titles/badges 的判定读字段即可） */
function round(tier: Tier, over: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: `r-${tier}-${Math.random()}`,
    at: Date.now(),
    category: 'bird',
    mode: 'image',
    tier,
    total: 10,
    correct: 10,
    accuracy: 100,
    durationMs: 60_000,
    source: 'normal',
    items: [],
    ...over,
  } as RoundRecord
}

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
    ...over,
  } as Stats
}

describe('difficulty · 独立模式判定口径', () => {
  it('S1（9）是独立模式，但**不是**特殊交互模式（走经典选择链路）', () => {
    expect(isStandaloneModeTier(9)).toBe(true)
    // 关键区分：S1 用经典答题组件，所以 isSpecialModeTier 必须为 false，
    // 否则计时/自动切题/快捷键会被 L6-L8 的分支误劫持（docs/099 §7.4）。
    expect(isSpecialModeTier(9)).toBe(false)
  })

  it('countsInClassicStats：经典 1–7 计入；L8（8）与 S1（9）都不计入', () => {
    for (const t of [1, 2, 3, 4, 5, 6, 7] as Tier[]) expect(countsInClassicStats(t)).toBe(true)
    expect(countsInClassicStats(8)).toBe(false) // L8 记忆挑战鸟
    expect(countsInClassicStats(9)).toBe(false) // S1 相似种挑战
  })
})

describe('titles · S1 不进经典七轨（缺陷 3 随之消失）', () => {
  it('只有 S1 轮次时，不会因为 S1 本身拿到任何「靠轮次/分数」的称号', () => {
    const rounds = [round(9), round(9), round(9)]
    // stats 全 0：模拟「只打过 S1」的真实 getStats 结果（S1 已被过滤，故各项计数为 0）
    const titles = evaluateTitles(stats({ maxTier: 9 }), rounds)
    // rank 轨道 threshold=0 是人人起点身份（不算「因 S1 升的级」），单独排除后应为空
    expect(titles.filter((x) => x.trackId !== 'rank')).toHaveLength(0)
    // 段位必须停在起步级 l1，不能因 S1 的满分轮次被抬到更高
    const rank = titles.find((x) => x.trackId === 'rank')
    expect(rank?.level).toBe(1)
  })

  it('S1 轮次不会稀释经典段位分：有无 S1 轮次，段位分一致', () => {
    const classicOnly = [round(5), round(5), round(5)]
    const withS1 = [...classicOnly, round(9), round(9)]
    const a = evaluateTitles(stats(), classicOnly).find((x) => x.trackId === 'rank')
    const b = evaluateTitles(stats(), withS1).find((x) => x.trackId === 'rank')
    expect(b?.level).toBe(a?.level)
    expect(b?.text).toEqual(a?.text)
  })
})

describe('badges · S1 不触发经典徽章（缺陷 2）', () => {
  it('只打过 S1 不会拿到「专家挑战」（曾因 maxTier=9>=4 白拿）', () => {
    const rounds = [round(9)]
    // maxTier 按 historyDb 口径取 max —— 模拟真实情况
    const s = stats({ rounds: 1, totalQuestions: 10, maxTier: 9 })
    const got = evaluateBadges(s, rounds, new Set()).map((b) => b.id)
    expect(got).not.toContain('expert')
  })

  it('真打过 L4 仍能拿「专家挑战」（修复不能误伤正常路径）', () => {
    const rounds = [round(4)]
    const s = stats({ rounds: 1, totalQuestions: 10, maxTier: 4 })
    const got = evaluateBadges(s, rounds, new Set()).map((b) => b.id)
    expect(got).toContain('expert')
  })

  it('S1 满分轮不会推进「全档通关」类轮序列徽章', () => {
    const rounds = [round(9)]
    // stats 按 getStats 真实口径给（S1 已被过滤 → perfectRounds 仍为 0）
    const s = stats({ maxTier: 9 })
    const got = evaluateBadges(s, rounds, new Set()).map((b) => b.id)
    // 首轮徽章与档位无关（完成一轮答题），不算 S1 专属特权
    expect(got).not.toContain('all-tier-perfect')
    expect(got).not.toContain('expert')
  })
})

describe('TIERS[9] 配置与文案口径一致（缺陷 4 的守卫）', () => {
  it('4 选项 / 10s / 选项≈不隐藏（2026-11-03 用户定）', () => {
    expect(TIERS[9].optionCount).toBe(4)
    expect(TIERS[9].timeLimitSec).toBe(10)
    expect(TIERS[9].optionRevealSec).toBe(0.1)
    expect(TIERS[9].timeLimitSecAudio).toBeUndefined()
  })
})
