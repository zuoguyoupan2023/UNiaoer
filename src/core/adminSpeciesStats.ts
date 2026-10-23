/**
 * 077 鸟种级错误率（**管理端观察期，公开页不展示**）。
 *
 * 口径：
 *   · 数据来自逐题事件 `quiz_answer{species,ok,tier,region,chosen}`，**不含用户/省份维度**；
 *   · 错误率 = 答错次数 / 作答次数（以曝光为分母，避免热门鸟天然错得多）；
 *   · `chosen` 只在答错时上报 → 可得到「A 被认成 B」的组合；
 *   · **管理端实时**（含今天）；T+1 只用于将来公开页；
 *   · 管理端不过滤样本（`answers < 10` 标 `small`）。
 */

export interface SpeciesRateRow {
  species: string
  answers: number
  wrong: number
  /** 错误率（%） */
  rate: number
  small?: boolean
}

export interface WrongPairRow {
  species: string
  chosen: string
  n: number
  small?: boolean
}

export interface SpeciesStats {
  days: number
  since: string
  /** 已更新到哪一天（管理端 = 今天；公开页将来 = 昨天） */
  until: string
  firstDay: string | null
  lastDay: string | null
  totals: { answers: number; species: number; pairs: number }
  species: SpeciesRateRow[]
  pairs: WrongPairRow[]
  notes: { metric?: string; privacy?: string; threshold?: string; freshness?: string }
}

export class AdminSpeciesError extends Error {}

export async function fetchSpeciesStats(adminKey: string, days = 30): Promise<SpeciesStats> {
  const res = await fetch(`/api/admin/stats/species?days=${days}`, {
    headers: { 'x-admin-key': adminKey },
    cache: 'no-store',
  })
  if (res.status === 401) throw new AdminSpeciesError('unauthorized')
  if (!res.ok) throw new AdminSpeciesError(`http_${res.status}`)
  return (await res.json()) as SpeciesStats
}
