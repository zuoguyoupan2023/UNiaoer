/**
 * 031 D-031-2:名录（/catalog）排序 —— 纯函数。
 *
 * 数据源 public/data/catalog.json（构建期产物）：目 → 科 → 种。
 * 构建期已按 AviList 分类序排好，并给每个种预计算两个排序键：
 *   py 中文名拼音（纯 a-z）· cm 常见度档位（1 最常见 … 5 稀有）
 * 前端只做**目内重排**（科按其在各视图中的首个种排序），不重组目层级：
 * 目是权威分类框架，用户借搜索/字母跳转定位，而不是靠全表重排。
 */

export type CatalogSortMode = 'taxo' | 'pinyin' | 'common'

export interface CatalogSpecies {
  id: string
  sci: string
  en?: string
  zh?: string
  /** 拼音排序键（构建期预计算；无中文名或含未收录字时缺失） */
  py?: string
  /** 常见度档位（1 最常见 … 5 稀有；无值时缺失） */
  cm?: number
  image: boolean
  audio: boolean
  extinct?: boolean
}

export interface CatalogFamily {
  sci: string
  species: CatalogSpecies[]
}

export interface CatalogOrder {
  sci: string
  zh?: string
  families: CatalogFamily[]
}

export interface CatalogData {
  generatedAt: string
  counts: { total: number; withImage: number; withAudio: number; orders: number; families: number }
  orders: CatalogOrder[]
}

/** 排序键：拼音 → 英文名 → 学名（与行内显示的回退顺序一致，避免"未转写项沉底"的观感断裂） */
export function sortKeyOf(s: CatalogSpecies): string {
  return s.py || s.en?.toLowerCase() || s.sci.toLowerCase()
}

function comparator(mode: CatalogSortMode): (a: CatalogSpecies, b: CatalogSpecies) => number {
  if (mode === 'pinyin') {
    return (a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b), 'en') || a.sci.localeCompare(b.sci)
  }
  // common：无常见度的排末位，其次按学名稳定排序
  return (a, b) => (a.cm ?? 99) - (b.cm ?? 99) || a.sci.localeCompare(b.sci)
}

/**
 * 按视图模式重排目录。taxo 直接返回原引用（构建期顺序即分类序，零成本）。
 * 科顺序 = 科内首个种在该视图中的位置（而不是科拉丁名），这样
 * 「拼音」视图下科的出场顺序也符合读者预期（如 燕科 在 y 段）。
 */
export function sortCatalogOrders(orders: CatalogOrder[], mode: CatalogSortMode): CatalogOrder[] {
  if (mode === 'taxo') return orders
  const cmp = comparator(mode)
  return orders.map((o) => ({
    ...o,
    families: o.families
      .map((f) => ({ ...f, species: [...f.species].sort(cmp) }))
      .sort((x, y) => cmp(x.species[0]!, y.species[0]!)),
  }))
}

/** A–Z 首字母 → 该视图顺序下首次出现的种 id（字母跳转锚点）。 */
export function letterAnchors(orders: CatalogOrder[]): [string, string][] {
  const map = new Map<string, string>()
  for (const o of orders) {
    for (const f of o.families) {
      for (const s of f.species) {
        const letter = sortKeyOf(s)[0]?.toUpperCase()
        if (letter && /[A-Z]/.test(letter) && !map.has(letter)) map.set(letter, s.id)
      }
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}
