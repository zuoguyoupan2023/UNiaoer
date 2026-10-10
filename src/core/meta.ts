/**
 * 050 P2：**权威名录层**（`manifest-meta.json`）的加载与查询。
 *
 * 为什么需要它：此前前端只有两个"名录"来源——
 *   · `bank.ts` 的 `manifest-core`（1,299 种，启动加载）
 *   · `globalPool.ts` 的 `manifest-global.min`（9,545 种，懒加载，但只用于答题池）
 * 物种详情页只在 core 里 find，查不到就退回 `species-index` 骨架的**轻量详情**，
 * 于是 9,545 种明明有图有音有署名，却显示成没有媒体、没有画廊的空壳页。
 *
 * 权威层（10,844 种 × 全字段、**不含媒体**）就是为此而建：
 * **元数据**（名称/科目/profile/notes/taxonId）一律以它为准，
 * **媒体**仍走既有两条通道（core 首图首音 + assets 分片 / 全球池），
 * 直到 050 P3 把 assets 扩到全量后，才统一到 assets。
 *
 * 加载顺序：**先静态 `/data/manifest-meta.json`，后 `/api/manifest-meta`**。
 * 之所以把静态放第一位：`index.html` 的 preload（050 O1）指向的就是这个路径，
 * 两者顺序一致才能**复用同一次请求**；若生产优先打 API，就会变成"预载一份 + 再取一份"，
 * 白白多下一个 3.8MB（实测过：命中两条不同 URL 时确实请求了两次）。
 */
import type { BankSpecies } from './bank'

export interface MetaSpecies extends Omit<BankSpecies, 'images' | 'audios'> {
  order?: string
}

/** 权威层（与 manifest 顶层同构，子集字段） */
export interface MetaManifest {
  layer: 'meta'
  schemaVersion: number
  generatedAt: string
  policy?: string
  source?: string
  total: number
  stats?: Record<string, unknown>
  /** S6：assets 最终分片清单（前端解析媒体分片用） */
  buckets?: string[]
  /** S6：全量可玩口径（构建期烘焙） */
  universe?: {
    coreTotal?: number
    globalTotal?: number
    total: number
    withImage: number
    withAudio: number
    imageOnly: number
    audioOnly: number
    withNameZh: number
    notCovered: number
  }
  species: MetaSpecies[]
}

let cache: MetaManifest | null = null
let inflight: Promise<MetaManifest | null> | null = null

const byId = new Map<string, MetaSpecies>()
const bySci = new Map<string, MetaSpecies>()

function index(list: MetaSpecies[]) {
  for (const sp of list) {
    if (sp?.id) byId.set(sp.id, sp)
    if (sp?.nameSci) bySci.set(sp.nameSci.toLowerCase(), sp)
  }
}

/** 懒加载权威层（并发去重；失败返回 null，调用方退回旧链路） */
export function loadMeta(): Promise<MetaManifest | null> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  const base = import.meta.env.BASE_URL
  // 静态优先（与 index.html preload 对齐，命中同一请求）；API 兜底（CDN/边缘异常时）
  const urls = [`${base}data/manifest-meta.json`, '/api/manifest-meta']
  inflight = (async () => {
    for (const url of urls) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('json')) continue // SPA 回退把 404 改写成 index.html
        const data = (await res.json()) as MetaManifest
        if (!Array.isArray(data.species) || !data.species.length) continue
        cache = data
        index(data.species)
        return cache
      } catch {
        /* 试下一个 */
      }
    }
    return null
  })()
  return inflight
}

/** 已加载的权威层（未加载返回 null，供同步路径使用） */
export function metaReady(): MetaManifest | null {
  return cache
}

/** 按物种 id 查权威条目（同步；未加载返回 undefined） */
export function metaSpecies(id: string | undefined): MetaSpecies | undefined {
  return id ? byId.get(id) : undefined
}

/** 按学名查权威条目（小写匹配） */
export function metaSpeciesBySci(nameSci: string | undefined): MetaSpecies | undefined {
  return nameSci ? bySci.get(nameSci.toLowerCase()) : undefined
}

/** 权威条目 → BankSpecies 形状（供复用既有组件/解析函数；**媒体为空**） */
export function metaAsBankSpecies(sp: MetaSpecies | undefined): BankSpecies | undefined {
  return sp as unknown as BankSpecies | undefined
}

/** 测试用：清空缓存 */
export function _resetMetaCache() {
  cache = null
  inflight = null
  byId.clear()
  bySci.clear()
}