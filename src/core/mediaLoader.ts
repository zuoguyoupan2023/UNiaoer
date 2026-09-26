import type { MediaAsset, MediaType, Question } from '@/types'

const preloaded = new Set<string>()

// ---- AVIF 能力探测（C2：支持时图片优先走 AVIF） ----
const TINY_AVIF =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgADsgQEAwgMg8f8D///8WfhwB8+ErK42A='

let avifProbe: Promise<boolean> | null = null

/** 探测一次浏览器是否支持 AVIF（结果缓存） */
export function supportsAvif(): Promise<boolean> {
  if (!avifProbe) {
    avifProbe = new Promise((resolve) => {
      if (typeof Image === 'undefined') {
        resolve(false)
        return
      }
      const img = new Image()
      img.onload = () => resolve(img.width > 0)
      img.onerror = () => resolve(false)
      img.src = TINY_AVIF
    })
  }
  return avifProbe
}

/** 该浏览器下最优的图片 URL：AVIF 可用且素材提供时用 AVIF，否则 full */
export async function preferredImageUrl(media: MediaAsset): Promise<string> {
  if (media.avifUrl && (await supportsAvif())) return media.avifUrl
  return media.url
}

/** 预热单个素材：图片走 Image，音频走隐藏 audio（触发浏览器缓存） */
export function preloadAsset(type: MediaType, url: string) {
  if (!url || preloaded.has(url)) return
  preloaded.add(url)
  if (type === 'image') {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
  } else {
    const a = document.createElement('audio')
    a.preload = 'auto'
    a.src = url
  }
}

/** 预加载从 from 开始的 n 道题的素材（图片自动选 AVIF/WebP） */
export async function preloadQuestions(questions: Question[], from: number, n = 2) {
  for (let i = from; i < Math.min(from + n, questions.length); i++) {
    const q = questions[i]
    if (!q) continue
    const url = q.type === 'image' ? await preferredImageUrl(q.media) : q.media.url
    preloadAsset(q.type, url)
  }
}

/** 测试用：清空记录 */
export function _resetPreloadCache() {
  preloaded.clear()
  avifProbe = null
}
