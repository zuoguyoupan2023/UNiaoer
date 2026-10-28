/**
 * 064 个人数据备份导出/导入（2026-10-29 用户定：**导出 = 全部个人数据**）。
 *
 * 文件 = 档案全量（v2 格式：轮次/错题/徽章/昵称）+ 全部报错 + 服务端签发的
 * 归户验证码（claimToken）。令牌明文只存在这份文件里，服务端只存其 SHA-256；
 * 未来账号体系接入后，用户凭令牌**一次性**验证「这些报错归该账号」（docs/095）。
 * 导入走本地文件，不需要联网；同时兼容旧的两类单域文件（纯档案备份 / 纯报错备份）。
 */
import type { BackupFileV2 } from './historyDb'
import type { ReportEntry, ReportReason } from './reportStore'

export interface FullBackup {
  app: 'uniaoer'
  kind: 'full-backup'
  version: 1
  exportedAt: number
  /** 归户验证码（离线导出/签发失败时缺省） */
  claimToken?: string
  /** 档案全量（historyDb v2 备份，scope=all），供 historyDb.importBackup 直接恢复 */
  archives: BackupFileV2
  reports: ReportEntry[]
}

/** 兼容期：纯报错备份（064 第一版；读取方仍接受） */
export interface ReportsBackup {
  app: 'uniaoer'
  kind: 'reports-backup'
  version: 1
  exportedAt: number
  claimToken?: string
  reports: ReportEntry[]
}

const REASONS: readonly ReportReason[] = ['image', 'audio', 'answer', 'quality', 'other']

function cap(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s.slice(0, max) : undefined
}

/** 全量备份结构校验（设置页导入入口用） */
export function isFullBackup(v: unknown): v is FullBackup {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.app === 'uniaoer' && o.kind === 'full-backup' && o.version === 1 && Array.isArray(o.reports)
}

/** 兼容期：纯报错备份结构校验 */
export function isReportsBackup(v: unknown): v is ReportsBackup {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.app === 'uniaoer' && o.kind === 'reports-backup' && o.version === 1 && Array.isArray(o.reports)
}

/**
 * 导入条目白名单清洗（文件可能来自任何地方）：逐字段裁剪长度、
 * 枚举校验，不认识的字段丢弃。返回 null = 该条不可用。
 */
export function sanitizeImportedReport(raw: unknown): ReportEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = cap(o.id, 64)
  const reason = REASONS.includes(o.reason as ReportReason) ? (o.reason as ReportReason) : null
  if (!id || !reason) return null
  const questionType = o.questionType === 'audio' ? 'audio' : 'image'
  return {
    id,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
    speciesId: cap(o.speciesId, 120) ?? '',
    speciesName: cap(o.speciesName, 120) ?? '',
    sci: cap(o.sci, 160) ?? '',
    questionType,
    mediaUrl: cap(o.mediaUrl, 600) ?? '',
    reason,
    suggestedAnswer: cap(o.suggestedAnswer, 120),
    note: cap(o.note, 1000),
    nickname: cap(o.nickname, 24),
    synced: o.synced === true,
  }
}

/** 导出文件名（按日期） */
export function fullBackupFilename(at = Date.now()): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `uniaoer-backup-full-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
}
