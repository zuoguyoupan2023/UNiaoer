/**
 * 候选筛选 —— P1 UI 的核心规则
 *
 * ## 为什么**不显示置信度数字**（用户决策，2026-10-16）
 *
 * 置信度对用户没有行动价值：
 *
 * - 图像侧旧的 SpeciesNet 实测 top-3 是 99.9% / 99.7% / 99.1%，**即使认错了也饱和**；
 * - 有些鸟本就极像（近似种、雌雄差异、幼鸟羽色），图像质量差时也会「既像 A 又像 B」，
 *   这时模型给出多个相近高置信度是**正确行为**，不是 bug；
 * - 给了数字反而制造「>50% 就该对」的错觉。
 *
 * 改为只说一句话「**可能是这几种之一**」，然后把本项目里这几种的**真实素材**
 * 摆出来（带署名），由用户自己判断 —— 这也正是本项目的价值所在：
 * 我们提供的是**可核对的证据**，不是一个断言。
 *
 * ## 2026-10-20 修正：低分不再直接隐藏
 *
 * 旧规则是「top-1 < 10% → 一个候选都不显示，只说没听出来」。实测这条会误伤：
 * BirdNET 对一段 20~30s 录音里只叫了一两声的鸟，聚合后 top-1 可能只有 2~8%，
 * 但排序仍然是对的（`docs/065` P0-1 记的 2.7% 就是这种情况）。
 * 同时 worker 的多窗聚合已从中位数改成 75 分位（见 `worker.ts`），先把分数抬回来一截。
 *
 * 现在的规则：
 *   - **始终保留 top-1**，并按相对分数保留紧跟其后的候选（≥ top1 的 15%，且 ≥0.5%）；
 *   - `band` 仍按绝对分数记录（ok/low/none），但 `band=none` 也会展示候选，
 *     并给一句「模型不太确定」的提示，而不是让用户以为模型什么都没听到；
 *   - 不再用「<10% 即空」这种会隐藏正确结果的硬门槛。
 */
import type { BirdIdResult, Candidate, ConfidenceBand } from './types'

/** ≥30%：正常展示 */
export const CONF_OK = 0.3
/** <10%：模型不太确定；仍展示候选，但加提示 */
export const CONF_LOW = 0.1
/** 相对 top-1 的尾巴阈值：低于 top1 的 15% 且低于 0.5% 的候选不展示 */
const TAIL_RATIO = 0.15
const TAIL_FLOOR = 0.005

export function bandOf(score: number): ConfidenceBand {
  if (score >= CONF_OK) return 'ok'
  if (score >= CONF_LOW) return 'low'
  return 'none'
}

export interface Presented {
  band: ConfidenceBand
  /** 该展示的候选；**band=none 时也可能非空**（低分但排序有信息量） */
  shown: Candidate[]
  /** 完整 top-N，保留用于调试与「为什么没显示」的解释 */
  all: Candidate[]
  /** 建议给用户的一句话——**i18n key**（空串 = 不必多说），由视图 `t(messageKey)` 渲染 */
  messageKey: string
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

  // 相对尾巴过滤：top-1 永远保留；后面的候选必须不是噪声。
  // 不用绝对 10% 硬门槛，否则 2.7% 的正确 top-1 会被整段吞掉。
  const floor = top ? Math.max(TAIL_FLOOR, top.score * TAIL_RATIO) : TAIL_FLOOR
  const shown = all.filter((c, i) => i === 0 || c.score >= floor)

  // 判据是「名录明确说没有素材」(entry.p === false)，**不是** speciesId 缺失 ——
  // 后者只是因为产物过去只从采集台账取 id，会把核心库的种误判成没素材（2026-10-17 白头鹎）。
  const hasMappedButNoMedia = shown.some((c) => c.entry && c.entry.t <= 3 && c.entry.p === false)
  const hasGenusOnly = shown.some((c) => c.entry && c.entry.t === 4)

  // 文案一律返回 i18n key，由视图 t(messageKey) 渲染(015 §8: no CJK literals in core layer)
  let messageKey: string
  if (!top) messageKey = 'birdId.band.noResult'
  else if (!shown.some((c) => c.entry && c.entry.t <= 3 && c.speciesId))
    messageKey = 'birdId.band.notOurBirds'
  else if (band === 'none') messageKey = 'birdId.band.low'
  else messageKey = ''

  return { band, shown, all, messageKey, hasMappedButNoMedia, hasGenusOnly }
}
