/**
 * B6 报错 / 大众评审 前端 API（同源 `/api/reports`，由 Worker 提供）。
 * 生产环境与站点同源；本地开发经 vite 代理到 `npm run worker:dev`（8787）。
 */
import type { ReportEntry } from './reportStore'

export interface PublicReport {
  id: string
  created_at: number
  species_id: string | null
  species_name: string | null
  sci: string | null
  question_type: string | null
  media_url: string | null
  reason: string
  suggested_answer: string | null
  note: string | null
  status: string
  up: number
  down: number
}

export interface ReportListResult {
  reports: PublicReport[]
  total: number
}

/** 上传一条报错到后端 */
export async function submitReport(entry: ReportEntry, clientId: string): Promise<void> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: entry.id,
      clientId,
      speciesId: entry.speciesId,
      speciesName: entry.speciesName,
      sci: entry.sci,
      questionType: entry.questionType,
      mediaUrl: entry.mediaUrl,
      reason: entry.reason,
      suggestedAnswer: entry.suggestedAnswer,
      note: entry.note,
    }),
  })
  if (!res.ok) throw new Error(`submit failed: ${res.status}`)
}

/** 公开报错列表（已发布 + 待评审） */
export async function listPublicReports(
  opts: { species?: string; limit?: number; offset?: number } = {},
): Promise<ReportListResult> {
  const q = new URLSearchParams()
  if (opts.species) q.set('species', opts.species)
  q.set('limit', String(opts.limit ?? 20))
  q.set('offset', String(opts.offset ?? 0))
  const res = await fetch(`/api/reports?${q.toString()}`)
  if (!res.ok) throw new Error(`list failed: ${res.status}`)
  return (await res.json()) as ReportListResult
}

/** 投票（+1/-1，可改票） */
export async function voteReport(
  id: string,
  value: 1 | -1,
  clientId: string,
): Promise<{ up: number; down: number; myVote: number }> {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value, clientId }),
  })
  if (!res.ok) throw new Error(`vote failed: ${res.status}`)
  return (await res.json()) as { up: number; down: number; myVote: number }
}

// ---------- B6 管理（需 ADMIN_KEY） ----------

export type ReportStatus = 'open' | 'published' | 'fixed' | 'rejected'

export interface AdminReport extends PublicReport {
  updated_at: number
  client_id: string | null
}

/** 管理密钥无效（401） */
export class AdminAuthError extends Error {
  constructor() {
    super('admin unauthorized')
    this.name = 'AdminAuthError'
  }
}

/** 管理：全部报错（含未公开） */
export async function listAdminReports(
  key: string,
  opts: { status?: ReportStatus | 'all'; limit?: number; offset?: number } = {},
): Promise<AdminReport[]> {
  const q = new URLSearchParams()
  if (opts.status && opts.status !== 'all') q.set('status', opts.status)
  q.set('limit', String(opts.limit ?? 100))
  q.set('offset', String(opts.offset ?? 0))
  const res = await fetch(`/api/reports/admin?${q.toString()}`, {
    headers: { 'x-admin-key': key },
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`admin list failed: ${res.status}`)
  const data = (await res.json()) as { reports: AdminReport[] }
  return data.reports
}

/** 管理：改状态（发布/标记已修正/驳回/转待处理） */
export async function patchReportStatus(
  id: string,
  status: ReportStatus,
  key: string,
): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-admin-key': key },
    body: JSON.stringify({ status }),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`patch failed: ${res.status}`)
}
