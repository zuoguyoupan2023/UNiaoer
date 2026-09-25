/** 触屏手势：向左滑动进入下一题（见 006 D3） */

/** 触发左滑所需的最小水平位移（px） */
export const SWIPE_MIN_DX = 60
/** 允许的最大垂直位移（px），避免与页面滚动冲突 */
export const SWIPE_MAX_DY = 80

/** 是否构成"向左滑动"手势 */
export function isLeftSwipe(dx: number, dy: number): boolean {
  return dx <= -SWIPE_MIN_DX && Math.abs(dy) <= SWIPE_MAX_DY
}
