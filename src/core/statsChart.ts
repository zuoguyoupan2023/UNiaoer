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

/* ── 正确率趋势的「N 日移动平均」（2026-11-04）──────────────────────────
 * 用于「我的 → 数据」页的趋势图：把逐轮正确率按**有记录的日期**聚合成日均值，
 * 再对日均值做 N 日滑动平均，得到类似股市均线的参考曲线。
 *
 * 三条硬规则（都踩过坑）：
 *  1. **窗口必须填满 N 个记录日才出点**。曾经的写法用 `Math.max(0, i - N + 1)`
 *     给开头补位，结果第 1、2 天就画出了「3 日均值」——那不是 3 日均线，是前 1~2 天
 *     的原始值，起点必然剧烈偏摆。现在从第 N 个记录日起画。
 *  2. **按有记录的日子推进，不按自然日**。多数人不会每天做题，按自然日会在空档处
 *     断裂或需要编造插值；用户要的是「过去 3 个有记录的日期」。
 *  3. **同一天多轮先合并**（按题数加权）。否则一天两个点会让曲线抖动，
 *     而且「日均值」应当代表那一天的整体表现，不是其中某一轮。
 */

/** 单轮的输入（只需这几项，方便测试） */
export interface MaRoundInput {
  at: number
  total: number
  correct: number
}

/** 日均值桶 */
export interface MaDayBucket {
  /** 当天的代表时间戳（该天首轮的时刻，仅用于排序/显示） */
  at: number
  questions: number
  correct: number
  /** 当天各轮次在原数组里的下标（算 x 坐标用，同日多轮取平均） */
  indices: number[]
  accuracy: number
}

/** 把一个本地日期归一到「当天 0 点」的时间戳（key 用） */
function dayKey(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * 按「日」聚合成日均值桶，时间正序。
 * 同一天多轮按题数加权合并（total 为 0 的轮次不贡献权重，单独存在的日 accuracy 为 0）。
 */
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

/** 移动平均点 */
export interface MaPoint {
  at: number
  accuracy: number
  /** 该日各轮次在原数组里的下标 */
  indices: number[]
}

/**
 * N 日移动平均：**从第 window 个记录日起出点**（窗口填满才开始）。
 *
 * @param rounds 按时间正序的轮次（调用方负责排序与区间过滤）
 * @param window 窗口大小，默认 3；小于 1 时按 1 处理
 * @returns 均线点（数量 = 记录日数 - window + 1，不足则为空）
 */
export function movingAverage(rounds: MaRoundInput[], window = 3): MaPoint[] {
  const w = Math.max(1, Math.floor(window))
  const days = dailyBuckets(rounds)
  const out: MaPoint[] = []
  for (let i = w - 1; i < days.length; i++) {
    const slice = days.slice(i - w + 1, i + 1)
    const questions = slice.reduce((n, d) => n + d.questions, 0)
    const correct = slice.reduce((n, d) => n + d.correct, 0)
    out.push({
      at: days[i]!.at,
      accuracy: questions ? Math.round((correct / questions) * 100) : 0,
      indices: days[i]!.indices,
    })
  }
  return out
}
