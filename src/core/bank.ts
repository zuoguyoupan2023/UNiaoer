import type { MediaAsset } from '@/types'

/** 题库中单个物种（来自构建脚本生成的 manifest） */
export interface BankSpecies {
  id: string
  nameZh: string
  nameSci: string
  family: string
  commonness: number
  desc: string
  location: string
  habit: string
  image: MediaAsset | null
  audio: MediaAsset | null
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

/** 加载题库（构建脚本产物 public/data/manifest.json） */
export async function loadBank(): Promise<Manifest> {
  if (cache) return cache
  const url = `${import.meta.env.BASE_URL}data/manifest.json`
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? '题库不存在，请先运行 `npm run bank` 生成 public/data/manifest.json'
        : `题库加载失败（HTTP ${res.status}）`,
    )
  }
  cache = (await res.json()) as Manifest
  return cache
}

/** 测试用：清空缓存 */
export function _resetBankCache() {
  cache = null
}
