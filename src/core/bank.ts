import type { MediaAsset } from '@/types'

/** 题库中单个物种（来自构建脚本生成的 manifest） */
export interface BankSpecies {
  id: string
  nameZh: string
  nameSci: string
  /** 英文俗名（i18n，manifest v2 起） */
  nameEn?: string
  /** iNat taxon id（稳定主键，manifest v2 起） */
  taxonId?: number
  family: string
  commonness: number
  /** 榜单排名 / 是否中国榜（manifest v2 起） */
  rankWorld?: number | null
  rankCN?: number | null
  inCN?: boolean | null
  desc: string
  location: string
  habit: string
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
}

let cache: Manifest | null = null

/** 物种显示名（015 §6.1）：en 优先 nameEn，缺失回退学名；zh 用 nameZh */
export function speciesName(sp: BankSpecies, locale?: string): string {
  if (locale === 'en') return sp.nameEn || sp.nameSci
  return sp.nameZh
}

/** speciesId → 物种索引（loadBank 后构建；旧记录 speciesId 可能是媒体 URL，查不到即回退） */
let speciesIndex: Map<string, BankSpecies> | null = null

function buildSpeciesIndex(bank: Manifest) {
  speciesIndex = new Map(bank.species.map((s) => [s.id, s]))
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

/** 加载题库（构建脚本产物 public/data/manifest.json） */
export async function loadBank(): Promise<Manifest> {
  if (cache) return cache
  const url = `${import.meta.env.BASE_URL}data/manifest.json`
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
    cache = (await res.json()) as Manifest
  } catch {
    throw new BankError('bankParseFailed', { url })
  }
  buildSpeciesIndex(cache)
  return cache
}

/** 测试用：清空缓存 */
export function _resetBankCache() {
  cache = null
  speciesIndex = null
}
