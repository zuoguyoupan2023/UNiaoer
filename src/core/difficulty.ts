import type { MediaType, Tier } from '@/types'

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
  /** 看图限时（秒），undefined 为不限时 */
  timeLimitSec?: number
  /**
   * 听音限时（秒）；缺省回退 timeLimitSec。
   * 录音不裁剪、允许重听，且计时从音频真正开播算起，所以听音比看图给得宽松。
   */
  timeLimitSecAudio?: number
  /**
   * 隐藏选项的时长（秒）。2026-10-25 起**五档全部显式**（不再依赖"限时 1/3"的隐式规则，
   * 否则 L2≈6.7s / L3=5s / L4·L5≈3.3s 这些值既不好记也说不清）：
   * L1–L3 = 前 5s；L4 = 前 2s（限时 12s）；L5 = 前 2s（限时 10s）。
   * 缺省值仍按 pacing.OPTION_REVEAL_RATIO 兜底（仅防配置遗漏，正常不会走到）。
   */
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
    timeLimitSecAudio: 30,
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
    timeLimitSecAudio: 28,
    optionRevealSec: 5,
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
    timeLimitSecAudio: 25,
    optionRevealSec: 5,
    commonness: [2, 3, 4],
    mediaPoolSize: 3,
  },
  4: {
    tier: 4,
    labelKey: 'difficulty.l4.label',
    descKey: 'difficulty.l4.desc',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 12,
    timeLimitSecAudio: 22,
    optionRevealSec: 2,
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
    timeLimitSecAudio: 20,
    optionRevealSec: 2,
    commonness: [3, 4],
    mediaPoolSize: 5,
  },
  /**
   * L6 半鸟人（docs/081 §7；README「计划中的题型」；2026-10-24 用户定：**就是难度第六档**，
   * 与 L1–L5 同列，不做独立题型）。玩法是「名字 → 图/音」（引擎走 buildNameQuestions，
   * 选项数/限时按题型取 L6_TIERS），本条目供档位按钮/状态栏/结果页标签与类型完备；
   * 其余字段是"代表值"。
   */
  6: {
    tier: 6,
    labelKey: 'difficulty.l6.label',
    descKey: 'difficulty.l6.desc',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [1, 2, 3, 4],
    mediaPoolSize: 1,
  },
  /**
   * L7 鸟娲·造鸟者（docs/089；2026-10-24 定稿）：图/音 → **输入**鸟名（第七档）。
   * 判分见 core/nameMatch.ts（085 §4.1）；限时按题型取 L7_TIERS（图 15s / 音 18s，
   * 音从正式开播起计；素材切换可续命但限时递减 −n s）。
   */
  7: {
    tier: 7,
    labelKey: 'difficulty.l7.label',
    descKey: 'difficulty.l7.desc',
    optionCount: 1, // 输入题无选项；代表值（类型完备）
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [3, 4], // 与 L4/L5 同档的常见度口径（高难=少见鸟）
    mediaPoolSize: 5,
  },
  /**
   * L8 记忆挑战鸟（docs/092；2026-10-27 定稿）：翻牌配对（第八档）。
   * 12 对「图/音 ↔ 鸟名」合区 4×6 盘面；纯正计时 + 三档评语（memoryRating.ts），
   * 无限时、无选项、不进错题本、不参与称号与徽章（getStats/evaluate* 跳过 tier 8）。
   * optionCount/distractor/timeLimitSec 为类型完备的代表值，玩法不使用；
   * 每对只用首选素材（标准照/最佳录音）；常见度全开——难度梯度只在名称体系（zh/en vs sci）。
   */
  8: {
    tier: 8,
    labelKey: 'difficulty.l8.label',
    descKey: 'difficulty.l8.desc',
    optionCount: 2, // 每对 2 张牌；代表值（记忆翻牌无选项）
    distractor: 'same',
    commonness: [1, 2, 3, 4],
    mediaPoolSize: 1,
  },
}

/**
 * 按题型的限时：听音取 timeLimitSecAudio（缺省回退看图值）。
 * L6/L7 的限时在 L6_TIERS / L7_TIERS，不走这里。
 */
export function timeLimitFor(cfg: TierConfig, type: MediaType): number | undefined {
  return type === 'audio' ? (cfg.timeLimitSecAudio ?? cfg.timeLimitSec) : cfg.timeLimitSec
}

/** 介绍页难度按钮（L6/L7 = 第六/第七档，与 L1–L5 同列；087 §4.8 / 089 §6；L8 = 092） */
export const TIER_LIST: TierConfig[] = [
  TIERS[1],
  TIERS[2],
  TIERS[3],
  TIERS[4],
  TIERS[5],
  TIERS[6],
  TIERS[7],
  TIERS[8],
]

/**
 * L8 记忆挑战鸟盘面常量（docs/092 §1/§8）：12 对合区 4×6（窄屏 CSS 折成 3×8，对数不变——
 * 否则评语阈值不可比）。对数是评语阈值的前提，改这里必须同步实测阈值。
 */
export const MEMORY_PAIRS = 12

/**
 * L8 评语阈值（docs/092 §4.2 定稿）：看图 40/60s、听音 70/100s（听音每张牌都要听，天然更慢）。
 * 常量表，不随地区/常见度变；memoryRatingFor 是唯一消费方。
 */
export const MEMORY_THRESHOLDS_MS: Record<MediaType, { genius: number; awesome: number }> = {
  image: { genius: 40_000, awesome: 60_000 },
  audio: { genius: 70_000, awesome: 100_000 },
}

/**
 * L6 半鸟人的分题型配置（docs/081 §7 + README，2026-10-24 修订）：
 *   看图版：6 个图像选项，限时 15s（10→15，用户 2026-10-24 定）；听音版：4 个声音选项，限时 20s。
 * 干扰项策略固定 same（同科为主，「多选项都是同科鸟」）；选项素材都取首选
 * （媒体池大小 1：标准照/最佳录音，识别题不做姿态随机）。
 */
export const L6_TIERS: Record<MediaType, { optionCount: number; timeLimitSec: number; distractor: DistractorStrategy }> = {
  image: { optionCount: 6, timeLimitSec: 15, distractor: 'same' },
  audio: { optionCount: 4, timeLimitSec: 20, distractor: 'same' },
}

/**
 * L7 分题型限时（089 §6.1 定稿）：看图 15s（暂定）；听音 18s 且**从正式开播起计**。
 * 素材切换由组件层实现（每次切换重新计时、限时 −n s、减尽禁用）。
 */
export const L7_TIERS: Record<MediaType, { timeLimitSec: number }> = {
  image: { timeLimitSec: 15 },
  audio: { timeLimitSec: 18 },
}
