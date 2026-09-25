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
  if (!timeLimitSec) return false
  const left = timeLeftSec ?? timeLimitSec
  const hideFor = revealSec ?? timeLimitSec * OPTION_REVEAL_RATIO
  return timeLimitSec - left < hideFor
}
