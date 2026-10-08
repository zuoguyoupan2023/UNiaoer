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

/**
 * 029 M3:质量隔离——把该报错涉及的素材加入隔离台账（管理方判定）。
 * 生效链路：隔离 → npm run quality:export → 下次构建把它映射进 excludeUrls →
 * 有替补换替补，无替补则该物种 quizExcluded（仅展示、不进题库）。
 */
export async function quarantineReportMedia(
  id: string,
  key: string,
  opts: { speciesId?: string; mediaType?: string; mediaUrl?: string; note?: string } = {},
): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-admin-key': key },
    body: JSON.stringify({ action: 'quarantine', ...opts }),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`quarantine failed: ${res.status}`)
}

/** 隔离台账（管理端读取；含已复原项） */
export interface QuarantineItem {
  media_key: string
  species_id: string
  media_type: string
  media_url: string
  report_id: string | null
  note: string | null
  created_at: number
  resolved_at: number | null
}

export async function listQuarantine(key: string): Promise<QuarantineItem[]> {
  const res = await fetch('/api/quarantine', { headers: { 'x-admin-key': key } })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`quarantine list failed: ${res.status}`)
  const data = (await res.json()) as { items?: QuarantineItem[] }
  return data.items ?? []
}

/** 解除隔离（素材已修复/替换） */
export async function unquarantine(key: string, mediaKey: string, reportId = 'manual'): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-admin-key': key },
    body: JSON.stringify({ action: 'unquarantine', mediaKey }),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`unquarantine failed: ${res.status}`)
}
