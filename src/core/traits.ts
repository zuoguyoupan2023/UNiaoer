/**
 * 053-describe 详情层懒加载：`public/data/traits/<桶>.json` + `iucn-habitat-codes.json`。
 *
 * 设计约束（docs/053-describe §11.2）：
 *  · 核心层 `manifest-meta` 只带 `profile.habitatCodes` + `profile.hasTraits`（code/布尔，~0.3MB）；
 *  · 食性/形态/羽色/生境明细只在用户点进物种页时才拉对应分片；
 *  · 分片按**学名首字母**分桶，大桶再按前两个字母细分；桶清单以 `traits/index.json` 为准；
 *  · 缺数据就返回 null，UI 不占位、不猜。
 */

export interface HabitatCodeInfo {
  zh?: string
  zhShort?: string
  review?: boolean
}
export interface HabitatCodeTable {
  codes: Record<string, HabitatCodeInfo>
  level1?: Record<string, { en?: string; zh?: string }>
}

export interface TraitHabitat {
  code: string
  major?: boolean
  seasons?: string[]
}
export interface TraitPlumageColour {
  m: number
  f: number
}
export interface SpeciesTraits {
  nameSci?: string
  habitats?: TraitHabitat[]
  systems?: { code: string; en: string }[]
  category?: string
  diet?: Record<string, number>
  dietSum?: number
  foraging?: Record<string, number>
  nocturnal?: boolean
  morph?: Record<string, number | boolean>
  eco?: Record<string, unknown>
  plumage?: {
    colours?: Record<string, TraitPlumageColour>
    dichromatism?: { isDichromatic?: boolean | null }
  } | null
}

interface TraitShard {
  byTaxonKey?: Record<string, SpeciesTraits>
}

const BASE = import.meta.env.BASE_URL
const bucketCache = new Map<string, Record<string, SpeciesTraits>>()
const bucketInflight = new Map<string, Promise<Record<string, SpeciesTraits>>>()
let indexPromise: Promise<Set<string>> | null = null
let codeTablePromise: Promise<HabitatCodeTable | null> | null = null

function normBucket(nameSci: string | undefined): string {
  const ch = String(nameSci || '').trim().charAt(0).toLowerCase()
  return /[a-z]/.test(ch) ? ch : '0'
}

function twoLetter(nameSci: string | undefined): string {
  const s = String(nameSci || '').trim().toLowerCase()
  return /^[a-z]{2}/.test(s) ? s.slice(0, 2) : `${normBucket(nameSci)}0`
}

/** `traits/index.json` 的桶清单（只列实际存在的桶；用于判断单字母桶还是两字母桶）。 */
function loadTraitIndex(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = fetch(`${BASE}data/traits/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { buckets?: Record<string, number> } | null) => new Set(Object.keys(d?.buckets || {})))
      .catch(() => new Set())
  }
  return indexPromise
}

async function loadBucket(nameSci: string | undefined): Promise<Record<string, SpeciesTraits>> {
  const buckets = await loadTraitIndex()
  const one = normBucket(nameSci)
  const two = twoLetter(nameSci)
  const name = buckets.has(one) ? one : buckets.has(two) ? two : ''
  if (!name) return {}
  const hit = bucketCache.get(name)
  if (hit) return hit
  let p = bucketInflight.get(name)
  if (!p) {
    p = fetch(`${BASE}data/traits/${name}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TraitShard | null) => d?.byTaxonKey || {})
      .catch(() => ({}))
      .finally(() => bucketInflight.delete(name))
    bucketInflight.set(name, p)
  }
  const data = await p
  bucketCache.set(name, data)
  return data
}

/**
 * 按 taxonKey 取某物种的详情性状；缺 taxonKey/nameSci、分片 404、条目不存在均返回 null。
 * 复用同一个分片缓存（与 assets 分片同构）。
 */
export async function loadSpeciesTraits(
  taxonKey: string | undefined,
  nameSci: string | undefined,
): Promise<SpeciesTraits | null> {
  if (!taxonKey || !nameSci) return null
  const bucket = await loadBucket(nameSci)
  return bucket[taxonKey] ?? null
}

/** 前端查表用：code → 中文短标签。失败返回 null（UI 不显示标签，不阻塞）。 */
export function loadHabitatCodes(): Promise<HabitatCodeTable | null> {
  if (!codeTablePromise) {
    codeTablePromise = fetch(`${BASE}data/iucn-habitat-codes.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return codeTablePromise
}

/** 生境短标签：优先 zhShort；英文界面暂无逐 code 英文，回退中文短标签。 */
export function habitatLabel(
  table: HabitatCodeTable | null,
  code: string,
  locale: string,
): string {
  const info = table?.codes?.[code]
  if (!info) return code
  return locale === 'en' ? info.zhShort || info.zh || code : info.zhShort || info.zh || code
}

/** 非零项按数值降序（食性/取食层次用）。 */
export function topEntries(
  obj: Record<string, number> | undefined,
  limit = 99,
): Array<[string, number]> {
  if (!obj) return []
  return Object.entries(obj)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}
