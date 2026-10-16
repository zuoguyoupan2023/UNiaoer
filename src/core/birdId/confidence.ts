/**
 * 候选筛选 —— P1 UI 的核心规则
 *
 * ## 为什么**不显示置信度**（用户决策，2026-10-16）
 *
 * 原本按 ACCURACY.md 的实测设了三档（≥30% / 10~30% / <10%），现在**取消置信度展示**，
 * 理由是置信度对用户没有行动价值：
 *
 * - 图像侧实测 top-3 是 99.9% / 99.7% / 99.1%，**即使认错了也饱和**，完全零区分度；
 * - 有些鸟本就极像（近似种、雌雄差异、幼鸟羽色），图像质量差时也会「既像 A 又像 B」，
 *   这时模型给出多个相近高置信度是**正确行为**，不是 bug；
 * - 给了数字反而制造「>50% 就该对」的错觉。
 *
 * 改为只说一句话「**可能是这几种之一**」，然后把本项目里这几种的**真实素材**
 * 摆出来（带署名），由用户自己判断 —— 这也正是本项目的价值所在：
 * 我们提供的是**可核对的证据**，不是一个断言。
 *
 * 置信度仍保留在内部数据结构里：用于①过滤噪声尾巴（<10% 的尾巴基本是噪声）
 * ②单测断言 ③将来若要埋点统计准确率。**只是不呈现给用户。**
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

  // 只滤掉 <10% 的噪声尾巴（实测未命中时置信度中位数仅 3.3%~10.2%，那基本是噪声）。
  // 注意这里**不是**置信度分流：只要有任何候选过线就展示，不给用户看数字。
  const shown = all.filter((c) => bandOf(c.score) !== 'none')

  const hasMappedButNoMedia = shown.some((c) => c.entry && c.entry.t <= 3 && !c.speciesId)
  const hasGenusOnly = shown.some((c) => c.entry && c.entry.t === 4)

  let message: string
  if (!top) message = '没有识别出结果'
  else if (shown.length === 0)
    message = '没太听出来 —— 可能是录音太短、背景噪音太大,或者不是鸟叫'
  else if (!shown.some((c) => c.entry && c.entry.t <= 3 && c.speciesId))
    message = '听到了一些声音,但都不属于本项目收录的鸟种,可能是蛙、虫或环境音'
  else message = ''

  return { band, shown, all, message, hasMappedButNoMedia, hasGenusOnly }
}
