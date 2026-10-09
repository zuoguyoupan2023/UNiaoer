/**
 * 035 分享离线补传：队列读写（同轮替换、上限）与补传流程（成功出队 + 记令牌台账）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetShareLedger, shareOfRound } from '../shareRound'
import type { ShareDraft } from '../shareRound'
import {
  _resetShareQueue,
  enqueueShare,
  listQueuedShares,
  pendingShareCount,
  queuedShareOfRound,
  removeQueuedShare,
} from '../shareQueue'
import { syncPendingShares } from '../shareSync'

const draft = (n: number): ShareDraft => ({
  clientId: 'client-1234',
  mode: 'image',
  tier: 2,
  total: 1,
  correct: 1,
  locale: 'zh-CN',
  nickname: null,
  items: [
    {
      answer: `鸟${n}`,
      type: 'image',
      correct: true,
      timedOut: false,
      mediaUrl: 'https://bird.wewalk.world/media/x/image.webp',
    },
  ],
})

describe('shareQueue（本地待补传）', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetShareQueue()
    _resetShareLedger()
  })

  it('入队/读取/计数/按轮查询', () => {
    enqueueShare(draft(1), 'round-a')
    enqueueShare(draft(2), 'round-b')
    expect(pendingShareCount()).toBe(2)
    expect(queuedShareOfRound('round-a')?.draft.items[0]!.answer).toBe('鸟1')
    expect(listQueuedShares()[0]!.roundId).toBe('round-b') // 新→旧
  })

  it('同一轮重复入队 → 替换（不堆叠）', () => {
    enqueueShare(draft(1), 'round-a')
    enqueueShare(draft(9), 'round-a')
    expect(pendingShareCount()).toBe(1)
    expect(queuedShareOfRound('round-a')?.draft.items[0]!.answer).toBe('鸟9')
  })

  it('removeQueuedShare 出队', () => {
    enqueueShare(draft(1), 'round-a')
    const id = listQueuedShares()[0]!.id
    removeQueuedShare(id)
    expect(pendingShareCount()).toBe(0)
  })
})

describe('syncPendingShares（补传）', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetShareQueue()
    _resetShareLedger()
  })

  it('成功 → 出队并写入令牌台账（可撤回）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'AbCd1234EfGh', token: 'tok' }), { status: 201 })),
    )
    enqueueShare(draft(1), 'round-x')
    const r = await syncPendingShares()
    expect(r).toMatchObject({ synced: 1, failed: 0, ids: ['AbCd1234EfGh'] })
    expect(pendingShareCount()).toBe(0)
    expect(shareOfRound('round-x')?.shareId).toBe('AbCd1234EfGh')
  })

  it('失败 → 保留在队列（下次再试）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    enqueueShare(draft(1), 'round-x')
    const r = await syncPendingShares()
    expect(r).toMatchObject({ synced: 0, failed: 1 })
    expect(pendingShareCount()).toBe(1)
  })
})
