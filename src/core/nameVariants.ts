/**
 * 089 P0-2：L7 中文判分的名字变体字典（`public/data/name-variants.json`，构建期产物）。
 * 懒加载一次、进程内缓存；失败返回空表（判分退化为仅 nameZh，功能不中断）。
 * 条目：`{ tw?: 港台体系名, trad?: nameZh 的繁体字形 }`（与 nameZh 相同的已构建期省略）。
 */
export interface NameVariant {
  tw?: string
  trad?: string
}

let cache: Map<string, NameVariant> | null = null
let loading: Promise<Map<string, NameVariant>> | null = null

/** 学名匹配键：与构建脚本同则（trim + 压空白） */
const sciKey = (s: string) => String(s || '').trim().replace(/\s+/g, ' ')

export function loadNameVariants(): Promise<Map<string, NameVariant>> {
  if (cache) return Promise.resolve(cache)
  if (!loading) {
    loading = (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/name-variants.json`)
        if (!res.ok) throw new Error(String(res.status))
        const doc = (await res.json()) as { bySci?: Record<string, NameVariant> }
        cache = new Map(Object.entries(doc.bySci ?? {}).map(([k, v]) => [sciKey(k), v]))
      } catch {
        cache = new Map() // 离线/产物缺失：退化为仅 nameZh（085 集合的子集，绝不误判对）
      }
      return cache
    })()
  }
  return loading
}

/** 测试用：清空缓存 */
export function _resetNameVariantsCache() {
  cache = null
  loading = null
}

/** 同步取已加载的字典（未加载返回 null——判分退化为仅 nameZh，见 nameMatch.ts） */
export function cachedNameVariants(): Map<string, NameVariant> | null {
  return cache
}
