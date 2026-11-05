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
 * 只裁开头：末尾的 0 是「今天还没有人作答」，属于真实信息，不能藏。
 * 全为 0 时返回空数组（调用方显示「这段时间还没有记录」）。
 */
export function trimLeadingZeros<T extends { n: number }>(days: T[]): T[] {
  const first = days.findIndex((d) => d.n > 0)
  return first < 0 ? [] : days.slice(first)
}

/* ── 趋势图的「按天聚合」工具（2026-11-05）──────────────────────────────
 * 把逐轮记录按**本地日**归并成日桶（同一天多轮按题数加权合并）。
 * 「我的 → 数据」趋势图用它做**横轴日期刻度**：一天一个刻度位，
 * 每隔几天显示一个日期（组件里控制密度），并取当天的平均序号定位 x。
 *
 * 历史：2026-11-04~05 曾在此实现过「3 日移动平均曲线」（按天/按轮两个版本都试过），
 * 2026-11-05 用户定：**回退为区间平均横线**（一条水平虚线 + 数值），均线曲线整体下线。
 * dailyBuckets 保留，仅供横轴刻度使用。
 */

/** 单轮的输入（只需这几项，方便测试） */
export interface MaRoundInput {
  at: number
  total: number
  correct: number
}

/** 日均值桶：一天一行 */
export interface MaDayBucket {
  /** 当天代表时间戳（该天首轮的时刻） */
  at: number
  questions: number
  correct: number
  /** 当天各轮次在原数组里的下标（均线点取平均序号定位 x） */
  indices: number[]
  accuracy: number
}

/** 把一个本地时间归到「当天 0 点」的时间戳（按天聚合/横轴刻度的 key） */
export function localDayStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 供模块内使用的别名 */
function dayKey(at: number): number {
  return localDayStart(at)
}

/** 按「日」聚合成日均值桶，时间正序。同一天多轮按题数加权合并 */
export function dailyBuckets(rounds: MaRoundInput[]): MaDayBucket[] {
  const map = new Map<number, { at: number; questions: number; correct: number; indices: number[] }>()
  rounds.forEach((r, i) => {
    const key = dayKey(r.at)
    const b = map.get(key)
    if (b) {
      b.questions += r.total
      b.correct += r.correct
      b.indices.push(i)
    } else {
      map.set(key, { at: r.at, questions: r.total, correct: r.correct, indices: [i] })
    }
  })
  return [...map.values()]
    .sort((a, b) => a.at - b.at)
    .map((b) => ({
      ...b,
      accuracy: b.questions ? Math.round((b.correct / b.questions) * 100) : 0,
    }))
}
