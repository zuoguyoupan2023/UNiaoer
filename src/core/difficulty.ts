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
  /** 隐藏选项的时长（秒）；缺省按限时的 1/3（见 pacing OPTION_REVEAL_RATIO） */
  optionRevealSec?: number
  /** 允许的物种常见度（1 最常见 → 4 最少见） */
  commonness: number[]
}

export const TIERS: Record<Tier, TierConfig> = {
  1: {
    tier: 1,
    label: 'L1 入门',
    desc: '3 个选项 · 干扰项跨科 · 限时 25s（前 5s 隐藏选项）',
    optionCount: 3,
    distractor: 'cross',
    timeLimitSec: 25,
    optionRevealSec: 5,
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
    desc: '4 个选项 · 同科为主 · 限时 15s',
    optionCount: 4,
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [2, 3, 4],
  },
  4: {
    tier: 4,
    label: 'L4 专家',
    desc: '6 个选项 · 同科近缘 · 限时 10s',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 10,
    commonness: [3, 4],
  },
  5: {
    tier: 5,
    label: 'L5 地狱',
    desc: 'L4 规格 · 限时 10s · 随机鸟鸣干扰',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 10,
    commonness: [3, 4],
  },
}

export const TIER_LIST: TierConfig[] = [TIERS[1], TIERS[2], TIERS[3], TIERS[4], TIERS[5]]
