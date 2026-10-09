/**
 * 035 分享离线补传：把本地待补传草稿逐条创建为分享（成功 → 记令牌台账 + 出队）。
 * 离线时静默失败（保留 pending，下次再试）。仿 `reportSync` 的语义与调用方式。
 */
import { createShare, rememberShare } from './shareRound'
import { listQueuedShares, removeQueuedShare } from './shareQueue'

export interface ShareSyncResult {
  synced: number
  failed: number
  /** 补传成功的分享 id（供 UI 提示可撤回） */
  ids: string[]
}

export async function syncPendingShares(): Promise<ShareSyncResult> {
  const queued = listQueuedShares()
  let synced = 0
  let failed = 0
  const ids: string[] = []
  for (const q of queued) {
    try {
      const { id, token } = await createShare(q.draft)
      rememberShare({ roundId: q.roundId, shareId: id, token, at: Date.now() })
      removeQueuedShare(q.id)
      synced++
      ids.push(id)
    } catch {
      failed++
    }
  }
  return { synced, failed, ids }
}
