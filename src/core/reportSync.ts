/**
 * B6 报错补传：把本地未同步的报错逐条上传到后端。
 * 离线时静默失败（保留 pending，下次再试）。
 */
import { listPendingReports, markReportSynced } from './reportStore'
import { submitReport } from './reportsApi'
import { getClientId } from './anonymousId'

export interface SyncResult {
  synced: number
  failed: number
}

export async function syncPendingReports(): Promise<SyncResult> {
  const pending = await listPendingReports()
  const cid = getClientId()
  let synced = 0
  let failed = 0
  for (const r of pending) {
    try {
      await submitReport(r, cid)
      await markReportSynced(r.id)
      synced++
    } catch {
      failed++
    }
  }
  return { synced, failed }
}
