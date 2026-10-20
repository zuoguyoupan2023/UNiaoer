/**
 * 028 公开统计看板：读取 `GET /api/stats/public`（无需密钥）。
 *
 * ## 为什么 URL 里带「5 分钟分桶」
 *
 * 2026-10-20 事故：CF 边缘把该端点按 **4 小时**缓存在了 CDN 上（`cf-cache-status: HIT`、
 * `cache-control: public, max-age=14400`），浏览器也跟着缓存 4 小时——用户过了两小时
 * 刷新，看到的还是 20:41 的快照，而另一台设备看到的是 22:11。
 *
 * 因此每次请求换一个**路径分桶**（`/api/stats/public/<bucket>`）：路径一定进缓存键，
 * 无论边缘规则怎么配都无法把上一桶的响应喂给下一桶。Worker 侧把分桶忽略、缓存键仍取
 * `?days=N`，所以 D1 聚合并不会因此变频繁（见 worker handlePublicStats）。
 * 同时显式 `cache: 'no-store'`，连浏览器缓存也不留。
 *
 * 口径（docs/028 §3.4）：只展示**聚合计数**（访客/会话/轮次/页面浏览/徽章/称号获取数）；
 * 不含任何个人信息。加载失败返回 null（页面显示"暂时不可用"，不阻塞其它功能）。
 */

/** 分桶粒度：与 Worker 的 PUBLIC_STATS_TTL 对齐（5 分钟） */
const BUCKET_MS = 300_000

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
  const bucket = Math.floor(Date.now() / BUCKET_MS)
  try {
    const res = await fetch(`/api/stats/public/${bucket}?days=${days}`, { cache: 'no-store' })
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
