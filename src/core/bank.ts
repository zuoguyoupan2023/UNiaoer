import type { MediaAsset } from '@/types'
import { DEFAULT_CATEGORY, getCategory, type CategoryId } from './categories'

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
  category: CategoryId
  policy: string
  mediaMode: string
  total: number
  stats: { withImage: number; withAudio: number }
  species: BankSpecies[]
}

const cache = new Map<string, Manifest>()

/** 加载指定类群的题库（缺省为鸟） */
export async function loadBank(category: CategoryId = DEFAULT_CATEGORY): Promise<Manifest> {
  const hit = cache.get(category)
  if (hit) return hit

  const file = getCategory(category).bankFile
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `题库不存在，请先运行 \`npm run bank\` 生成 public/data/${file}`
        : `题库加载失败（HTTP ${res.status}）`,
    )
  }
  const manifest = (await res.json()) as Manifest
  manifest.category ??= DEFAULT_CATEGORY
  cache.set(category, manifest)
  return manifest
}

/** 测试用：清空缓存 */
export function _resetBankCache() {
  cache.clear()
}
