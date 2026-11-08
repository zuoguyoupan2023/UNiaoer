import type { MediaType, Tier } from '@/types'

/**
 * 干扰项策略：
 * - cross：跨科优先（易）；mixed：1 同科打头 + 跨科 + 同科补；same：同科为主（L6 语义）。
 * - nameSimilar：**名字 token 相似优先**（099 §3.1 回退链：同组→同色→同科→其余）。
 *   ⚠️ 2026-11-03 用户拍板：token 相似**不混入** L1–L8 任何档位——它是独立模式 S1
 *   （TIERS[9]，见下）。引擎保留该策略供 S1 系模式与未来分组题使用，现有档位零变化。
 */
export type DistractorStrategy = 'cross' | 'mixed' | 'same' | 'nameSimilar'

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
  /**
   * 允许的物种常见度档位（省级档位表 **10 等分**制：1 最常见 → 10 最罕见，每档 ≈ 该地鸟种 10%）。
   *
   * **设计原则（2026-10-30 用户定稿，docs/097）**：档位覆盖**单调扩展**——
   *   L1 取该地鸟种最常见 **70%**（[1-7]）、L2/L3 取 **80%**（[1-8]）、L4/L5 取 **90%**（[1-9]）、
   *   L6/L7/L8 取满 **100%**（[1-10]）。
   * 高难度来自**同科近缘干扰项 + 限时等限制条件**，不靠稀有度难倒做题人：
   * 稀有鸟数据少，把题池限制在稀有鸟只会让题目别扭；限时逼出高度专注 → 快速判断，
   * 做错进错题本回顾 → 最终目的是快速认鸟。
   * L1 比例放宽到 70% 的原因：L1 的用户未必是观鸟新手，也可能是本站新手（老观鸟人热身）。
   *
   * ⚠️ 全局 commonness（ALL/洲模式，无地区档位表时）仍是 1–5 的全球信号分档——
   * 1–5 ⊆ [1-7]，故 ALL/洲模式自动取满（难度全靠形式参数，与设计原则一致）。
   */
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
    commonness: [1, 2, 3, 4, 5, 6, 7], // 097 十档制：最常见 70%
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
    commonness: [1, 2, 3, 4, 5, 6, 7, 8], // 097 十档制：80%
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
    commonness: [1, 2, 3, 4, 5, 6, 7, 8], // 097 十档制：80%（与 L2 同覆盖，难度靠同科干扰+限时）
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
    commonness: [1, 2, 3, 4, 5, 6, 7, 8, 9], // 097 十档制：90%
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
    commonness: [1, 2, 3, 4, 5, 6, 7, 8, 9], // 097 十档制：90%（与 L4 同覆盖，难度靠 10s 限时+环境音）
    mediaPoolSize: 5,
  },
  /**
   * L6 半鸟人（docs/081 §7；README「计划中的题型」；2026-10-24 用户定：**就是难度第六档**，
   * 与 L1–L5 同列，不做独立题型）。模式是「名字 → 图/音」（引擎走 buildNameQuestions，
   * 选项数/限时按题型取 L6_TIERS），本条目供档位按钮/状态栏/结果页标签与类型完备；
   * 其余字段是"代表值"。
   * 097（2026-10-30 十档制）：commonness **取满 [1-10]**——L6 引擎本就不按常见度筛，
   * 介绍页计数标「该地鸟种×100%」。
   */
  6: {
    tier: 6,
    labelKey: 'difficulty.l6.label',
    descKey: 'difficulty.l6.desc',
    optionCount: 6, // 代表值同步 L6_TIERS（看图 6）
    distractor: 'same',
    timeLimitSec: 15, // 代表值取看图档；听音 20s 见 L6_TIERS.audio
    commonness: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 097 十档制：取满 100%
    mediaPoolSize: 1,
  },
  /**
   * L7 鸟娲·造鸟者（docs/089；2026-10-24 定稿）：图/音 → **输入**鸟名（第七档）。
   * 判分见 core/nameMatch.ts（085 §4.1）；限时按题型取 L7_TIERS（图 15s / 音 18s，
   * 音从正式开播起计；素材切换可续命但限时递减 −n s）。
   * 097（2026-10-30 十档制）：commonness 由 [3,4]（高难=少见鸟）改为**取满 [1-10]**——
   * 输入题考的是名字记忆，与稀有度无关；介绍页计数标「该地鸟种×100%」。
   */
  7: {
    tier: 7,
    labelKey: 'difficulty.l7.label',
    descKey: 'difficulty.l7.desc',
    optionCount: 1, // 输入题无选项；代表值（类型完备）
    distractor: 'same',
    timeLimitSec: 15,
    commonness: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 097 十档制：取满 100%
    mediaPoolSize: 5,
  },
  /**
   * L8 记忆挑战鸟（docs/092；2026-10-27 定稿）：翻牌配对（第八档）。
   * 12 对「图/音 ↔ 鸟名」合区 4×6 盘面；纯正计时 + 三档评语（memoryRating.ts），
   * 无限时、无选项、不进错题本、不参与称号与徽章（getStats/evaluate* 跳过 tier 8）。
   * optionCount/distractor/timeLimitSec 为类型完备的代表值，模式不使用；
   * 每对只用首选素材（标准照/最佳录音）；常见度全开——难度梯度只在名称体系（zh/en vs sci）。
   * 097（2026-10-30 十档制）：commonness 对齐取满 [1-10]，与"该地鸟种×100%"的计数标注一致。
   */
  8: {
    tier: 8,
    labelKey: 'difficulty.l8.label',
    descKey: 'difficulty.l8.desc',
    optionCount: 2, // 每对 2 张牌；代表值（记忆翻牌无选项）
    distractor: 'same',
    commonness: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 097 十档制：取满 100%
    mediaPoolSize: 1,
  },
  /**
   * 9 = S1 相似种挑战（docs/099 §3.2；2026-11-03 用户拍板：**独立模式**，
   * 排在未发布的 L8 之后，绝不混入 L1–L8 的干扰项策略）。
   * 分组（2026-11-03 用户定）：按**大色类**（canonical 11 色）——全身或局部有某色都算；
   * 同色同部位（红耳+红耳）优先于同色异部位（红耳+红身），部位只是优先级不是门槛。
   * 题型（双形态，介绍页选择，统一 10s）：'media-stem' 看图选名（经典形态）/
   * 'name-stem' 看名选图（名字题干 + 4 图选项）。**仅看图**——颜色/花纹是视觉维度。
   * 无地区档位/自适应/新手池（独立模式，与 L6 同构）；地区只到国家/洲/全球（省级池太小）。
   * 上架走 S1_ENABLED（与 L8_ENABLED 同模式，launch 时改 true 即可）。
   *
   * 098→2026-11-03 用户定：**6 选项 → 4 选项，20s → 12s**。
   * 理由：出题资格是「同色同伴 ≥ optionCount-1」，门槛从 5 降到 3 会让可出题的鸟成倍增加
   * （4 元组远多于 6 元组），题目组数显著变多；同时更贴合最高原则「刷题辨识鸟」的快节奏。
   */
  9: {
    tier: 9,
    labelKey: 'difficulty.s1.label',
    descKey: 'difficulty.s1.desc',
    optionCount: 4,
    distractor: 'nameSimilar', // 代表值：S1 实际走 buildSimilarQuestions 的色类分组（不走该字段）
    timeLimitSec: 10, // 2026-11-03 用户定：4 选项 · 10s（原 6 选项 · 20s → 12s → 10s）
    optionRevealSec: 0.1, // 用户定：前 2s 隐藏取消 → 0.1s（≈不隐藏，仅保留机制）
    commonness: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 097 十档制：取满 100%（独立模式不做常见度筛选）
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
 * 特殊模式档（答题交互由各自嵌入组件自管，不走经典选择链路）：L6 半鸟人 / L7 输入 /
 * L8 记忆翻牌。**S1（9）是经典选择形态，不算特殊模式**——QuizPlay 里所有「tier >= 6」
 * 的行为分支（计时起点/续轮/作答反馈/完成跳转/快捷键）一律改用本函数判断，
 * 否则 tier 9 会被误当成 L6/L7 而不计时、不反馈。
 */
export function isSpecialModeTier(t: Tier): boolean {
  return t === 6 || t === 7 || t === 8
}

/**
 * 独立模式档（S1 相似种挑战 = 9，docs/100）：
 *
 * S1 是**自成体系的模式**，不参与经典称号 / 徽章 / 统计 / 自适应升降 —— 与 L8 的
 * 「纯计时不设错题、不参与称号与徽章」同一处理原则，但 S1 的排除是**显式集中**在这里的：
 * 以前四处（historyDb.getStats / titles.evaluateTitles / badges.evaluateBadges /
 * roundRecorder.recordRound）各写一遍 `r.tier !== 8`，新增 S1 时漏改一处就会出现
 * 「自适应把 S1 降到 L8」「S1 蹭到 L4 专家徽章」这类串档（docs/100 §5 缺陷 1/2）。
 *
 * **改判口径只改这一个函数**；将来给 S1 做独立体系（独立称号/独立统计页）时，
 * 在这里分流即可，调用点零改动。
 *
 * 注意与 isSpecialModeTier 的区别：那个管**答题交互形态**（L6/L7/L8 有独立答题组件），
 * S1 走经典选择链路所以**不在**里面；本函数管**统计归属**，与交互形态无关。
 */
export function isStandaloneModeTier(t: Tier): boolean {
  return t === 9
}

/**
 * 该档位是否计入经典称号 / 徽章 / 统计（historyDb.getStats、titles、badges 共用）。
 * L8（记忆翻牌恒满分，混入会凭空抬级）与 S1（独立模式，docs/100）都排除。
 */
export function countsInClassicStats(t: Tier): boolean {
  return !(t === 8 || isStandaloneModeTier(t))
}

/**
 * L8 记忆挑战鸟正式上线开关（2026-10-28）：
 * - false = 介绍页难度按钮**不上架第八档**（看图/听音同），已存的「上次档位 = 8」
 *   在介绍页回退默认档（QuizPlay）；模式代码与数据链路全部保留，本地历史里的
 *   L8 记录照常显示（不伪造用户数据）。
 * - 正式推出时：改回 true 重新构建即可，无其他改动。
 */
export const L8_ENABLED = false

/**
 * S1 相似种挑战上架开关（docs/099；2026-11-03 建档）：
 * - false = 介绍页**不上架**（模式/引擎/配置已就绪，与 L8_ENABLED 同模式）；
 *   已存的「上次档位 = 9」在介绍页回退默认档（上线时由 QuizIntro 处理，模式照抄 L8）。
 * - 正式推出时改 true 重新构建即可；UI 接线（QuizIntro/QuizPlay 分支）在 launch 任务里做。
 */
export const S1_ENABLED = false

/** 介绍页难度按钮（L6/L7 = 第六/第七档，与 L1–L5 同列；087 §4.8 / 089 §6；L8 = 092；S1 = 099，排在 L8 后） */
export const TIER_LIST: TierConfig[] = [
  TIERS[1],
  TIERS[2],
  TIERS[3],
  TIERS[4],
  TIERS[5],
  TIERS[6],
  TIERS[7],
  ...(L8_ENABLED ? [TIERS[8]] : []),
  ...(S1_ENABLED ? [TIERS[9]] : []),
]

/**
 * L8 记忆挑战鸟盘面常量（docs/092 §1/§8 + 2026-10-27 用户追加的盘面二选一）：
 * - standard：12 对；**桌面 6 列×4 行 / 手机（≤700px）4 列×6 行**，正式档位；
 * - compact：6 对 3 列×4 行，**实验性缩小盘**（用户实测"是否应该降级"，结论出来前保留，
 *   不行就删）。评语阈值独立——对数减半阈值不是线性减半（首轮找首对的开销摊不薄），
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
 * 干扰项策略固定 same（同科为主，「多选项都是同科鸟」；2026-11-03 用户拍板：token 相似
 * **不进 L6**，见 DistractorStrategy 注释）。选项素材都取首选（媒体池大小 1）。
 */
export const L6_TIERS: Record<MediaType, { optionCount: number; timeLimitSec: number; distractor: DistractorStrategy }> = {
  // 2026-11-03 用户最终决定：**恢复原始难度参数**。
  // 曾短暂试过「看图 4 选项 10s / 听音 16s」（对齐 S1 的快节奏），但 L6 的定位是
  // **「半鸟人」高难关**（6 个同科近缘选项就是要难），缩到 4 选项会削弱它的梯度。
  // 快节奏刷题由 S1 承担，L6 保持难度。→ 看图 6 选项 15s / 听音 4 选项 20s。
  //
  // ⚠️ 唯一保留的改进是**计时起点**（不是难度参数）：
  //   看图 = 等选项图 load 完（useMediaGate，1s 兜底）；
  //   听音 = 等第一次点播（audio-started）——不惩罚带宽与「还没开始听」。
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
