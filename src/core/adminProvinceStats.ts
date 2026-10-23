/**
 * 076 省际统计（**管理端观察期，未公开**）。
 *
 * 口径（docs/076）：
 *   · `prov` = **做题者**的省级归属地（Worker 从 `request.cf` 派生，不存 IP；仅统计已同意用户）；
 *   · `region` = 题目地区（用户自选）—— 与归属地是两套口径，展示时必须分列；
 *   · 人数 = 每省**每日去重**后累加（人日）；正确率 = Σcorrect / Σtotal，`n < 10` 不展示；
 *   · 港澳台在服务端归并为 `CN-91/92/71`，展示名走 i18n（中国香港/中国澳门/中国台湾）。
 */

export interface ProvinceRow {
  prov: string
  /** 每日去重人数之和（人日） */
  users: number
  /** 省级访问次数（会话） */
  visits: number
  /** 轮次数 */
  rounds: number
  /** 平均正确率（n < 10 时为 null） */
  accuracy: { n: number; mean: number } | null
}

export interface ProvinceMatrixRow {
  uprov: string
  region: string
  tier: string
  n: number
  mean: number
}

export interface ProvinceStats {
  days: number
  since: string
  provinces: ProvinceRow[]
  matrix: ProvinceMatrixRow[]
  notes: { uprov?: string; region?: string; threshold?: string; consent?: string }
}

export class AdminProvinceError extends Error {}

export async function fetchProvinceStats(adminKey: string, days = 30): Promise<ProvinceStats> {
  const res = await fetch(`/api/admin/stats/province?days=${days}`, {
    headers: { 'x-admin-key': adminKey },
    cache: 'no-store',
  })
  if (res.status === 401) throw new AdminProvinceError('unauthorized')
  if (!res.ok) throw new AdminProvinceError(`http_${res.status}`)
  return (await res.json()) as ProvinceStats
}
