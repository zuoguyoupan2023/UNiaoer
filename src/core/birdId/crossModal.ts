/**
 * 跨模态互证 —— 音频与图像互相确认
 *
 * ## 为什么需要（产品的核心，不是锦上添花）
 *
 * 两个模型的失效模式**不相关**，所以叠加能显著提高正确率：
 *
 * - **声音会骗人**：乌鸫（Turdus merula）是著名的模仿者，会学鸲、斑鸠的叫。
 *   只听声音时它可能被认成被模仿的那一种 —— 这类错误**照片几乎不会犯**，
 *   因为羽色、体型、喙形是稳定的形态学证据。
 * - **照片也会骗人**：远距离剪影、夜间红外、幼鸟羽色、非正面姿态下，
 *   图像模型容易退化到笼统标签或近缘种。
 * - **两者都弱时**：冷门种上两个模型都认不出（实测见 ACCURACY.md 与
 *   IMAGE-EVAL.md），此时应诚实说「没把握」，而不是硬凑。
 *
 * 因此产品形态是：**先任选一个模态识别 → 主动引导用另一个模态复核 → 并排显示两路结果**。
 */
import type { Candidate } from './types'

export type Modality = 'audio' | 'image'

export interface CrossResult {
  modality: Modality
  speciesId: string | null
  label: string
  score: number
}

export interface CrossVerdict {
  /** 两路都指向同一种 */
  agree: boolean
  /** 有一路没认出种（笼统标签 / 未命中） */
  degraded: boolean
  /** 该不该建议用户去用另一个模态复核 */
  suggest: Modality | null
  /** 给用户的一句话 */
  text: string
}

/** 取该模态下「能落到具体物种」的最高分候选（跳过笼统标签与未命中） */
export function bestConcrete(cands: Candidate[]): CrossResult | null {
  for (const c of cands) {
    if (c.speciesId && c.entry && c.entry.t <= 3) {
      return { modality: 'audio', speciesId: c.speciesId, label: c.label, score: c.score }
    }
  }
  return null
}

export function topResult(modality: Modality, cands: Candidate[]): CrossResult | null {
  const c = cands[0]
  if (!c) return null
  return { modality, speciesId: c.speciesId, label: c.label, score: c.score }
}

/**
 * 比对两路结果，决定是否建议换模态复核，以及给用户怎么说。
 *
 * @param first  先做的那一路
 * @param second 后做的那一路（可为空）
 * @param hasOtherMedia 该种在项目里是否还有另一模态的素材可看
 */
export function compare(
  first: CrossResult | null,
  second: CrossResult | null,
  hasOtherMedia: boolean,
): CrossVerdict {
  const suggest = (other: Modality): Modality => other

  if (!first) {
    return { agree: false, degraded: true, suggest: suggest('image'), text: '' }
  }
  const degraded = !first.speciesId

  if (!second) {
    if (degraded) {
      // 第一路没认出种 → 建议换模态，这是最该换的时候
      return {
        agree: false,
        degraded: true,
        suggest: suggest('image'),
        text: '这一路没认出具体物种。换张照片试试，往往能直接锁定。',
      }
    }
    if (!hasOtherMedia) {
      return {
        agree: false,
        degraded: false,
        suggest: null,
        text: '本项目暂时没有这个物种的另一种素材，没法互相印证。',
      }
    }
    return {
      agree: false,
      degraded: false,
      suggest: suggest('image'),
      text: '',
    }
  }

  const same = !!first.speciesId && first.speciesId === second.speciesId
  if (same) {
    return {
      agree: true,
      degraded: false,
      suggest: null,
      text: '声音与照片指向同一个物种，互相印证 —— 这个判断比较可靠。',
    }
  }
  if (!second.speciesId) {
    return {
      agree: false,
      degraded: true,
      suggest: null,
      text: '照片没能给出更具体的结果，仍以第一路为准。',
    }
  }
  return {
    agree: false,
    degraded: false,
    suggest: null,
    text: '两个模态给出了不同物种 —— 可能其中一路认错了。若两路分数都不高，建议当作「没把握」，再补一段更清晰的素材。',
  }
}
