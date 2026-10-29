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
   * 097（2026-10-29 用户定）：commonness **取满 [1-5]**——L6 引擎本就不按常见度筛，
   * 介绍页计数标「该地鸟种×100%」。
   */
  6: {
    tier: 6,
    labelKey: 'difficulty.l6.label',
    descKey: 'difficulty.l6.desc',
    optionCount: 6,
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [1, 2, 3, 4, 5],
    mediaPoolSize: 1,
  },
  /**
   * L7 鸟娲·造鸟者（docs/089；2026-10-24 定稿）：图/音 → **输入**鸟名（第七档）。
   * 判分见 core/nameMatch.ts（085 §4.1）；限时按题型取 L7_TIERS（图 15s / 音 18s，
   * 音从正式开播起计；素材切换可续命但限时递减 −n s）。
   * 097（2026-10-29 用户定）：commonness 由 [3,4]（高难=少见鸟）改为**取满 [1-5]**——
   * 输入题考的是名字记忆，与稀有度无关；介绍页计数标「该地鸟种×100%」。
   */
  7: {
    tier: 7,
    labelKey: 'difficulty.l7.label',
    descKey: 'difficulty.l7.desc',
    optionCount: 1, // 输入题无选项；代表值（类型完备）
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [1, 2, 3, 4, 5],
    mediaPoolSize: 5,
  },
  /**
   * L8 记忆挑战鸟（docs/092；2026-10-27 定稿）：翻牌配对（第八档）。
   * 12 对「图/音 ↔ 鸟名」合区 4×6 盘面；纯正计时 + 三档评语（memoryRating.ts），
   * 无限时、无选项、不进错题本、不参与称号与徽章（getStats/evaluate* 跳过 tier 8）。
   * optionCount/distractor/timeLimitSec 为类型完备的代表值，玩法不使用；
   * 每对只用首选素材（标准照/最佳录音）；常见度全开——难度梯度只在名称体系（zh/en vs sci）。
   * 097（2026-10-29）：commonness 对齐取满 [1-5]，与"该地鸟种×100%"的计数标注一致。
   */
  8: {
    tier: 8,
    labelKey: 'difficulty.l8.label',
    descKey: 'difficulty.l8.desc',
    optionCount: 2, // 每对 2 张牌；代表值（记忆翻牌无选项）
    distractor: 'same',
    commonness: [1, 2, 3, 4, 5],
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

/**
 * L8 记忆挑战鸟正式上线开关（2026-10-28）：
 * - false = 介绍页难度按钮**不上架第八档**（看图/听音同），已存的「上次档位 = 8」
 *   在介绍页回退默认档（QuizPlay）；玩法代码与数据链路全部保留，本地历史里的
 *   L8 记录照常显示（不伪造用户数据）。
 * - 正式推出时：改回 true 重新构建即可，无其他改动。
 */
export const L8_ENABLED = false

/** 介绍页难度按钮（L6/L7 = 第六/第七档，与 L1–L5 同列；087 §4.8 / 089 §6；L8 = 092） */
export const TIER_LIST: TierConfig[] = [
  TIERS[1],
  TIERS[2],
  TIERS[3],
  TIERS[4],
  TIERS[5],
  TIERS[6],
  TIERS[7],
  ...(L8_ENABLED ? [TIERS[8]] : []),
]

/**
 * L8 记忆挑战鸟盘面常量（docs/092 §1/§8 + 2026-10-27 用户追加的盘面二选一）：
 * - standard：12 对；**桌面 6 列×4 行 / 手机（≤700px）4 列×6 行**，正式档位；
 * - compact：6 对 3 列×4 行，**实验性缩小盘**（用户试玩"是否应该降级"，结论出来前保留，
 *   不行就删）。评语阈值独立——对数减半阈值不是线性减半（开局找首对的开销摊不薄），
 *   暂按图 20/30s、音 35/50s 暂定，实测后调整。
 * 对数是评语阈值的前提，改这里必须同步实测阈值。
 */
/**
 * L8 记忆挑战鸟盘面常量（docs/092 §1/§8 + 2026-10-27 用户改定）：
 * - standard：12 对；**桌面 6 列×4 行 / 手机（≤640px）4 列×6 行**，正式档位；
 * - compact：6 对 3 列×4 行，缩小盘（用户在试"是否应该降级"，结论前保留）。
 * 评语阈值（2026-10-27 用户定）：**大盘 60/90s、小盘 30/60s，看图与听音共用同一套**
 * （不再按题型分档）。对数是评语阈值的前提，改这里必须同步实测阈值。
 */
export type MemoryBoardKind = 'standard' | 'compact'

export interface MemoryBoardDef {
  /** 对数（= 24 张牌的一半 / 12 张牌的一半） */
  pairs: number
  /** i18n 键尾段（memory.board*） */
  key: MemoryBoardKind
  /** 天才 / 厉害的用时上限（ms）；两种题型共用 */
  geniusMs: number
  awesomeMs: number
}

export const MEMORY_BOARDS: Record<MemoryBoardKind, MemoryBoardDef> = {
  standard: { pairs: 12, key: 'standard', geniusMs: 60_000, awesomeMs: 90_000 },
  compact: { pairs: 6, key: 'compact', geniusMs: 30_000, awesomeMs: 60_000 },
}

/** 默认盘面（未选择/旧设置时） */
export const MEMORY_DEFAULT_BOARD: MemoryBoardKind = 'standard'

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
