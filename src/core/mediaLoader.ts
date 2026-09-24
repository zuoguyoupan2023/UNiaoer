import type { MediaType, Question } from '@/types'

const preloaded = new Set<string>()

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

/** 预加载从 from 开始的 n 道题的素材 */
export function preloadQuestions(questions: Question[], from: number, n = 2) {
  for (let i = from; i < Math.min(from + n, questions.length); i++) {
    const q = questions[i]
    if (q) preloadAsset(q.type, q.media.url)
  }
}

/** 测试用：清空记录 */
export function _resetPreloadCache() {
  preloaded.clear()
}
