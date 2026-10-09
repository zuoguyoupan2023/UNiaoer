/**
 * 035 分享离线补传（2026-10-09，仿 `reportSync`）：创建分享失败时把草稿存本地，
 * 之后（设置页 / 历史页「重试」）逐条补传，成功即写入令牌台账并可撤回。
 *
 * 为什么需要：分享点通常在**结果页**，而那一刻可能是弱网/离线（用户刚从户外回来、
 * 或移动网络抖动）。此前失败只提示"稍后重试"，重试需要重新点一遍——但结果页一旦离开
 * 就回不去了（题目在内存里）。故把**草稿**（payload 本身）落盘，恢复网络后一键补传。
 *
 * 存储：localStorage `uniaoer.shareQueue.v1`（与令牌台账同库；草稿本身是用户要公开的内容，
 * 不含额外隐私）。上限 10 条（每条约 1–20KB，远低于配额）。
 */
import type { ShareDraft } from './shareRound'

const QUEUE_KEY = 'uniaoer.shareQueue.v1'
const QUEUE_MAX = 10

export interface QueuedShare {
  /** 本地队列 id（本地生成；补传成功后移除） */
  id: string
  /** 轮次 id（供历史页展示"待补传"标记） */
  roundId: string
  /** 创建时间 */
  at: number
  /** 完整草稿（补传时原样 POST /api/shares） */
  draft: ShareDraft
}

function readQueue(): QueuedShare[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as QueuedShare[]) : []
  } catch {
    return []
  }
}

function writeQueue(list: QueuedShare[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list))
  } catch {
    /* 配额/隐私模式：放弃入队（调用方仍会提示失败） */
  }
}

/** 入队一条待补传草稿（同轮替换旧条目，避免重复堆叠） */
export function enqueueShare(draft: ShareDraft, roundId: string): void {
  const list = readQueue().filter((e) => e.roundId !== roundId)
  list.unshift({
    id: `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roundId,
    at: Date.now(),
    draft,
  })
  writeQueue(list.slice(0, QUEUE_MAX))
}

/** 全部待补传（新→旧） */
export function listQueuedShares(): QueuedShare[] {
  return readQueue()
}

export function pendingShareCount(): number {
  return readQueue().length
}

/** 某轮是否有待补传草稿 */
export function queuedShareOfRound(roundId: string): QueuedShare | undefined {
  return readQueue().find((e) => e.roundId === roundId)
}

/** 移除一条（补传成功 / 用户放弃） */
export function removeQueuedShare(id: string): void {
  writeQueue(readQueue().filter((e) => e.id !== id))
}

export function clearShareQueue(): void {
  writeQueue([])
}

/** 测试用：清空队列 */
export function _resetShareQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* 忽略 */
  }
}
