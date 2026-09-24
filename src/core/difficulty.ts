import type { Tier } from '@/types'

export type DistractorStrategy = 'cross' | 'mixed' | 'same'

export interface TierConfig {
  tier: Tier
  label: string
  desc: string
  /** 选项数量 */
  optionCount: number
  /** 干扰项策略：cross 跨科（易）/ mixed 含同科 / same 同科为主（难） */
  distractor: DistractorStrategy
  /** 限时（秒），undefined 为不限时 */
  timeLimitSec?: number
  /** 允许的物种常见度（1 最常见 → 4 最少见） */
  commonness: number[]
}

export const TIERS: Record<Tier, TierConfig> = {
  1: {
    tier: 1,
    label: 'L1 入门',
    desc: '3 个选项 · 干扰项跨科 · 不限时',
    optionCount: 3,
    distractor: 'cross',
    commonness: [1, 2],
  },
  2: {
    tier: 2,
    label: 'L2 进阶',
    desc: '4 个选项 · 含 1 个同科 · 限时 20s',
    optionCount: 4,
    distractor: 'mixed',
    timeLimitSec: 20,
    commonness: [1, 2, 3],
  },
  3: {
    tier: 3,
    label: 'L3 高手',
    desc: '4 个选项 · 同科为主 · 限时 12s',
    optionCount: 4,
    distractor: 'same',
    timeLimitSec: 12,
    commonness: [2, 3, 4],
  },
  4: {
    tier: 4,
    label: 'L4 专家',
    desc: '6 个选项 · 同科近缘 · 限时 8s',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 8,
    commonness: [3, 4],
  },
}

export const TIER_LIST: TierConfig[] = [TIERS[1], TIERS[2], TIERS[3], TIERS[4]]
