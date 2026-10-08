/**
 * 029 M2:全球题库池（懒加载 + 地区过滤）。
 *
 * 数据来源：`public/data/manifest-global.min.json`（core 同构条目，1 图 1 音/种，懒加载）
 * 与国家区系 `species-distribution.json`（按国短码，249 国）。
 *
 * 策略（D-029-2，用户 2026-10-08 拍板）：
 *   - L1–L3：按用户「地区」过滤（地区包，服务通勤/周末画像）
 *   - L4–L5：全球开放（服务资深画像）
 *   - 「随机全球」全量开放留待 028 计量数据后评估
 *
 * 池加载是 10.7MB 的懒加载（gzip ~1.3MB，SW/HTTP 缓存后一次性成本），
 * 只在需要时触发；加载完成前答题可照常用核心 1299 种。
 */
import type { BankSpecies } from './bank'
import { loadSpeciesDistribution, shortCodeOf } from './speciesIndex'

let poolCache: BankSpecies[] | null = null
let poolPromise: Promise<BankSpecies[] | null> | null = null
const regionalCache = new Map<string, BankSpecies[]>()

/** 懒加载全球池（并发去重；失败返回 null，调用方回退核心库） */
export function loadGlobalPool(): Promise<BankSpecies[] | null> {
  if (poolCache) return Promise.resolve(poolCache)
  if (!poolPromise) {
    poolPromise = (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/manifest-global.min.json`)
        if (!res.ok) return null
        const data = (await res.json()) as { species?: BankSpecies[] }
        poolCache = Array.isArray(data.species) ? data.species : null
        return poolCache
      } catch {
        return null
      }
    })()
  }
  return poolPromise
}

/** 已加载的全球池（未加载返回 null；供同步路径使用） */
export function globalPoolReady(): BankSpecies[] | null {
  return poolCache
}

/**
 * 按地区（ISO 3166-1 alpha-2；'ALL'=不过滤）取全球池子集。
 * - 区系数据**加载失败**（离线/未部署）→ 返回 null，调用方按「无地区过滤」降级；
 * - 区系数据**存在但该地区无记录** → 返回空数组（用户选了没数据的地区，应得空池而非全量）。
 */
export async function loadRegionalPool(region: string): Promise<BankSpecies[] | null> {
  const pool = await loadGlobalPool()
  if (!pool) return null
  if (!region || region === 'ALL') return pool
  const hit = regionalCache.get(region)
  if (hit) return hit
  const dist = await loadSpeciesDistribution()
  if (!dist?.byCountry) return null // 区系层不可用:降级为不过滤
  const codes = dist.byCountry[region]
  const set = new Set(Array.isArray(codes) ? codes : [])
  const subset = pool.filter((sp) => sp.taxonKey && set.has(shortCodeOf(sp.taxonKey)))
  regionalCache.set(region, subset)
  return subset
}

/** 某物种是否出现在某国的区系里（区系数据缺失时返回 null = 未知） */
export async function speciesInRegion(taxonKey: string | undefined, region: string): Promise<boolean | null> {
  if (!taxonKey) return null
  if (!region || region === 'ALL') return true
  const dist = await loadSpeciesDistribution()
  const codes = dist?.byCountry?.[region]
  if (!Array.isArray(codes)) return null
  return codes.includes(shortCodeOf(taxonKey))
}

/** 测试用：清空缓存 */
export function _resetGlobalPoolCache() {
  poolCache = null
  poolPromise = null
  regionalCache.clear()
}
