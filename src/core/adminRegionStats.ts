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
}

export interface RegionAccuracy {
  days: number
  since: string
  /** 该指标本身的起点（早于它的轮次没有 band，不计入） */
  metricSince: string
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
