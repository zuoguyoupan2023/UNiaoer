import type { Tier } from '@/types'

export type DistractorStrategy = 'cross' | 'mixed' | 'same'

export interface TierConfig {
  tier: Tier
  /** 难度名语言包 key（渲染处 t(cfg.labelKey)，core 不依赖 i18n，015 §6.2） */
  labelKey: string
  /** 难度描述语言包 key */
  descKey: string
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
  /**
   * 每次取材最多可选的素材数（分档取材，011 §8）：
   * L1 只用首选（标准照）；高档位在上限内随机，制造"多样姿态/环境"的难度梯度。
   * 不足时按实际数量；素材数组缺省时回退到单张 image/audio。
   */
  mediaPoolSize: number
}

export const TIERS: Record<Tier, TierConfig> = {
  1: {
    tier: 1,
    labelKey: 'difficulty.l1.label',
    descKey: 'difficulty.l1.desc',
    optionCount: 3,
    distractor: 'cross',
    timeLimitSec: 25,
    optionRevealSec: 5,
    commonness: [1, 2],
    mediaPoolSize: 1,
  },
  2: {
    tier: 2,
    labelKey: 'difficulty.l2.label',
    descKey: 'difficulty.l2.desc',
    optionCount: 4,
    distractor: 'mixed',
    timeLimitSec: 20,
    commonness: [1, 2, 3],
    mediaPoolSize: 3,
  },
  3: {
    tier: 3,
    labelKey: 'difficulty.l3.label',
    descKey: 'difficulty.l3.desc',
    optionCount: 4,
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [2, 3, 4],
    mediaPoolSize: 3,
  },
  4: {
    tier: 4,
    labelKey: 'difficulty.l4.label',
    descKey: 'difficulty.l4.desc',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 10,
    commonness: [3, 4],
    mediaPoolSize: 5,
  },
  5: {
    tier: 5,
    labelKey: 'difficulty.l5.label',
    descKey: 'difficulty.l5.desc',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 10,
    commonness: [3, 4],
    mediaPoolSize: 5,
  },
}

export const TIER_LIST: TierConfig[] = [TIERS[1], TIERS[2], TIERS[3], TIERS[4], TIERS[5]]
