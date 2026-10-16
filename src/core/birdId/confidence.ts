/**
 * 置信度分流 —— P1 UI 的核心规则
 *
 * 依据 experiments/birdid/out/ACCURACY.md 的实测（60 条 R2 样本）：
 *   top-1 置信度 ≥30% 的子集 → top-3 准确率 82.1%
 *   10~30% 的子集           → 明显不可靠
 *   <10% 时命中时/未命中时的置信度中位数是 94.8% vs 10.2%（信号很强）
 *
 * 所以**不能把 top-3 无差别平铺**：低置信度时给候选等于误导用户。
 * 低于 LOW 阈值直接不展示候选，只说「没听出来」。
 */
import type { BirdIdResult, Candidate, ConfidenceBand } from './types'

/** ≥30%：正常展示并标注置信度 */
export const CONF_OK = 0.3
/** <10%：不展示候选（模型自己都没把握） */
export const CONF_LOW = 0.1

export function bandOf(score: number): ConfidenceBand {
  if (score >= CONF_OK) return 'ok'
  if (score >= CONF_LOW) return 'low'
  return 'none'
}

export interface Presented {
  band: ConfidenceBand
  /** 该展示的候选（band=none 时为空数组） */
  shown: Candidate[]
  /** 完整 top-N，保留用于调试与「为什么没显示」的解释 */
  all: Candidate[]
  /** 建议给用户的一句话 */
  message: string
  /** 是否存在「已对上但项目暂无素材」的候选，UI 要显式表达 */
  hasMappedButNoMedia: boolean
  /** 是否存在只能到属的候选 */
  hasGenusOnly: boolean
}

/** 属名加中文友好化：`Accipiter` → `Accipiter(鹰)` 这类信息不在此拼，交给 UI 层 */
export function present(result: BirdIdResult, topN = 3): Presented {
  const all = result.candidates.slice(0, topN)
  const top = all[0]
  const band: ConfidenceBand = top ? bandOf(top.score) : 'none'

  const shown = band === 'none' ? [] : all.filter((c) => bandOf(c.score) !== 'none')

  const hasMappedButNoMedia = shown.some((c) => c.entry && c.entry.t <= 3 && !c.speciesId)
  const hasGenusOnly = shown.some((c) => c.entry && c.entry.t === 4)

  let message: string
  if (!top) message = '没有识别出结果'
  else if (band === 'none')
    message = `没太听出来(最高置信度仅 ${(top.score * 100).toFixed(1)}%),这通常意味着录音太短、背景噪音太大,或者不是鸟叫`
  else if (band === 'low')
    message = `模型不太确定(最高置信度 ${(top.score * 100).toFixed(1)}%),下面的候选仅供参考`
  else if (!shown.some((c) => c.entry && c.entry.t <= 3 && c.speciesId))
    message = '模型听到了一些东西,但都不是本项目收录的鸟种,可能是蛙、虫或环境音'
  else message = ''

  return { band, shown, all, message, hasMappedButNoMedia, hasGenusOnly }
}
