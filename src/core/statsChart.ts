/**
 * 公开统计「活动」图表的刻度计算
 *
 * ## 为什么用对数刻度
 *
 * 站点早期一天只有几轮，最近一天上百轮：线性刻度下早期数据会被压成 0，
 * 看不出「以前也有活动」。对数刻度（纵轴 1 / 10 / 100 / 1000）能同时容纳
 * 个位数和三位数——这也是很多增长看板（GitHub stars、访问量）的默认做法。
 *
 * 为避免把「0」算成非法值，统一用 `log10(n + 1)`：
 * 0 → 0，1 → 0.301，10 → 1.041，100 → 2.004，1000 → 3.000。
 * 这样 1 轮也有可见高度，0 轮仍然是 0（不画柱子）。
 */

/**
 * 顶部刻度取「1-2-5」系列的最近一档（10 / 20 / 50 / 100 / 200 / 500 / 1000 …）。
 *
 * 只取 10 的整数次幂会让 300 轮的数据落在 1000 顶、白白浪费上半屏；
 * 1-2-5 是仪表盘的通用做法（对数轴上的刻度不会太空也不会太挤）。
 */
export function logTop(max: number): number {
  const safe = Math.max(1, max)
  const base = Math.pow(10, Math.floor(Math.log10(safe)))
  for (const m of [1, 2, 5]) {
    if (base * m >= safe) return Math.max(10, base * m)
  }
  return Math.max(10, base * 10)
}

/** 数值 → 图内高度百分比（0..100），0 值返回 0（调用方不画柱子） */
export function logPct(n: number, top: number): number {
  if (n <= 0) return 0
  return (Math.log10(n + 1) / Math.log10(top + 1)) * 100
}

/** tick 文案：1 / 10 / 100 / 1k / 10k */
export function tickLabel(v: number): string {
  if (v >= 1_000_000) return `${v / 1_000_000}M`
  if (v >= 1_000) return `${v / 1_000}k`
  return String(v)
}

export interface LogTick {
  v: number
  label: string
  /** 距底部的百分比 */
  pct: number
}

/** 1 / 2 / 5 / 10 / 20 / 50 … 直到 top 的刻度（含 top） */
export function logTicks(top: number): LogTick[] {
  const out: LogTick[] = []
  for (let e = 0; e < 12; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e)
      if (v > top) return out
      out.push({ v, label: tickLabel(v), pct: logPct(v, top) })
    }
  }
  return out
}

/**
 * 去掉开头连续为 0 的日期（站点上线前的空数据）。
 *
 * 只裁开头：末尾的 0 是「今天还没人玩」，属于真实信息，不能藏。
 * 全为 0 时返回空数组（调用方显示「这段时间还没有记录」）。
 */
export function trimLeadingZeros<T extends { n: number }>(days: T[]): T[] {
  const first = days.findIndex((d) => d.n > 0)
  return first < 0 ? [] : days.slice(first)
}
