/**
 * 073 P0：地区正确率（**管理端观察期，未公开**）。
 *
 * 口径 A：`quiz_result` 里的 `region` = **用户答题时自选**的地区（不是 IP）。
 * 数据只有管理端能看（`x-admin-key`），观察一段确认口径与体量后再决定是否公开到 `/stats`。
 *
 * 与 `/api/metrics/summary` 不同：这里只返回**聚合后的分桶正确率**，
 * 不含逐日明细、不含任何用户信息。
 */

export interface RegionAccuracyRow {
  region: string
  /** 轮次数 */
  n: number
  /** 平均正确率（桶中点加权估算，1% 取整） */
  mean: number
  bands: Record<string, number>
  tiers: Record<string, number>
  /** 该地区数据的第一天 / 最后一天（避免把"窗口起点"当成"数据起点"） */
  firstDay: string
  lastDay: string
}

export interface RegionAccuracy {
  days: number
  /** **查询窗口**起点（近 N 天），不是数据起点 */
  since: string
  /** 该指标的真实起点：有 band 的第一天 */
  metricFirstDay: string | null
  metricLastDay: string | null
  /** 带 region 属性的第一天（地区维度真正的起点） */
  regionFirstDay: string | null
  /** 逐日明细（人工核对用） */
  byDay: { day: string; n: number; mean: number }[]
  /** 有 band 但没有 region 属性的轮次数（`region` 属性上线前的历史） */
  missingRegion: number
  total: number
  byRegion: RegionAccuracyRow[]
}

export class AdminStatsError extends Error {}

export async function fetchRegionAccuracy(adminKey: string, days = 30): Promise<RegionAccuracy> {
  const res = await fetch(`/api/stats/region?days=${days}`, {
    headers: { 'x-admin-key': adminKey },
    cache: 'no-store',
  })
  if (res.status === 401) throw new AdminStatsError('unauthorized')
  if (!res.ok) throw new AdminStatsError(`http_${res.status}`)
  return (await res.json()) as RegionAccuracy
}
