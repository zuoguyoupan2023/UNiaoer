import type { MediaAsset } from '@/types'

/** 答疑专栏说明（011 §9）：物种 id → 图文说明，双语；构建期并入 manifest */
export interface SpeciesNote {
  titleZh: string
  titleEn: string
  bodyZh: string
  bodyEn: string
}

/** 类群（C1）：水鸟 / 猛禽 / 林鸟 */
export type SpeciesGroup = 'waterbird' | 'raptor' | 'landbird'
/** 居留型（C1）：留鸟 / 夏候鸟 / 冬候鸟 / 旅鸟 / 候鸟 / 迷鸟 */
export type SpeciesMigration = 'resident' | 'summer' | 'winter' | 'passage' | 'migrant' | 'vagrant'

/** 分布（由 data/distribution.json 按 taxonId 派生；国家码列表见 public/data/distribution.json 按需加载） */
export interface SpeciesDistribution {
  /** 分布国家/地区数 */
  count: number
  /** IUCN 红色名录等级（LC/NT/VU/EN/CR…） */
  category?: string
  source?: string
  url?: string
}

/** 物种档案（C1）：类群自动派生、分布来自分布数据，居留型/生境/习性人工整理（稀疏） */
export interface SpeciesProfile {
  group?: SpeciesGroup
  migration?: SpeciesMigration
  habitatZh?: string
  habitatEn?: string
  habitZh?: string
  habitEn?: string
  distribution?: SpeciesDistribution
}

/** 题库中单个物种（来自构建脚本生成的 manifest） */
export interface BankSpecies {
  id: string
  nameZh: string
  nameSci: string
  /** 英文俗名（i18n，manifest v2 起） */
  nameEn?: string
  /** iNat taxon id（稳定主键，manifest v2 起） */
  taxonId?: number
  /** AviList 稳定概念键（AvibaseID，023 P0 只增字段）；playable=素材可玩的构建期基线 */
  taxonKey?: string
  playable?: boolean
  playableImage?: boolean
  playableAudio?: boolean
  /**
   * 029 M3:素材质量降级标记（构建期产物）。true = 该物种素材**仅展示、不进题库**
   * （用户反馈确认差且无替补时置位；见 docs/029 §4 质量闭环）。
   */
  quizExcluded?: boolean
  family: string
  commonness: number
  /** 榜单排名 / 是否中国榜（manifest v2 起） */
  rankWorld?: number | null
  rankCN?: number | null
  inCN?: boolean | null
  desc: string
  location: string
  habit: string
  /** 答疑专栏说明（011 §9；仅少数物种有） */
  notes?: SpeciesNote
  /** 物种档案（C1）：类群/分布/居留型/生境/习性 */
  profile?: SpeciesProfile
  /** 兼容期：首选素材（= images[0] / audios[0]） */
  image: MediaAsset | null
  audio: MediaAsset | null
  /** manifest v2 多素材（best-first）；缺省时回退到 image/audio */
  images?: MediaAsset[]
  audios?: MediaAsset[]
}

export interface Manifest {
  generatedAt: string
  policy: string
  mediaMode: string
  total: number
  stats: { withImage: number; withAudio: number }
  species: BankSpecies[]
  /** 029 M1 分层:core 层带实际分片清单与层级标记(旧完整层无此字段) */
  layer?: 'core' | 'global'
  buckets?: string[]
  schemaVersion?: number
  /** 029 M2:全量可玩口径(核心+全球,构建期烘焙;旧部署无此字段时回退本层 stats) */
  universe?: {
    coreTotal: number
    globalTotal: number
    total: number
    withImage: number
    withAudio: number
  }
}

let cache: Manifest | null = null

/** 029 M1:分片缓存(id → 完整素材)。详情/画廊/海报按需加载一次,进程内复用。 */
const assetCache = new Map<string, { images?: MediaAsset[]; audios?: MediaAsset[] }>()
/** 已加载的分片名(避免同桶重复请求) */
const bucketLoaded = new Set<string>()
/** 分片请求进行中的 Promise(并发去重:多个视图同时要同桶只发一次) */
const bucketInflight = new Map<string, Promise<void>>()

/** 029 M1:由 core.buckets 与 id 解析分片名(两位子桶优先,回退一位桶)。 */
function bucketNameFor(id: string): string {
  const buckets = cache?.buckets
  if (!buckets || !buckets.length) return ''
  const s = String(id || '').toLowerCase()
  const two = s.slice(0, 2)
  if (/^[a-z][a-z0-9]$/.test(two) && buckets.includes(two)) return two
  const one = /^[a-z]$/.test(s.charAt(0)) ? s.charAt(0) : '0-9'
  return buckets.includes(one) ? one : ''
}

/**
 * 029 M1:按需加载某物种的完整素材(详情页画廊 / 结果页 / 海报)。
 * 命中 core 首图首音之外的素材时才有额外请求;无 core(未 loadBank)或物种无分片返回 null。
 */
export async function loadSpeciesAssets(
  id: string,
): Promise<{ images?: MediaAsset[]; audios?: MediaAsset[] } | null> {
  if (assetCache.has(id)) return assetCache.get(id)!
  const name = bucketNameFor(id)
  if (!name) return null
  if (!bucketLoaded.has(name)) {
    let p = bucketInflight.get(name)
    if (!p) {
      p = (async () => {
        const url = `${import.meta.env.BASE_URL}data/assets/${name}.json`
        try {
          const res = await fetch(url)
          if (res.ok) {
            const data = (await res.json()) as { species?: Record<string, { images?: MediaAsset[]; audios?: MediaAsset[] }> }
            for (const [sid, entry] of Object.entries(data.species || {})) {
              assetCache.set(sid, entry)
            }
          }
        } catch {
          /* 分片加载失败:调用方回退 core 首图首音 */
        } finally {
          bucketLoaded.add(name)
          bucketInflight.delete(name)
        }
      })()
      bucketInflight.set(name, p)
    }
    await p
  }
  return assetCache.get(id) ?? null
}

/** 029 M1:同步取已缓存的完整素材(未加载则 null);供已 await 过 loadSpeciesAssets 的渲染路径。 */
export function cachedSpeciesAssets(
  id: string | null | undefined,
): { images?: MediaAsset[]; audios?: MediaAsset[] } | null {
  if (!id) return null
  return assetCache.get(id) ?? null
}

/**
 * 物种显示名（015 §6.1）：en 优先 nameEn，缺失回退学名；zh 用 nameZh。
 * 029 M2:全球长尾种约半数无中文名（Wikidata 覆盖缺口）——zh 下依次回退
 * nameEn → nameSci，避免出现**空选项/空答案**（与 speciesIndex.entryDisplayName 同规则）。
 */
export function speciesName(sp: BankSpecies, locale?: string): string {
  if (locale === 'en') return sp.nameEn || sp.nameSci || sp.nameZh
  return sp.nameZh || sp.nameEn || sp.nameSci
}

/** speciesId → 物种索引（loadBank 后构建；旧记录 speciesId 可能是媒体 URL，查不到即回退） */
let speciesIndex: Map<string, BankSpecies> | null = null

/**
 * 名字（中文名/英文名/学名）→ 物种索引：旧记录（无 chosenId）的错选名
 * 按当前语言解析用（015 #1）。同名冲突先到先得（撞名极罕见，仅影响该回退路径）。
 */
let nameIndex: Map<string, BankSpecies> | null = null

function buildSpeciesIndex(bank: Manifest) {
  speciesIndex = new Map(bank.species.map((s) => [s.id, s]))
  nameIndex = new Map()
  for (const sp of bank.species) {
    if (sp.nameZh && !nameIndex.has(sp.nameZh)) nameIndex.set(sp.nameZh, sp)
    if (sp.nameEn && !nameIndex.has(sp.nameEn)) nameIndex.set(sp.nameEn, sp)
    if (sp.nameSci && !nameIndex.has(sp.nameSci)) nameIndex.set(sp.nameSci, sp)
  }
}

/**
 * 029 M2:把懒加载的全球池并入索引——历史记录/错题本里存的是全球种 id 或作答时的名字，
 * 都需要按当前语言解析（与核心库同规则：id 直查 + 名字反查，撞名先到先得）。
 * 重复注册（同 id）跳过；核心库优先（先到先得）。
 */
export function registerSpecies(extra: BankSpecies[]): void {
  if (!speciesIndex || !nameIndex) return
  for (const sp of extra) {
    if (!sp?.id) continue
    if (!speciesIndex.has(sp.id)) speciesIndex.set(sp.id, sp)
    if (sp.nameZh && !nameIndex.has(sp.nameZh)) nameIndex.set(sp.nameZh, sp)
    if (sp.nameEn && !nameIndex.has(sp.nameEn)) nameIndex.set(sp.nameEn, sp)
    if (sp.nameSci && !nameIndex.has(sp.nameSci)) nameIndex.set(sp.nameSci, sp)
  }
}

/** 按 id 查物种（需先 loadBank 建索引） */
export function speciesById(id: string): BankSpecies | undefined {
  return speciesIndex?.get(id)
}

/**
 * 本地记录（错题本/历史/轮次）里的物种名按 locale 解析（015 #1）：
 * 记录只存了作答时的名字字符串，这里用 speciesId 回查题库取当前语言的名字；
 * 旧记录（speciesId 是 URL）或题库未加载时返回 undefined，调用方回退存储名。
 */
export function speciesNameById(id: string | null | undefined, locale: string): string | undefined {
  if (!id) return undefined
  const sp = speciesIndex?.get(id)
  return sp ? speciesName(sp, locale) : undefined
}

/**
 * 存储的名字字符串（旧记录的错选名/答案名，可能来自任一语言）按 locale 解析：
 * 名字索引查到物种 → 返回当前语言名字；查不到返回 undefined（调用方回退原字符串）。
 */
export function speciesNameByStoredName(
  stored: string | null | undefined,
  locale: string,
): string | undefined {
  if (!stored) return undefined
  const sp = nameIndex?.get(stored)
  return sp ? speciesName(sp, locale) : undefined
}

/** 按 id 取答疑说明（需先 loadBank 建索引；无说明返回 undefined） */
export function speciesNoteById(id: string | null | undefined): SpeciesNote | undefined {
  if (!id) return undefined
  return speciesIndex?.get(id)?.notes
}

/**
 * 答疑说明按 locale 取文本（缺英文字段回退中文，反之亦然）；无说明返回 null。
 * 供 FAQ 页与题目/结果页入口渲染（数据驱动文案，不经过 i18n 静态语言包）。
 */
export function speciesNoteText(
  note: SpeciesNote | undefined,
  locale: string,
): { title: string; body: string } | null {
  if (!note) return null
  if (locale === 'en') {
    return { title: note.titleEn || note.titleZh, body: note.bodyEn || note.bodyZh }
  }
  return { title: note.titleZh || note.titleEn, body: note.bodyZh || note.bodyEn }
}

/** 按 id 取物种档案（需先 loadBank 建索引） */
export function speciesProfileById(id: string | null | undefined): SpeciesProfile | undefined {
  if (!id) return undefined
  return speciesIndex?.get(id)?.profile
}

/** 物种档案里的人工文本（生境/习性）按 locale 取；缺英文回退中文，反之亦然 */
export function speciesProfileText(
  profile: SpeciesProfile | undefined,
  locale: string,
): { habitat?: string; habit?: string } {
  if (!profile) return {}
  const pick = (zh?: string, en?: string) => (locale === 'en' ? en || zh : zh || en)
  const habitat = pick(profile.habitatZh, profile.habitatEn)
  const habit = pick(profile.habitZh, profile.habitEn)
  return { habitat: habitat || undefined, habit: habit || undefined }
}

/** 题库错误码（UI 层映射 errors.* 文案，015 §6.5：异常不直接进界面） */
export type BankErrorCode = 'bankMissing' | 'bankNotJson' | 'bankParseFailed'

/** 携带错误码与插值参数的题库异常；code 是 errors.* 语言包 key 的尾段 */
export class BankError extends Error {
  code: BankErrorCode
  status?: number
  url?: string

  constructor(code: BankErrorCode, detail: { status?: number; url?: string } = {}) {
    super(code)
    this.name = 'BankError'
    this.code = code
    this.status = detail.status
    this.url = detail.url
  }
}

/** 取一个 manifest URL，统一校验状态/内容类型/解析；失败抛 BankError */
async function fetchManifest(url: string): Promise<Manifest> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new BankError('bankMissing', { status: res.status, url })
  }
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    // 常见于 SPA 回退把缺失的 manifest 改写成了 index.html
    throw new BankError('bankNotJson', { url })
  }
  try {
    return (await res.json()) as Manifest
  } catch {
    throw new BankError('bankParseFailed', { url })
  }
}

/**
 * 加载题库。029 M1 起优先加载分层产物 core（名录 + 首图首音，约 1.7MB，
 * 取代原先 12MB 完整 manifest）；core 不存在时回退完整 manifest（旧部署/离线夹具兼容）。
 * 生产环境优先走 Worker 的 `/api/manifest`（B3），失败自动回退静态文件。
 */
export async function loadBank(): Promise<Manifest> {
  if (cache) return cache
  const base = import.meta.env.BASE_URL
  const coreUrl = `${base}data/manifest-core.json`
  const staticUrl = `${base}data/manifest.json`
  const urls = import.meta.env.PROD
    ? ['/api/manifest-core', coreUrl, staticUrl]
    : [coreUrl, staticUrl]
  let lastError: unknown
  for (const url of urls) {
    try {
      const m = await fetchManifest(url)
      cache = m
      buildSpeciesIndex(cache)
      return cache
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof BankError
    ? lastError
    : new BankError('bankMissing', { url: staticUrl })
}

/** 测试用：清空缓存 */
export function _resetBankCache() {
  cache = null
  speciesIndex = null
  nameIndex = null
  assetCache.clear()
  bucketLoaded.clear()
  bucketInflight.clear()
}
