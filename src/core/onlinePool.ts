/**
 * 029 M4:B5 在线出题（在线优先、离线回退核心库）。
 *
 * 分工（D-029-4 拍板）：
 *   · 在线：`/api/questions` 由 D1（派生读模型）按档位/题型/地区出**候选物种 + 名字候选**
 *     → 前端用 questionEngine 本地组装题面（选项/干扰项/限时全在前端,行为与离线完全一致）
 *   · 离线/接口不可用：回退核心库 + 分层全球池（M2 的 mergedSpecies），功能不降级
 *
 * 为什么不返回完整题目：选项生成需要「同科近缘」等策略与当前语言,前端已有完备实现；
 * 只取候选可显著缩小响应体积（约 20-40KB/轮），且选项策略随前端版本演进无需改后端。
 */
import type { BankSpecies } from './bank'
import type { MediaType, Tier } from '@/types'

export interface OnlinePoolResult {
  /** 目标候选（带完整素材,已按档位/题型/地区/可玩过滤） */
  species: BankSpecies[]
  /** 干扰项名字候选（无素材,仅选项用） */
  distractors: BankSpecies[]
}

const TIMEOUT_MS = 8000

/** 组装 API URL（与本地出题同参:档位/题型/地区） */
function questionsUrl(type: MediaType, tier: Tier, region: string, count: number): string {
  const q = new URLSearchParams({
    tier: String(tier),
    type,
    count: String(Math.max(count, 10)),
  })
  if (region && region !== 'ALL' && tier <= 3) q.set('region', region)
  return `/api/questions?${q.toString()}`
}

/**
 * 拉取在线候选池。任何失败（网络/超时/格式/空结果）返回 null，
 * 调用方回退本地池（离线能力不降级）。
 */
export async function fetchOnlinePool(
  type: MediaType,
  tier: Tier,
  region: string,
  count: number,
): Promise<OnlinePoolResult | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(questionsUrl(type, tier, region, count), { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = (await res.json()) as {
      species?: unknown
      distractors?: unknown
    }
    const list = Array.isArray(data.species) ? (data.species as BankSpecies[]) : []
    // 目标种必须带对应素材,否则此题无法作答
    const usable = list.filter((sp) =>
      type === 'audio' ? !!sp.audio || !!sp.audios?.length : !!sp.image || !!sp.images?.length,
    )
    if (!usable.length) return null
    const distractors = Array.isArray(data.distractors) ? (data.distractors as BankSpecies[]) : []
    return { species: usable, distractors }
  } catch {
    return null
  }
}
