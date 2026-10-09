/**
 * 028 公开统计看板：读取 `GET /api/stats/public`（无需密钥；边缘缓存 1 小时）。
 *
 * 口径（docs/028 §3.4）：只展示**聚合计数**（访客/会话/轮次/页面浏览/徽章/称号获取数）；
 * 不含任何个人信息。加载失败返回 null（页面显示"暂时不可用"，不阻塞其它功能）。
 */

/** 看板响应（与 worker handlePublicStats 输出一致） */
export interface PublicStats {
  generatedAt: string
  days: number
  since: string
  totals: Record<string, number>
  series: { day: string; event: string; n: number }[]
  badges: { badge?: string; n: number }[]
  titles: { track?: string; level?: string; n: number }[]
  notes?: { visitor?: string; scope?: string }
}

export async function fetchPublicStats(days = 30): Promise<PublicStats | null> {
  try {
    const res = await fetch(`/api/stats/public?days=${days}`)
    if (!res.ok) return null
    return (await res.json()) as PublicStats
  } catch {
    return null
  }
}

/** 事件 → 汇总数值（无则 0） */
export const totalOf = (s: PublicStats | null, event: string): number => s?.totals?.[event] ?? 0

/** 近 N 日某事件的逐日序列（缺日补 0，便于画条形） */
export function dailySeries(s: PublicStats | null, event: string): { day: string; n: number }[] {
  if (!s) return []
  const byDay = new Map<string, number>()
  for (const r of s.series) if (r.event === event) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.n)
  const out: { day: string; n: number }[] = []
  const start = new Date(`${s.since}T00:00:00Z`).getTime()
  for (let i = 0; i < s.days; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ day, n: byDay.get(day) ?? 0 })
  }
  return out
}
