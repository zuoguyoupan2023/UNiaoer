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
 *
 * ── 030 措施 3：客户端缓存（sessionStorage） ──────────────────────────
 * 每次请求固定要 30 条候选（而非当轮题数），按 `tier:type:region` 缓存 10 分钟：
 *   · 一轮只取 10 条 → **一次请求可覆盖同档位/题型/地区的最多 3 轮**
 *   · 客户端命中 → 零网络（连 Worker 都不打），响应即时
 *   · count 归一为常量 → 也让**边缘缓存**的 key 收敛（不同题量不再各占一份缓存）
 * 用户已明确接受"题目可重复出现"，故复用同一候选池是预期行为。
 */
import type { BankSpecies } from './bank'
import type { MediaType, Tier } from '@/types'

export interface OnlinePoolResult {
  /** 目标候选（带完整素材,已按档位/题型/地区/可玩过滤） */
  species: BankSpecies[]
  /** 干扰项名字候选（无素材,仅选项用） */
  distractors: BankSpecies[]
  /** 来源：client=客户端缓存 / network=网络 / （null 结果表示不可用） */
  from?: 'client' | 'network'
}

const TIMEOUT_MS = 8000
/** 固定请求条数（一次请求覆盖多轮；同时收敛边缘缓存 key） */
const FETCH_COUNT = 30
/** 客户端缓存有效期（10 分钟；大于边缘缓存 300s，命中即零网络） */
const CLIENT_TTL_MS = 10 * 60_000
/**
 * 客户端缓存条目上限（每条约 30-60KB，24 条 ≈ 最多 1.5MB，远低于 sessionStorage 常见配额 5MB）。
 * 组合空间 = 5 档 × 2 题型 × (ALL + 用户切换过的地区数)：
 * 上限过小（曾试 8）会在正常使用中互相淘汰——用户切几次档位/题型就废掉缓存。
 */
const CLIENT_MAX_ENTRIES = 24
/**
 * 客户端缓存前缀。版本变更即整体失效旧条目：
 *   v1 → v2（2026-10-09）：Worker 候选池改为"地区档位过滤"（表外物种不再回退全局
 *   commonness，见 docs/036 §10），旧缓存可能含本地没有的鸟，必须作废。
 */
const CLIENT_PREFIX = 'uniaoer.onlinePool.v2:'

interface CachedPool {
  at: number
  /** 插入序号（单调递增）——同毫秒写入时用它排序淘汰，避免依赖稳定的时间戳 */
  seq: number
  species: BankSpecies[]
  distractors: BankSpecies[]
}

/** 会话内单调递增序号（模块级；刷新页面重置，符合会话缓存语义） */
let seqCounter = 0

/** 缓存键：档位 × 题型 × 地区（不含题量——count 已归一） */
function cacheKeyOf(type: MediaType, tier: Tier, region: string): string {
  const r = region && region !== 'ALL' && tier <= 3 ? region : 'ALL'
  return `${CLIENT_PREFIX}${tier}:${type}:${r}`
}

function readClientCache(key: string): CachedPool | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedPool
    if (!parsed || typeof parsed.at !== 'number' || !Array.isArray(parsed.species)) return null
    if (Date.now() - parsed.at > CLIENT_TTL_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    return parsed
  } catch {
    return null // 隐私模式/配额异常：视为无缓存
  }
}

/** 清理本模块的会话缓存（导出供设置/调试用） */
export function clearClientPoolCache(): void {
  seqCounter = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(CLIENT_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    /* 忽略 */
  }
}

function writeClientCache(key: string, value: CachedPool): void {
  try {
    // 超量时淘汰最旧
    const entries: { k: string; at: number; seq: number }[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (!k || !k.startsWith(CLIENT_PREFIX)) continue
      let at = 0
      let seq = 0
      try {
        const parsed = JSON.parse(sessionStorage.getItem(k) || '{}') as CachedPool
        at = parsed.at ?? 0
        seq = parsed.seq ?? 0
      } catch {
        /* 损坏条目:按最旧处理（seq=0） */
      }
      entries.push({ k, at, seq })
    }
    if (entries.length >= CLIENT_MAX_ENTRIES) {
      // 主序 = seq（插入顺序），次序 = at（兼容旧条目）
      entries.sort((a, b) => a.seq - b.seq || a.at - b.at)
      const drop = entries.length - CLIENT_MAX_ENTRIES + 1
      for (const e of entries.slice(0, drop)) sessionStorage.removeItem(e.k)
    }
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 配额满：清掉自己的缓存再试一次，仍失败则放弃缓存（不影响功能）
    try {
      clearClientPoolCache()
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 放弃缓存 */
    }
  }
}

/** 组装 API URL（与本地出题同参:档位/题型/地区；count 归一为 FETCH_COUNT） */
function questionsUrl(type: MediaType, tier: Tier, region: string): string {
  const q = new URLSearchParams({ tier: String(tier), type, count: String(FETCH_COUNT) })
  if (region && region !== 'ALL' && tier <= 3) q.set('region', region)
  return `/api/questions?${q.toString()}`
}

/**
 * 取在线候选池：客户端缓存 → 网络 → 失败返回 null（调用方回退本地池）。
 * `count` 仅作语义说明（实际统一请求 FETCH_COUNT 条，由调用方按需切片）。
 */
export async function fetchOnlinePool(
  type: MediaType,
  tier: Tier,
  region: string,
): Promise<OnlinePoolResult | null> {
  // ① 客户端缓存（命中即零网络）
  const key = cacheKeyOf(type, tier, region)
  const cached = readClientCache(key)
  if (cached) {
    return { species: cached.species, distractors: cached.distractors, from: 'client' }
  }

  // ② 网络（Worker 侧还有 300s 边缘缓存兜底）
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(questionsUrl(type, tier, region), { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = (await res.json()) as { species?: unknown; distractors?: unknown }
    const list = Array.isArray(data.species) ? (data.species as BankSpecies[]) : []
    // 目标种必须带对应素材,否则此题无法作答
    const usable = list.filter((sp) =>
      type === 'audio' ? !!sp.audio || !!sp.audios?.length : !!sp.image || !!sp.images?.length,
    )
    if (!usable.length) return null
    const distractors = Array.isArray(data.distractors) ? (data.distractors as BankSpecies[]) : []
    writeClientCache(key, { at: Date.now(), seq: ++seqCounter, species: usable, distractors })
    return { species: usable, distractors, from: 'network' }
  } catch {
    return null
  }
}
