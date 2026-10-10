/**
 * S6：地区池（懒加载 + 地区过滤）——**唯一名单源 = 权威层 `manifest-meta.json`**。
 *
 * 历史：029 M2 的「全球池」是一份独立的 `manifest-global.min.json`（9,545 种），
 * 与 core（1,299）拼接使用。S6 起名单统一到 meta（10,844 种，不再拼接），
 * 本模块退化为**在 meta 上做地区过滤**的薄封装（导出名保留以兼容调用方）。
 *
 * 数据来源：
 *   · 名单/可玩标记 —— `manifest-meta.json`（见 meta.ts）
 *   · 国家区系 —— `species-distribution.json`（按国短码，249 国）
 */
import type { BankSpecies } from './bank'
import { loadMeta, _resetMetaCache } from './meta'
import { loadSpeciesDistribution, shortCodeOf } from './speciesIndex'

let poolCache: BankSpecies[] | null = null
let poolPromise: Promise<BankSpecies[] | null> | null = null
const regionalCache = new Map<string, BankSpecies[]>()

/** 懒加载全量名单（= meta；并发去重；失败返回 null，调用方回退核心库） */
export function loadGlobalPool(): Promise<BankSpecies[] | null> {
  if (poolCache) return Promise.resolve(poolCache)
  if (!poolPromise) {
    poolPromise = (async () => {
      try {
        const meta = await loadMeta()
        poolCache = meta?.species ? (meta.species as unknown as BankSpecies[]) : null
        return poolCache
      } catch {
        return null
      }
    })()
  }
  return poolPromise
}

/** 已加载的全量名单（未加载返回 null；供同步路径使用） */
export function globalPoolReady(): BankSpecies[] | null {
  return poolCache
}

/**
 * 地区键 → 区系层用的**国家码**。
 * 036：出题地区支持省码（如 `CN-11`），但「该地区有哪些鸟」的区系层是**国家级**数据，
 * 故取省码前两位（`CN-11` → `CN`）。语义分工：
 *   · 区系层（有没有这种鸟）→ 国家码；
 *   · 地区档位（这种鸟多常见）→ 省码（见 provinceCommonness.ts）。
 * 不归一化的话，省码查 `byCountry['CN-11']` 得到空集 → 会被清空、题池骤减。
 */
export function countryOfRegion(region: string): string {
  const v = String(region || '').trim().toUpperCase()
  if (!v || v === 'ALL') return 'ALL'
  return v.includes('-') ? (v.split('-')[0] ?? v) : v
}

/**
 * 按地区（ISO 3166-1 alpha-2 国家码，或 `XX-NN` 省码；'ALL'=不过滤）取名单子集。
 * - 省码按**国家**过滤（区系数据是国家级的，见 countryOfRegion）；
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
  const codes = dist.byCountry[countryOfRegion(region)]
  const set = new Set(Array.isArray(codes) ? codes : [])
  const subset = pool.filter((sp) => sp.taxonKey && set.has(shortCodeOf(sp.taxonKey)))
  regionalCache.set(region, subset)
  return subset
}

/** 某物种是否出现在某国（或省码所属国）的区系里（区系数据缺失时返回 null = 未知） */
export async function speciesInRegion(taxonKey: string | undefined, region: string): Promise<boolean | null> {
  if (!taxonKey) return null
  if (!region || region === 'ALL') return true
  const dist = await loadSpeciesDistribution()
  // 省码 → 所属国（区系层是国家级的；见 countryOfRegion）
  const codes = dist?.byCountry?.[countryOfRegion(region)]
  if (!Array.isArray(codes)) return null
  return codes.includes(shortCodeOf(taxonKey))
}

/** 测试用：清空缓存 */
export function _resetGlobalPoolCache() {
  poolCache = null
  poolPromise = null
  regionalCache.clear()
  _resetMetaCache()
}
