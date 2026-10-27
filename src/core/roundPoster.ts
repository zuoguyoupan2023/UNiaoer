/**
 * 2026-10-25（问题 2）：**历史轮次 → 海报数据**的共享构造器。
 *
 * 结果页（ResultView）与「我的-历史」（RoundHistoryView）都用它，保证同一条轮次
 * 无论从哪进，海报口径完全一致（模式/档位/题目范围/分数/错题行/昵称/称号）。
 *
 * 与结果页的差异只在数据来源：结果页用 quiz store 的实时状态（含 session 轮次、
 * 佩戴称号的实时文本）；历史页只有落库的 RoundRecord，因此：
 *   · 称号/徽章：历史记录里**没有存**（当时只是展示项）→ 不画（传 undefined 即不占位）；
 *   · 昵称：用当前档案昵称（settings.nickname / archive 快照）作为署名；
 *   · 会话轮次/整体正确率：历史单轮无此上下文 → 不传（海报不显示「第 N 轮」）。
 *
 * 旧数据兼容（用户要求）：`region` 缺省 → 不显示题目范围；`answers` 用记录里存的
 * 答案/错选名（id 反查优先），不会因缺字段而崩。
 */
import type { RoundRecord, RoundItem } from './historyDb'
import type { PosterData, PosterImage, PosterWrong } from './poster'

export interface RoundPosterDeps {
  /** 答案名解析（当前语言）：历史页传 nameOf；结果页传等价实现 */
  nameOf: (it: RoundItem) => string
  /** 错选名解析（当前语言） */
  choiceOf: (it: RoundItem) => string
  /** 模式标签（鸟图版/鸟声版等） */
  modeLabel: string
  /** 档位标签（L1 入门 … L7 鸟娲·造鸟者 / L8 记忆挑战鸟） */
  tierLabel: string
  /** 题目范围（地区展示名）；缺省/'' → 不画（旧数据兼容） */
  regionLabel?: string
  /** 昵称（可空） */
  nickname?: string
  /** 日期文本（缺省用记录时间） */
  date?: string
  /**
   * 092 记忆挑战鸟：记忆轮（round.memory 存在）的 用时/评语 展示文本
   * （调用方按 locale 构造；不传则记忆轮回退分数画法——旧调用方兼容）。
   */
  memoryText?: (round: RoundRecord) => { time: string; rating: string }
}

/** RoundRecord → PosterData（不含称号/徽章/会话轮次——历史无这些上下文） */
export function posterDataFromRound(round: RoundRecord, deps: RoundPosterDeps): PosterData {
  const base = {
    modeLabel: deps.modeLabel,
    tierLabel: deps.tierLabel,
    regionLabel: deps.regionLabel || undefined,
    correct: round.correct,
    total: round.total,
    accuracy: round.accuracy,
    date: deps.date ?? new Intl.DateTimeFormat().format(new Date(round.at)),
    nickname: deps.nickname || undefined,
  }
  // 092 记忆挑战鸟：海报画「评语 + 用时」，不画分数/错题（docs/092 §4.1）
  if (round.memory && deps.memoryText) {
    const mt = deps.memoryText(round)
    return { ...base, memory: { time: mt.time, rating: mt.rating, pairs: round.memory.pairs }, wrong: [] }
  }
  const wrong: PosterWrong[] = round.items
    .filter((it) => !it.correct)
    .map((it) => ({
      answer: deps.nameOf(it),
      chosen: it.timedOut || it.chosen == null ? null : deps.choiceOf(it),
      timedOut: !!it.timedOut,
    }))
  return { ...base, wrong }
}

/**
 * RoundRecord → 海报可选背景图（该轮**图片题**的题面素材；错误题优先，与结果页同则）。
 * 旧记录无 mediaUrl 的条目自动跳过。
 */
export function posterImagesFromRound(round: RoundRecord): PosterImage[] {
  const seen = new Set<string>()
  const out: PosterImage[] = []
  // 错题优先（F6：用错题做背景更有教学意义）
  // 错题（correct=false，排在 true 之前）
  const ordered = [...round.items].sort((a, b) => Number(a.correct) - Number(b.correct))
  for (const it of ordered) {
    if (it.type !== 'image' || !it.mediaUrl || seen.has(it.mediaUrl)) continue
    seen.add(it.mediaUrl)
    out.push({ url: it.mediaUrl, answer: it.answer, sci: it.sci || undefined, wrong: !it.correct })
  }
  return out
}
