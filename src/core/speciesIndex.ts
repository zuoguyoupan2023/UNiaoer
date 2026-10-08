/**
 * 023 P0/P1:全球物种骨架(species-index.json)与全球区系(species-distribution.json)的前端消费层。
 * 两者均为按需加载的注册表/大文件(不进 manifest);加载失败返回 null,调用方降级(025 §3)。
 * slug 约定:manifest 1299 的 id 全部等于 slug(学名)(2026-10-03 实测 0 差异),
 * 因此 /species/:slug 可统一解析:先 manifest,未命中回退骨架 → 轻量详情(025 §4)。
 */
export interface SpeciesIndexEntry {
  taxonKey: string
  nameSci: string
  order: string
  family: string
  nameEn?: string
  nameZh?: string
  ebirdCode?: string
  extinct?: boolean
  backboneTaxonId?: number
  inatTaxonId?: number
}

export interface SpeciesIndexData {
  schemaVersion: number
  checklistVersion: string
  species: SpeciesIndexEntry[]
}

export interface SpeciesIndex {
  /** slug(学名) → 条目(路由回退用) */
  bySlug: Map<string, SpeciesIndexEntry>
  /** AviList 短码(AvibaseID 去 avibase- 前缀)→ 条目(/region 网格用) */
  byShortCode: Map<string, SpeciesIndexEntry>
}

export interface SpeciesDistribution {
  byCountry: Record<string, string[]>
}

/** 学名 → slug(与 scripts/lib/util.mjs slug 同规则;manifest id 同源) */
export function slugifySci(nameSci: string): string {
  return String(nameSci || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** AviList 短码 = AvibaseID 去 'avibase-' 前缀(与构建端 distribution-global-lib 约定一致) */
export function shortCodeOf(taxonKey: string): string {
  return String(taxonKey || '').replace(/^avibase-/, '')
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

let indexCache: SpeciesIndex | null = null
let indexPromise: Promise<SpeciesIndex | null> | null = null

/** 加载骨架(模块级缓存;失败返回 null,调用方降级) */
export function loadSpeciesIndex(): Promise<SpeciesIndex | null> {
  if (indexCache) return Promise.resolve(indexCache)
  if (!indexPromise) {
    indexPromise = fetchJson<SpeciesIndexData>(`${import.meta.env.BASE_URL}data/species-index.json`).then((data) => {
      indexCache = null
      if (!data?.species?.length) return null
      const bySlug = new Map<string, SpeciesIndexEntry>()
      const byShortCode = new Map<string, SpeciesIndexEntry>()
      for (const e of data.species) {
        bySlug.set(slugifySci(e.nameSci), e)
        byShortCode.set(shortCodeOf(e.taxonKey), e)
      }
      indexCache = { bySlug, byShortCode }
      return indexCache
    })
  }
  return indexPromise
}

let distCache: SpeciesDistribution | null = null
let distPromise: Promise<SpeciesDistribution | null> | null = null

/** 加载全球区系(模块级缓存;失败返回 null,调用方降级为 bank 视图) */
export function loadSpeciesDistribution(): Promise<SpeciesDistribution | null> {
  if (distCache) return Promise.resolve(distCache)
  if (!distPromise) {
    distPromise = fetchJson<SpeciesDistribution>(`${import.meta.env.BASE_URL}data/species-distribution.json`).then(
      (data) => {
        distCache = data?.byCountry ? data : null
        return distCache
      },
    )
  }
  return distPromise
}

/** 物种在国家列表中的展示名:中文名优先,其次英文名,最后学名 */
export function entryDisplayName(e: SpeciesIndexEntry, locale: string): string {
  if (locale.startsWith('zh')) return e.nameZh || e.nameEn || e.nameSci
  return e.nameEn || e.nameSci
}

/** 测试用:清空骨架与区系缓存 */
export function _resetSpeciesIndexCaches() {
  indexCache = null
  indexPromise = null
  distCache = null
  distPromise = null
}
