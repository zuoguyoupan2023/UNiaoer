/** 答题节奏：限时题前 1/3 时间隐藏选项，让用户先聚焦图像/音频（见 006 D1） */

/** 选项显示前所占限时的比例 */
export const OPTION_REVEAL_RATIO = 1 / 3

/** 自动进入下一题的等待时长（ms，见 006 D2） */
export const AUTO_NEXT_DELAY_MS = 2000

/**
 * 是否应隐藏选项。
 * - 不限时（undefined）→ 不隐藏
 * - timeLeftSec 为 null 视为刚开始（已用时 0）→ 隐藏
 * - revealSec 显式指定隐藏时长（如 L1 固定 5s）；缺省按限时的 1/3
 */
export function optionsHiddenFor(
  timeLimitSec: number | undefined,
  timeLeftSec: number | null,
  revealSec?: number,
): boolean {
  return secondsUntilReveal(timeLimitSec, timeLeftSec, revealSec) !== null
}

/**
 * 距离选项显示还剩几秒（向上取整，供倒计时文案）；不隐藏时返回 null。
 * 隐藏规则与 optionsHiddenFor 完全一致。
 */
export function secondsUntilReveal(
  timeLimitSec: number | undefined,
  timeLeftSec: number | null,
  revealSec?: number,
): number | null {
  if (!timeLimitSec) return null
  const left = timeLeftSec ?? timeLimitSec
  const hideFor = revealSec ?? timeLimitSec * OPTION_REVEAL_RATIO
  const elapsed = timeLimitSec - left
  if (elapsed >= hideFor) return null
  return Math.max(1, Math.ceil(hideFor - elapsed))
}
