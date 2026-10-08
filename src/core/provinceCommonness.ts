/**
 * 036：省级地区常见度（`public/data/province-commonness.json` + 分片）——前端消费层。
 *
 * 用途：L1–L3 出题时，把"全球 commonness"换成"**该省**的相对频率档位"
 * （同一只鸟，在北京是天天见、在某县是罕见旅鸟——docs/036 §1.1）。
 *
 * 产物形态（构建期由 scripts/region/build-province-commonness.mjs 生成）：
 *   索引 `province-commonness.json`        —— 元数据 + sharding 清单（不含 tiers）
 *   分片 `province-commonness/CN.json`     —— { country, level:'province', tiers: {speciesId: tier} }
 *   降级 `province-commonness/CN.country.json` —— 国家级档位（省级不可信时用）
 *
 * 降级链（**绝不出空池**，docs/036 §2.3）：
 *   省档位 → 国家档位 → 全局 commonness（调用方现有逻辑）
 * 分片按国家懒加载并缓存；加载失败静默返回 null（调用方回退全局档位）。
 */
import type { BankSpecies } from './bank'
import type { Tier } from '@/types'

export interface RegionCommonnessIndex {
  schemaVersion: number
  generatedAt: string
  method: string
  scope: { countries: string[]; levels: string[] }
  guards: Record<string, number>
  coverage: { species: number; provinceCodes: number; pairs: number; countryPairs: number }
  sharding?: { dir: string; files: string[]; maxBytes: number; totalBytes: number }
}

/** 分片：物种 id → 档位（1 最常见 … 5 稀有） */
export interface RegionCommonnessShard {
  schemaVersion: number
  country: string
  level: 'province' | 'country'
  generatedAt: string
  /** 国家级：物种 id → 档位 */
  tiers?: Record<string, number>
  /** 省级：省码 → { 物种 id → 档位 }（必须保留省码层，勿压平） */
  tiersByCode?: Record<string, Record<string, number>>
}

const BASE = `${import.meta.env.BASE_URL}data/province-commonness`
let indexCache: Promise<RegionCommonnessIndex | null> | null = null
const shardCache = new Map<string, Promise<RegionCommonnessShard | null>>()

/** 加载索引（失败 → null，不阻塞；调用方回退全局档位） */
export function loadRegionCommonnessIndex(): Promise<RegionCommonnessIndex | null> {
  indexCache ??= fetch(`${BASE}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<RegionCommonnessIndex>) : null))
    .catch(() => null)
  return indexCache
}

/** 加载某国分片（level: province | country）；失败 → null */
export function loadRegionCommonnessShard(
  cc: string,
  level: 'province' | 'country' = 'province',
): Promise<RegionCommonnessShard | null> {
  const key = `${cc}:${level}`
  let p = shardCache.get(key)
  if (!p) {
    const file = level === 'province' ? `${cc}.json` : `${cc}.country.json`
    p = fetch(`${BASE}/${file}`)
      .then((r) => (r.ok ? (r.json() as Promise<RegionCommonnessShard>) : null))
      .catch(() => null)
    shardCache.set(key, p)
  }
  return p
}

/**
 * 地区键（`region` 设置值）→ { cc, code }。
 * 支持两种形态：国家码 `CN`（无省级细分）与省码 `CN-11`（省级）。
 */
export function parseRegionKey(region: string): { cc: string; code: string | null } | null {
  const v = String(region || '').trim().toUpperCase()
  if (!v || v === 'ALL') return null
  const m = v.match(/^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/)
  if (!m) return null
  // code 返回**完整省码**（如 CN-11 而非 11）——产物分片的键就是完整省码，
  // 保持与 ISO 3166-2 一致，避免调用方各处自行拼接。
  return { cc: m[1]!, code: m[2] ? `${m[1]}-${m[2]}` : null }
}

/**
 * 取"该地区适用的档位表"：优先省级，无则国家级。
 * @returns Map<speciesId, tier>；两者都不可用 → null（调用方回退全局 commonness）
 */
export async function regionTierMap(
  region: string,
): Promise<{ tiers: Map<string, number>; level: 'province' | 'country' } | null> {
  const parsed = parseRegionKey(region)
  if (!parsed) return null
  const { cc, code } = parsed
  if (code) {
    const shard = await loadRegionCommonnessShard(cc, 'province')
    // 省级分片按国组织、内含该国各省：tiersByCode[省码] = { 物种id: 档位 }
    const map = shard?.tiersByCode?.[code]
    if (map) return { tiers: new Map(Object.entries(map)), level: 'province' }
  }
  const countryShard = await loadRegionCommonnessShard(cc, 'country')
  if (countryShard?.tiers) return { tiers: new Map(Object.entries(countryShard.tiers)), level: 'country' }
  return null
}

/**
 * 用地区档位筛物种（若可用），否则返回原列表（**绝不出空**）。
 *
 * 与 `TIERS[tier].commonness` 的语义一致：保留档位落在 `allowed` 内的物种；
 * 若筛完不足 `min` 个，则放宽为"档位 ≤ 允许上限"（避免某省 1 档物种太少导致题目不足）。
 */
export function filterByRegionTier(
  species: BankSpecies[],
  tiers: Map<string, number>,
  allowed: number[],
  min = 4,
): BankSpecies[] {
  if (!tiers.size) return species
  const strict = species.filter((sp) => {
    const t = tiers.get(sp.id)
    return t != null && allowed.includes(t)
  })
  if (strict.length >= min) return strict
  const maxAllowed = Math.max(...allowed)
  const relaxed = species.filter((sp) => {
    const t = tiers.get(sp.id)
    return t != null && t <= maxAllowed
  })
  return relaxed.length ? relaxed : species
}

/** 该物种在该地区的档位（无则 null；供 UI 展示"本地常见度"） */
export function regionTierOf(
  tiers: Map<string, number> | null,
  speciesId: string,
): number | null {
  const t = tiers?.get(speciesId)
  return Number.isInteger(t) ? (t as number) : null
}

/** 档位 → 难度（供 UI 文案；与 difficulty.ts 的档位语义一致：1 = 最常见） */
export function tierLabelKey(tier: number): string {
  return `regionCommonness.tier${Math.min(5, Math.max(1, tier))}`
}

/** 测试用：清空缓存 */
export function _resetRegionCommonnessCache(): void {
  indexCache = null
  shardCache.clear()
}

export type { Tier }
