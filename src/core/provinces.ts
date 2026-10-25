/**
 * 省级层（021 M2/M3）——**P1-6 分片版 + P1-4B 全量国**（2026-10-23）。
 *
 * 为什么分片：单文件 `region-provinces.json` 在 29 国时已 3.0MB，且被 `/birding`（按国看鸟种）
 * 与**每个物种页**（省份热力条）一起加载；扩到欧洲+美洲会到 ~6MB（docs/074 P1-6）。
 * 两个页面的访问模式互补，所以产物拆成两种分片：
 *
 *   `data/region-provinces/index.json`      —— 元数据 + 国家/省名 + 分片清单（不含 bySpecies）
 *   `data/region-provinces/<CC>.json`       —— `/birding` 选中国家时读 1 个：`{ bySpecies: { id: { 省码: n } } }`
 *   `data/region-species/<前两位>.json`      —— `/species/:id` 只读 1 个：`{ bySpecies: { id: { 国家: { 省码: n } } } }`
 * （旧单文件 `data/region-provinces.json` 已于 2026-10-23 删除：扩到 198 国后它会有 ~14MB，
 *  前端不再保留回退分支——索引/分片缺失时整层静默隐藏。）
 *
 * 数据由 GBIF stateProvince + ISO 3166-2 归一化构建（见 scripts/region/build-provinces.mjs）。

 * CN：内地 31 省=GBIF 记录数；港澳台（CN-71/91/92）按铁律 6 并入并标注
 * 「中国香港／中国澳门／中国台湾」，记录数取该国国家码（TW/HK/MO）的国家层真值。
 *
 * 全部加载失败静默为 null（调用方隐藏整块，不阻塞页面）。
 */

import { CONTINENT_LABEL_KEY, REGION_LABEL_KEY, isContinentCode } from './region'
export interface ProvinceSource {
  key: string
  name: string
  url: string
  license: string
  attribution: string
}

/** 分片清单（索引里自带体积，便于前端/门禁发现与核对） */
export interface ShardList {
  dir: string
  files: string[]
  bytes: Record<string, number>
  maxBytes: number
  totalBytes: number
}

/** 索引（不含 bySpecies） */
export interface ProvinceIndex {
  schemaVersion: number
  generatedAt: string
  method: string
  sources: ProvinceSource[]
  countries: string[]
  /** 国家码 → { code: 展示名 }（CN 为中文全称、含港澳台标注名；其余国家为 ISO 英文名） */
  byCountry: Record<string, Record<string, string>>
  /** 英文展示名（仅当与 byCountry 不同时提供，当前仅 CN；provincesOf 按 locale 取用） */
  byCountryAlt?: Record<string, Record<string, string>>
  counts?: { countries: number; species: number; cells: number }
  /** 国家码 → { species, cells }（该分片的物种数/省格数） */
  countryCounts?: Record<string, { species: number; cells: number }>
  /**
   * 省级明细的**记录覆盖率**（P1-4B）：可映射到 ISO 省名的记录 / 该国全部 Aves 记录。
   * <0.9 的国家前端必须标注「省级明细仅覆盖 X% 的记录」——不折叠地区，但也不假装完整
   * （历史上 GBIF 的省名是自由文本：瑞典用历史地理省、肯尼亚用殖民时期大区）。
   */
  coverage?: { countries: number; byCountry: Record<string, CountryCoverage> }
  sharding?: ShardList
  speciesSharding?: ShardList & { bucketChars: number; buckets: string[] }
}

/** 单国覆盖率（`coverage.byCountry[cc]`） */
export interface CountryCoverage {
  allRecords: number
  mappedRecords: number
  unmatchedRecords: number
  /** mappedRecords / allRecords（0–1） */
  coverage: number
  rawNames: number
  mappedNames: number
  species: number
  cells: number
}

/** 按国分片：物种 id → { 省码: 记录数 } */
export interface CountryProvinceShard {
  schemaVersion: number
  cc: string
  generatedAt?: string
  bySpecies: Record<string, Record<string, number>>
}

/** 按物种前缀分片：物种 id → 国家码 → { 省码: 记录数 } */
export interface SpeciesProvinceShard {
  schemaVersion: number
  bucket: string
  generatedAt?: string
  bySpecies: Record<string, Record<string, Record<string, number>>>
}

const DATA = `${import.meta.env.BASE_URL}data`
const INDEX_URL = `${DATA}/region-provinces/index.json`
/** 与构建脚本的 BUCKET_CHARS 默认值一致（索引缺失时兜底） */
const FALLBACK_BUCKET_CHARS = 2

let indexCache: Promise<ProvinceIndex | null> | null = null
const countryCache = new Map<string, Promise<CountryProvinceShard | null>>()
const speciesCache = new Map<string, Promise<SpeciesProvinceShard | null>>()

/** 测试用：清空加载缓存（与其他 core 模块的 _reset 惯例一致） */
export function _resetProvincesCache(): void {
  indexCache = null
  countryCache.clear()
  speciesCache.clear()
}

const fetchJson = <T>(url: string): Promise<T | null> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null)

/** 加载省级索引（元数据 + 国家/省名 + 分片清单）；失败返回 null，不阻塞页面 */
export function loadProvincesIndex(): Promise<ProvinceIndex | null> {
  indexCache ??= fetchJson<ProvinceIndex>(INDEX_URL)
  return indexCache
}

/** 加载某国分片；无数据/失败 → null */
export function loadCountryProvinces(cc: string): Promise<CountryProvinceShard | null> {
  const key = String(cc || '').toUpperCase()
  if (!key) return Promise.resolve(null)
  let p = countryCache.get(key)
  if (!p) {
    p = loadProvincesIndex().then(async (idx) =>
      idx?.sharding ? fetchJson<CountryProvinceShard>(`${DATA}/${idx.sharding.dir}/${key}.json`) : null,
    )
    countryCache.set(key, p)
  }
  return p
}

/** 加载某物种所在的前缀桶分片；无数据/失败 → null */
export function loadSpeciesProvinces(speciesId: string): Promise<SpeciesProvinceShard | null> {
  const id = String(speciesId || '')
  if (!id) return Promise.resolve(null)
  let p = speciesCache.get(id)
  if (!p) {
    p = loadProvincesIndex().then(async (idx) => {
      if (!idx?.speciesSharding) return null
      const chars = idx.speciesSharding.bucketChars || FALLBACK_BUCKET_CHARS
      const bucket = id.slice(0, chars)
      const shard = await fetchJson<SpeciesProvinceShard>(`${DATA}/${idx.speciesSharding.dir}/${bucket}.json`)
      return shard ?? null
    })
    speciesCache.set(id, p)
  }
  return p
}

/**
 * 083（2026-10-24 用户定）：**收起二级（省级）浏览/出题入口**的国家——数据不删、物种页省份
 * 热力条照常，仅 `/birding` 的省级目录与出题/识别页的省选择器不再提供（数据层可随时恢复）：
 *  - 镇级：ISO 一级区划本身就是市镇且数量巨大（SI 211 / LV 119 / MK 84 / MT 68），二级浏览
 *    与出题没有实际价值 → 「合并为国家级」（docs/083 §3.1 方案乙）；
 *  - SG：二级覆盖率仅 4.1%（GBIF 把国名当省名，我们不把国名当省名 → 只剩 2 个有记录的 CDC）；
 *  - 微型国：省级明细物种 < 100（NR 23 / TV 26 / KI 52 / MH 56），二级没有信息量。
 * 领地（UM/SH/BQ/GL）按 docs/083 §5-3 **保持现状**。
 */
export const PROVINCE_HIDDEN_COUNTRIES: ReadonlySet<string> = new Set([
  'SI', 'LV', 'MK', 'MT', // 镇级（ISO 一级=市镇且 >50 个）
  'SG', // 二级覆盖率 4.1%，只剩 2 个 CDC
  'NR', 'TV', 'KI', 'MH', // 微型：省级明细物种 <100
])

/**
 * 该国是否提供二级（省级）浏览/出题入口：收起名单内（083）或索引里没有该国的 → false。
 * 仅约束 UI 入口——物种页热力条（SpeciesProvinces）与管理端名字查表**不经过这里**。
 */
export function provinceSecondLevelEnabled(index: ProvinceIndex | null, country: string): boolean {
  const cc = String(country || '').toUpperCase()
  if (!cc || PROVINCE_HIDDEN_COUNTRIES.has(cc)) return false
  return !!index?.byCountry?.[cc]
}

/** 该国省级列表（按展示名排序）；无数据返回 []。en 优先取 byCountryAlt（如 CN 的港澳台标注名） */
/** 该国的省级明细覆盖率（0–1）；无数据 → null（未知，别乱标） */
export function provinceCoverage(index: ProvinceIndex | null, country: string): number | null {
  const c = index?.coverage?.byCountry?.[country]?.coverage
  return typeof c === 'number' ? c : null
}

export function provincesOf(
  data: ProvinceIndex | null,
  country: string,
  locale = 'zh-CN',
): { code: string; name: string }[] {
  const map =
    (locale.startsWith('en') ? data?.byCountryAlt?.[country] : null) ?? data?.byCountry?.[country]
  if (!map) return []
  // 保持 data 内顺序（由构建脚本按 code 排序）；排序交给视图按 sortMode 决定
  return Object.entries(map).map(([code, name]) => ({ code, name }))
}

/**
 * 该国省级列表 + 每省鸟种数（供二级目录按鸟种数排序/展示）。
 * count = 该国该省有记录的物种数（与一级目录的「N 种」同口径）→ 只需该国分片。
 */
export function provinceStats(
  index: ProvinceIndex | null,
  shard: CountryProvinceShard | null,
  country: string,
  locale = 'zh-CN',
): { code: string; name: string; count: number }[] {
  const list = provincesOf(index, country, locale)
  if (!list.length) return []
  const counts = new Map<string, number>()
  for (const cells of Object.values(shard?.bySpecies || {})) {
    for (const code of Object.keys(cells)) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return list.map((p) => ({ ...p, count: counts.get(p.code) ?? 0 }))
}

/** 某物种在某国某省的记录数；无则 0 */
export function provinceCount(shard: CountryProvinceShard | null, speciesId: string, code: string): number {
  return shard?.bySpecies?.[speciesId]?.[code] ?? 0
}

/** 该省有记录的物种 id 集合（用于过滤） */
export function speciesInProvince(shard: CountryProvinceShard | null, code: string): Set<string> {
  const out = new Set<string>()
  if (!shard || !code) return out
  for (const [spId, cells] of Object.entries(shard.bySpecies || {})) {
    if (cells?.[code]) out.add(spId)
  }
  return out
}

/** 该国「物种 id → 各省记录数」（视图做记录数排序时一次取用） */
export function countsBySpecies(shard: CountryProvinceShard | null): Map<string, Record<string, number>> {
  return new Map(Object.entries(shard?.bySpecies || {}))
}

/**
 * 087 §6.5：地区码 → 展示名（轮次角标/结果页用）。
 * - 'ALL' → t('quiz.regionAll')；
 * - 省码（CN-11）→ 「国家 · 省名」（省名查省级索引；索引缺失退省码原文）；
 * - 国家码 → 敏感码走 i18n 固定名（REGION_LABEL_KEY），其余 Intl.DisplayNames（按 locale 缓存实例）。
 * 政治合规与介绍页同一张表（region.ts / 铁律 6），不另维护显示名。
 */
export function regionDisplayName(
  code: string | null | undefined,
  locale: string,
  t: (key: string) => string,
  index: ProvinceIndex | null,
): string {
  const v = String(code || '').trim().toUpperCase()
  if (!v || v === 'ALL') return t('quiz.regionAll')
  // 088 方案 B：洲码（L5+ 的出题地区）→ 大洲名
  if (isContinentCode(v)) return t(CONTINENT_LABEL_KEY[v])
  const cc = v.split('-')[0]!
  const country =
    cc in REGION_LABEL_KEY ? t(REGION_LABEL_KEY[cc]!) : displayRegionName(cc, locale)
  if (!v.includes('-')) return country
  const prov =
    provincesOf(index, cc, locale).find((p) => p.code === v)?.name ?? v
  return `${country} · ${prov}`
}

const _displayNamesCache = new Map<string, Intl.DisplayNames>()
function displayRegionName(cc: string, locale: string): string {
  try {
    let dn = _displayNamesCache.get(locale)
    if (!dn) {
      dn = new Intl.DisplayNames([locale], { type: 'region' })
      _displayNamesCache.set(locale, dn)
    }
    return dn.of(cc) ?? cc
  } catch {
    return cc
  }
}
