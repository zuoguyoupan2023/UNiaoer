/**
 * 028 公开统计看板：读取 `GET /api/stats/public`（无需密钥）。
 *
 * ## 缓存策略（2026-11-06 重写）
 *
 * 历史：2026-10-20 CF 边缘把该端点按 **4 小时**缓存（`max-age=14400`），导致用户看到
 * 两小时前的数据。当时用「5 分钟路径分桶」绕过（每个不同的桶号 → 新的缓存键）。
 *
 * **现在不再需要分桶**：Worker 侧已改成读 D1 快照（1 行），并强制
 * `cache-control: no-store` + 前端 `cache: 'no-store'`，边缘与浏览器都不会留副本。
 * 分桶反而有害——每个桶号都是一次**不可复用的 CDN 缓存键**，会多打一次 Worker。
 *
 * 新鲜度由「整点 cron + 手动刷新」控制（见 docs/111），前端无条件读最新快照。
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
  /**
   * 072-k / 076：各水平正确率。
   * 076：`approx: false` = 精确（Σcorrect/Σtotal）；`approx: true` = 仅有分桶历史数据的中点估算。
   * n < 10 的档位不下发。
   */
  accuracyByTier?: {
    tier: string
    n: number
    mean: number
    approx?: boolean
    bands?: Record<string, number>
  }[]
  notes?: { visitor?: string; scope?: string }
}

export async function fetchPublicStats(days = 30): Promise<PublicStats | null> {
  try {
    // 不再带路径分桶（见文件头注释）：Worker 读的是全局共享快照，且已 no-store
    const res = await fetch(`/api/stats/public?days=${days}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as PublicStats
  } catch {
    return null
  }
}

/** 事件 → 汇总数值（无则 0） */
export const totalOf = (s: PublicStats | null, event: string): number => s?.totals?.[event] ?? 0

/**
 * 手动刷新看板（2026-11-06）：让 Worker 重算一次并覆盖快照。
 *
 * 语义：`POST /api/stats/refresh?days=N`
 *   · 成功 → `{ ok: true, builtAt, retryAfterSec }`（10 分钟内不能再刷）
 *   · 冷却中 → `{ ok: false, cooldownSec }`（HTTP 429，Worker 权威）
 *
 * 刷新后的结果**全局共享**：快照存在 D1，其他人下次打开看板拿到的就是这份。
 */
export async function refreshPublicStats(
  days = 30,
): Promise<{ ok: boolean; retryAfterSec?: number; cooldownSec?: number; builtAt?: string }> {
  try {
    const res = await fetch(`/api/stats/refresh?days=${days}`, { method: 'POST', cache: 'no-store' })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      retryAfterSec?: number
      builtAt?: string
    }
    if (res.status === 429) {
      return { ok: false, cooldownSec: Number(body.retryAfterSec ?? 600) }
    }
    if (!res.ok) return { ok: false }
    return { ok: Boolean(body.ok), retryAfterSec: body.retryAfterSec, builtAt: body.builtAt }
  } catch {
    return { ok: false }
  }
}

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
