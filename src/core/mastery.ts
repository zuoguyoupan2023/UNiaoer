/**
 * 预习熟记状态（观鸟页「预习模式」的灯泡标记）。
 *
 * - 键 = 物种 id（与 bank/骨架 slug 一致），全局生效（跨地区、跨会话）；
 * - 只存「已熟记」集合：未熟记 = 不在集合里（新物种天然是未熟记，无需迁移）；
 * - localStorage 持久化（隐私模式/配额失败时退化为会话内存，不抛错）。
 */

const KEY = 'birding.mastery.v1'

let mastered: Set<string> | null = null

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function ensure(): Set<string> {
  if (mastered) return mastered
  mastered = new Set()
  const raw = store()?.getItem(KEY)
  if (raw) {
    try {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (const v of arr) if (typeof v === 'string') mastered.add(v)
      }
    } catch {
      // 解析失败回退空集合（视为全部未熟记），下次写入覆盖坏数据
    }
  }
  return mastered
}

function persist(): void {
  try {
    store()?.setItem(KEY, JSON.stringify([...ensure()]))
  } catch {
    // 配额满/隐私模式：静默降级为会话内状态
  }
}

/** 该物种是否已熟记 */
export function isMastered(id: string | null | undefined): boolean {
  return !!id && ensure().has(id)
}

/** 已熟记物种数 */
export function masteredCount(): number {
  return ensure().size
}

/** 切换熟记状态，返回切换后的状态（true=已熟记） */
export function toggleMastered(id: string): boolean {
  const set = ensure()
  if (set.has(id)) {
    set.delete(id)
    persist()
    return false
  }
  set.add(id)
  persist()
  return true
}

/** 测试用：清空状态（与其他 core 模块的 _reset 惯例一致） */
export function _resetMastery(): void {
  mastered = null
  try {
    store()?.removeItem(KEY)
  } catch {
    // ignore
  }
}
