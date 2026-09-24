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
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `题库不存在（HTTP ${res.status}）。请确认构建时已运行 \`npm run bank\` 生成 ${url}`,
    )
  }
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    // 常见于 SPA 回退把缺失的 manifest 改写成了 index.html
    throw new Error(
      '题库返回的不是 JSON（被回退成了 HTML）。说明构建时没有生成题库，请在构建命令中加入 `npm run bank`。',
    )
  }
  try {
    cache = (await res.json()) as Manifest
  } catch {
    throw new Error('题库 JSON 解析失败，文件可能损坏，请重新运行 `npm run bank`。')
  }
  return cache
}

/** 测试用：清空缓存 */
export function _resetBankCache() {
  cache = null
}
