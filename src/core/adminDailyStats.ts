/**
 * 管理端「逐日人次」：读取 `GET /api/metrics/summary?days=N`（需 `x-admin-key`）。
 *
 * 口径（与公开看板同一份数据源 `metrics_daily`）：
 *   · `visitor_unique` 每天一行，值 = 当天按 `sha256(日盐|日|IP|UA)` 去重后的人数
 *     （日盐每日轮换 → 跨日不可关联，所以逐日相加 ≠ 全站去重人数）；
 *   · 日期是 **UTC 日**（Worker 用 `toISOString().slice(0,10)` 写入），不是本地日；
 *   · 职工端是实时数据（含今天，未做 T+1）。
 *
 * 与 `/api/stats/public` 的区别：那个端点有 5 分钟边缘缓存且只给近 30 天日序列；
 * 这里要**逐日原始行**（含每天的海报/会话），故直接用管理端接口。
 */

/** 一天的时间序列（缺事件补 0，便于表格逐日对齐） */
export interface DailyMetric {
  day: string
  /** 当天去重人数（visitor_unique） */
  visitors: number
  sessions: number
  rounds: number
  posters: number
}

export interface DailyStats {
  days: number
  since: string
  /** 逐日（最新在前） */
  daily: DailyMetric[]
  /** 窗口内合计 */
  totals: { visitors: number; sessions: number; rounds: number; posters: number }
}

/** 记账事件 → DailyMetric 字段（其余事件不展示） */
const EVENTS = {
  visitor_unique: 'visitors',
  session_start: 'sessions',
  quiz_complete: 'rounds',
  poster_create: 'posters',
} as const

export class AdminDailyStatsError extends Error {}

interface SummaryRow {
  day: string
  event: string
  props: string
  n: number
}

export async function fetchDailyStats(adminKey: string, days = 30): Promise<DailyStats> {
  const res = await fetch(`/api/metrics/summary?days=${days}`, {
    headers: { 'x-admin-key': adminKey },
    cache: 'no-store',
  })
  if (res.status === 401) throw new AdminDailyStatsError('unauthorized')
  if (!res.ok) throw new AdminDailyStatsError(`http_${res.status}`)
  const body = (await res.json()) as { days: number; since: string; rows: SummaryRow[] }

  // day → 各字段累加（同一事件可能因 props 不同有多行）
  const byDay = new Map<string, DailyMetric>()
  for (const r of body.rows ?? []) {
    const key = (EVENTS as Record<string, keyof Omit<DailyMetric, 'day'>>)[r.event]
    if (!key) continue
    const cell = byDay.get(r.day) ?? { day: r.day, visitors: 0, sessions: 0, rounds: 0, posters: 0 }
    cell[key] += Number(r.n) || 0
    byDay.set(r.day, cell)
  }

  // 窗口内每天都要出现（数据上线前的日子补 0，避免"看起来断档"）
  const daily: DailyMetric[] = []
  const start = Date.parse(`${body.since}T00:00:00Z`)
  for (let i = 0; i < body.days; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    daily.push(byDay.get(day) ?? { day, visitors: 0, sessions: 0, rounds: 0, posters: 0 })
  }
  daily.reverse() // 最新在前

  const totals = daily.reduce(
    (a, d) => ({
      visitors: a.visitors + d.visitors,
      sessions: a.sessions + d.sessions,
      rounds: a.rounds + d.rounds,
      posters: a.posters + d.posters,
    }),
    { visitors: 0, sessions: 0, rounds: 0, posters: 0 },
  )
  return { days: body.days, since: body.since, daily, totals }
}
