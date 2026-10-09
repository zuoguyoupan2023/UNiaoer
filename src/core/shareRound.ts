/**
 * 035 单轮成绩分享：payload 构造 + 后端读写 + 管理令牌本地存储。
 *
 * 设计（D-035-1~6 已拍板，见 docs/035）：
 *   · 公开可访问、永久有效（可撤回）、**默认带上昵称**（可勾选隐藏）、管理令牌撤回；
 *   · payload 只含"该轮题目 + 媒体链接 + 署名"，不含设备信息/其他轮次；
 *   · 服务端白名单校验（长度裁剪 + mediaUrl 必须属于本站媒体域）；
 *   · 管理令牌明文只存本地（localStorage），服务端只存 SHA-256 —— 跨设备凭令牌仍可撤回。
 */
import type { RoundRecord } from './historyDb'

/** 分享单条题目（与服务端 sanitizeShareItem 的字段一一对应） */
export interface ShareItem {
  speciesId?: string | null
  answer: string
  sci?: string | null
  family?: string | null
  type: 'image' | 'audio'
  chosen?: string | null
  chosenId?: string | null
  correct: boolean
  timedOut: boolean
  mediaUrl: string
  thumbUrl?: string | null
  source?: string | null
  author?: string | null
  license?: string | null
}

/** 创建分享的请求体（服务端逐字段校验） */
export interface ShareDraft {
  clientId: string
  mode: 'image' | 'audio'
  tier: number
  total: number
  correct: number
  durationMs?: number | null
  locale: string
  /** null = 用户勾选了「隐藏昵称」（D-035-4 默认带上，可勾选隐藏） */
  nickname: string | null
  items: ShareItem[]
}

/** 公开读取到的分享内容 */
export interface SharePayload {
  v: number
  mode: 'image' | 'audio'
  tier: number
  total: number
  correct: number
  accuracy: number
  durationMs?: number | null
  locale: string
  items: ShareItem[]
}

export interface ShareView {
  id: string
  at: number
  mode: string
  tier: number
  total: number
  correct: number
  accuracy: number
  nickname: string | null
  payload: SharePayload
  /** 2026-10-09：分享页浏览次数（页面加载打点；同会话同一分享只计一次） */
  views?: number
}

/** 分享页 URL（二维码/复制链接都用它） */
export const shareUrlOf = (id: string): string => `${location.origin}/s/${id}`

// ─────────────────────────────────────────────
// payload 构造（纯函数，可单测）
// ─────────────────────────────────────────────

/** 取该题素材的缩略图（图题才有；分享页优先加载小图） */
function thumbOf(mediaUrl: string): string | null {
  // R2 命名约定：image-1.full.webp → image-1.thumb.webp（缩放图）
  return mediaUrl.includes('.full.webp') ? mediaUrl.replace('.full.webp', '.thumb.webp') : null
}

/**
 * 本地一轮记录 → 分享 payload。
 * 缺 mediaUrl 的条目会被丢弃（分享页无法展示素材，等于半条数据）；
 * 丢弃后 total/correct 按**保留的条目**重算，保证分享页数字自洽。
 */
export function buildShareDraft(
  round: RoundRecord,
  opts: { clientId: string; nickname: string | null; locale: string },
): ShareDraft | { error: 'noItems' } {
  const items: ShareItem[] = []
  for (const it of round.items) {
    if (!it.mediaUrl) continue
    items.push({
      speciesId: it.speciesId || null,
      answer: it.answer,
      sci: it.sci || null,
      family: it.family || null,
      type: it.type,
      chosen: it.chosen,
      chosenId: it.chosenId ?? null,
      correct: it.correct,
      timedOut: it.timedOut,
      mediaUrl: it.mediaUrl,
      thumbUrl: it.type === 'image' ? thumbOf(it.mediaUrl) : null,
      source: it.source || null,
      author: it.author || null,
      license: it.license || null,
    })
  }
  if (!items.length) return { error: 'noItems' }
  const correct = items.filter((i) => i.correct).length
  return {
    clientId: opts.clientId,
    mode: round.mode,
    tier: round.tier,
    total: items.length,
    correct,
    durationMs: round.durationMs ?? null,
    locale: opts.locale,
    nickname: opts.nickname,
    items,
  }
}

// ─────────────────────────────────────────────
// 后端读写
// ─────────────────────────────────────────────

/** 创建分享 → 返回 id 与管理令牌（令牌仅此一次下发，须本地保存） */
export async function createShare(draft: ShareDraft): Promise<{ id: string; token: string }> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`share failed: ${res.status} ${detail.slice(0, 120)}`)
  }
  const data = (await res.json()) as { id: string; token: string }
  return { id: data.id, token: data.token }
}

/** 公开读取一条分享（撤回/不存在 → null） */
export async function fetchShare(id: string): Promise<ShareView | null> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`share fetch failed: ${res.status}`)
  const data = (await res.json()) as { share?: ShareView }
  return data.share ?? null
}

/** 撤回（凭管理令牌） */
export async function revokeShare(id: string, token: string): Promise<void> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new Error(`revoke failed: ${res.status}`)
}

// ─────────────────────────────────────────────
// 分享页浏览计数（2026-10-09 启用 view_count）
// ─────────────────────────────────────────────

const VIEWED_KEY = 'uniaoer.shareViewed.v1'

/**
 * 标记并判断"本次会话是否已计过该分享"。
 * 返回 true = 首见（应打点）；sessionStorage 随标签页关闭即清，不会变成跨会话追踪标识。
 */
export function markShareViewed(id: string): boolean {
  try {
    const raw = sessionStorage.getItem(VIEWED_KEY)
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : []
    if (seen.includes(id)) return false
    seen.push(id)
    sessionStorage.setItem(VIEWED_KEY, JSON.stringify(seen.slice(-50)))
    return true
  } catch {
    return true // 隐私模式：去重不可用则仍计（宁可多计一次）
  }
}

/** 打点一次浏览（失败静默——计数绝不影响浏览） */
export async function countShareView(id: string): Promise<void> {
  try {
    await fetch(`/api/shares/${encodeURIComponent(id)}/view`, { method: 'POST' })
  } catch {
    /* 静默 */
  }
}

// ─────────────────────────────────────────────
// 本地台账（分享过哪些轮、对应的管理令牌）
// ─────────────────────────────────────────────

const TOKENS_KEY = 'uniaoer.shareTokens.v1'

export interface ShareLedgerEntry {
  /** 轮次 id（RoundRecord.id） */
  roundId: string
  /** 分享 id */
  shareId: string
  /** 管理令牌（明文；撤回凭据，服务端只存哈希） */
  token: string
  at: number
  revoked?: boolean
}

function readLedger(): ShareLedgerEntry[] {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as ShareLedgerEntry[]) : []
  } catch {
    return []
  }
}

function writeLedger(list: ShareLedgerEntry[]): void {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式/配额异常：令牌不落盘，仅当次会话可用 */
  }
}

/** 记录一次成功分享（供「已分享」标记与撤回入口） */
export function rememberShare(entry: ShareLedgerEntry): void {
  const list = readLedger().filter((e) => e.shareId !== entry.shareId)
  list.unshift(entry)
  writeLedger(list.slice(0, 200))
}

/** 本轮是否已分享（返回最新一条未撤回的记录） */
export function shareOfRound(roundId: string): ShareLedgerEntry | undefined {
  return readLedger().find((e) => e.roundId === roundId && !e.revoked)
}

/** 标记已撤回（保留记录便于提示"已撤回"） */
export function markShareRevoked(shareId: string): void {
  writeLedger(readLedger().map((e) => (e.shareId === shareId ? { ...e, revoked: true } : e)))
}

/** 测试用：清空台账 */
export function _resetShareLedger(): void {
  try {
    localStorage.removeItem(TOKENS_KEY)
  } catch {
    /* 忽略 */
  }
}
