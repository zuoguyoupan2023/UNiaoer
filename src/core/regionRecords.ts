/**
 * P0-5（Tier A，2026-10-23）：**国家层记录数**——前端消费层。
 *
 * ⚠️ 「国家」= GBIF `countrycode` = **ISO 3166-1 alpha-2 的 249 个码**（含属地与特殊领地，
 * 不是主权国家数：193 个联合国会员国 + 2 个观察员 + 台湾/南极洲 + 约 50 个属地）。
 * 对外表述统一写「国家/地区」。
 *
 * 用途：观鸟页「该地鸟种」网格按**记录数**排序。此前只有省级层覆盖的 29 国能排序
 * （数字来自 `region-provinces`），其余国家/地区一律"没有记录数"。国家层数据一直都在
 * （GBIF「物种 × 国家」SQL 矩阵），只是没被用上（见 docs/075 §6.1）。
 *
 * 产物（`scripts/region/build-country-records.mjs`）：
 *   `data/region-records/index.json`  —— 元数据 + 口径 + 各国合计 + 分片清单
 *   `data/region-records/<CC>.json`   —— `{ cc, count, species, bySpecies: { 物种id: 记录数 } }`
 *
 * 口径（**与省级层不同，UI 必须说明**）：
 *   · 国家层 = 该国全部记录数（**含未被归属到省份的记录**）；
 *   · 省级层 = 只计能映射到 ISO 省名的记录。
 *   → 两层天然不等，**不可互相加总，也不跨地区比大小**（docs/075 §6.3）。
 *
 * 加载失败静默为 null（调用方退回"没有记录数"的旧行为，不阻塞页面）。
 * **不因为记录数少而折叠地区**（2026-10-23 用户定）：分片按 ISO 3166-1 的 249 个码生产，
 * 布韦岛/赫德岛/皮特凯恩这类几十条记录的属地照样有分片、照样展示——只丢 `ZZ/XK/XZ` 排除码。
 */
import type { ProvinceSource, ShardList } from './provinces'

export interface RegionRecordsIndex {
  schemaVersion: number
  generatedAt: string
  method: string
  sources: ProvinceSource[]
  /** 孤证地板（该 (国,种) 对的最小记录数） */
  threshold: { minRecords: number }
  scope: { countries: number }
  counts: {
    rows: number
    rawRecords: number
    pairs: number
    species: number
    matchedRecords: number
    matchedShare: number
    viaBridge: number
    unmatchedNames: number
  }
  /** 国家码 → 该国已归一记录数合计（= 分片 count） */
  totals: Record<string, number>
  sharding: ShardList
}

export interface CountryRecordsShard {
  schemaVersion: number
  cc: string
  /** 分片内记录数合计 */
  count: number
  /** 分片内物种数 */
  species: number
  /** 物种 id → GBIF 记录数 */
  bySpecies: Record<string, number>
}

const DATA = `${import.meta.env.BASE_URL}data`
const INDEX_URL = `${DATA}/region-records/index.json`

let indexCache: Promise<RegionRecordsIndex | null> | null = null
const shardCache = new Map<string, Promise<CountryRecordsShard | null>>()

/** 测试用：清空加载缓存 */
export function _resetRegionRecordsCache(): void {
  indexCache = null
  shardCache.clear()
}

/** 索引（口径 + 各国合计 + 分片清单）；失败 → null */
export function loadRegionRecordsIndex(): Promise<RegionRecordsIndex | null> {
  indexCache ??= fetch(INDEX_URL)
    .then((r) => (r.ok ? (r.json() as Promise<RegionRecordsIndex>) : null))
    .catch(() => null)
  return indexCache
}

/** 某国分片（物种 id → 记录数）；无数据/失败 → null */
export function loadCountryRecords(cc: string): Promise<CountryRecordsShard | null> {
  const key = String(cc || '').toUpperCase()
  if (!key) return Promise.resolve(null)
  let p = shardCache.get(key)
  if (!p) {
    p = loadRegionRecordsIndex().then((idx) =>
      idx?.sharding
        ? fetch(`${DATA}/${idx.sharding.dir}/${key}.json`)
            .then((r) => (r.ok ? (r.json() as Promise<CountryRecordsShard>) : null))
            .catch(() => null)
        : null,
    )
    shardCache.set(key, p)
  }
  return p
}

/** 该国记录数合计（索引里的 totals；没有则 null） */
export function countryRecordTotal(index: RegionRecordsIndex | null, cc: string): number | null {
  const n = index?.totals?.[cc]
  return typeof n === 'number' ? n : null
}

/** 某物种在该国的记录数；无则 0 */
export function countryRecordCount(shard: CountryRecordsShard | null, speciesId: string): number {
  return Number(shard?.bySpecies?.[speciesId]) || 0
}
