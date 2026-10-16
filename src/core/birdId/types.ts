/**
 * 端上识鸟(055 P1)类型定义
 *
 * 定位红线（055 §5.3）：**这是「识鸟 → 看素材」的独立探索工具，不接答题链路**，
 * AI 做陪练不做答案。全程端上，用户的录音/图片不上传任何服务器。
 */

/** 对表分级：与 scripts/build-model-label-map.mjs 的 tiers 一致 */
export const TIER_EXACT = 1 // 学名精确
export const TIER_EN = 2 // 英文名精确
export const TIER_ZH = 3 // 中文名精确
export const TIER_GENUS = 4 // 仅属名 —— 诚实降级，不冒充具体种
export const TIER_NONE = 5 // 不在项目名录内（实测多为蛙/虫/猴等非鸟）

/** model-labels-<task>.json 里的一条记录（短字段名以压体积） */
export interface LabelEntry {
  /** speciesId；null = 已对上但本项目当前无可播放素材（053 尚未采到） */
  s: string | null
  /** tier，见上 */
  t: number
  /** 中文名，回退英文名 */
  z: string | null
  /** 属名，仅 T4 有值 */
  g?: string | null
  /**
   * 本项目是否有该种的素材（名录权威层口径）。
   * false 才能诚实说「本项目收录了，但暂无素材」；null/undefined = 不知道（别据此下结论）。
   */
  p?: boolean | null
}

export interface LabelMapFile {
  task: string
  model: string
  generatedAt: string
  /** 模型输出类别数，必须等于 labels.length */
  classCount?: number
  /**
   * labels[i] = 模型第 i 类输出的标签原文，**顺序即下标，不可过滤**。
   * 必需：entries 是过滤后的映射表（图像侧剔除了非鸟与上位分类标签），
   * 它的键顺序对不上模型输出下标，只有 labels 能按下标取标签。
   */
  labels?: string[]
  /** 种级标签数（旧字段，保留兼容） */
  labelCount: number
  exactRate: number
  tiers: Record<string, number>
  entries: Record<string, LabelEntry>
}

/** 模型输出的一条候选 */
export interface Candidate {
  /** 模型标签原文（`学名_英文名`），对表的键 */
  label: string
  /** 0~1 */
  score: number
  /** 对表结果；label 不在表里时为 null */
  entry: LabelEntry | null
  /** 本项目 speciesId；已对上但无素材时为 null */
  speciesId: string | null
  /**
   * 当地常见度档位 1~5（regionPrior 填）；null = 未选地区或查不到。
   * **null 不等于「当地没有」** —— 只是没有记录，不要据此断言不存在。
   */
  regionTier?: number | null
}

/** 置信度分流档（依据 experiments/birdid/out/ACCURACY.md 实测） */
export type ConfidenceBand = 'none' | 'low' | 'ok'

export interface BirdIdResult {
  /** top-N 候选（已剔除无映射标签），含未命中的，用于解释「没听出来」 */
  candidates: Candidate[]
  /** 因无映射被剔除的候选数（图像侧多为「bird」这类上位分类标签） */
  skippedUnmapped?: number
  /** 音频时长秒 */
  durationSec: number
  /** 实际推理的 3 秒窗口数 */
  windows: number
}
