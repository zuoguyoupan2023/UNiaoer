/**
 * S6：地区池（懒加载 + 地区过滤）——**唯一名单源 = 权威层 `manifest-meta.json`**。
 *
 * 历史：029 M2 的「全球池」是一份独立的 `manifest-global.min.json`（9,545 种），
 * 与 core（1,299）拼接使用。S6 起名单统一到 meta（10,844 种，不再拼接），
 * 本模块退化为**在 meta 上做地区过滤**的薄封装（导出名保留以兼容调用方）。
 *
 * 数据来源：
 *   · 名单/可玩标记 —— `manifest-meta.json`（见 meta.ts）
 *   · 国家区系 —— `species-distribution.json`（按国短码，249 个国家/地区码）
 */
import type { BankSpecies } from './bank'
import { loadMeta, _resetMetaCache } from './meta'
import { loadSpeciesDistribution, shortCodeOf } from './speciesIndex'
import { countriesOfContinent, isContinentCode } from './region'

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
 *
 * ⚠️ 这是**单国家**的技术归一（港澳台省码会返回 `CN`）。要取"该地区实际可用区系"，
 * 请用 `floraCountriesOf`——它处理港澳台的并集语义（2026-10-29 用户定）。
 */
export function countryOfRegion(region: string): string {
  const v = String(region || '').trim().toUpperCase()
  if (!v || v === 'ALL') return 'ALL'
  return v.includes('-') ? (v.split('-')[0] ?? v) : v
}

/**
 * 港澳台省码 → 各自的国家码。
 * 与 `core/region.ts` 的 `SUBREGION_OF_CN` 同一批码，但这里要**具体映射值**，
 * 故独立维护（region.ts 只给 Set 判断，且引过来会造成循环依赖）。
 */
const CN_SUBREGION_CC: Record<string, string> = {
  'CN-71': 'TW',
  'CN-91': 'HK',
  'CN-92': 'MO',
}
const CN_MAINLAND = 'CN'

/**
 * 地区键 → 区系层要**求并集**的国家码列表（2026-10-29 用户定：中国包含港澳台）。
 *
 * 语义（对应文档 docs/097 §6-P0-B）：
 *   · `CN`（国家级选择「中国」）→ `CN ∪ TW ∪ HK ∪ MO`
 *     ——"中国的鸟"必须包含港澳台特有分布种（台湾 90 种、香港 27 种、澳门 2 种不在大陆清单里）；
 *   · `CN-71 / CN-91 / CN-92`（港澳台省级条目）→ **各自区系 ∪ CN**
 *     ——它们是中国的鸟，用并集既不丢独有种，也不会引入外地鸟；
 *     若只用本国区系，会误杀"有省记录但国家区系因 n<2 地板漏掉"的真实分布种（香港 10 种）；
 *   · 内地各省码（`CN-11` 等）→ 仅 `CN`（内地省份不该混入台湾特有种）；
 *   · 其他国家/省码（`US` / `US-CA` / `JP`）→ 单国，行为与 036 一致；
 *   · `ALL` / 空 → `null`（不做区系过滤）。
 */
export function floraCountriesOf(region: string): string[] | null {
  const v = String(region || '').trim().toUpperCase()
  if (!v || v === 'ALL') return null
  if (v === CN_MAINLAND) return [CN_MAINLAND, ...Object.values(CN_SUBREGION_CC)]
  const sub = CN_SUBREGION_CC[v]
  if (sub) return [CN_MAINLAND, sub]
  return [countryOfRegion(v)]
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
  // 088 方案 B：洲码 → 成员国区系**求并集**（L5+ 的出题地区是大洲）
  // 097 P0-B：港澳台按 `floraCountriesOf` 的并集语义（中国 = 大陆+港澳台）
  const set = new Set<string>()
  if (isContinentCode(region)) {
    for (const cc of countriesOfContinent(region)) {
      const list = dist.byCountry[cc]
      if (Array.isArray(list)) for (const c of list) set.add(c)
    }
  } else {
    for (const cc of floraCountriesOf(region) ?? []) {
      const codes = dist.byCountry[cc]
      if (Array.isArray(codes)) for (const c of codes) set.add(c)
    }
  }
  const subset = pool.filter((sp) => sp.taxonKey && set.has(shortCodeOf(sp.taxonKey)))
  regionalCache.set(region, subset)
  return subset
}

/** 某物种是否出现在某国（或省码所属国）的区系里（区系数据缺失时返回 null = 未知） */
export async function speciesInRegion(taxonKey: string | undefined, region: string): Promise<boolean | null> {
  if (!taxonKey) return null
  if (!region || region === 'ALL') return true
  const dist = await loadSpeciesDistribution()
  // 097 P0-B：与 loadRegionalPool 同一套并集语义（中国 = 大陆+港澳台）
  const ccs = floraCountriesOf(region)
  if (!ccs) return true
  const code = shortCodeOf(taxonKey)
  let known = false
  for (const cc of ccs) {
    const codes = dist?.byCountry?.[cc]
    if (!Array.isArray(codes)) continue
    known = true
    if (codes.includes(code)) return true
  }
  return known ? false : null
}

/** 测试用：清空缓存 */
export function _resetGlobalPoolCache() {
  poolCache = null
  poolPromise = null
  regionalCache.clear()
  _resetMetaCache()
}
