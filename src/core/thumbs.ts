/**
 * 观鸟页卡片缩略图/鸣声索引（`data/thumbs.json`，由 `npm run thumbs` 生成）。
 *
 * 名单层（manifest-meta）不含媒体字段，卡片要显示缩略图、就地播放鸣声，
 * 只能从 assets 分片拿 URL；但一国物种散布在数百个分片里，逐片拉取不现实。
 * 本模块懒加载一次轻量索引（物种 id → 首图缩略/首音的 `media/<id>/` 内路径段），
 * 拼出最终 URL。路径段来自分片真实数据——媒体纠错换槽位（image-6/7/8…）后
 * 重跑 `npm run thumbs` 即保持一致，不会硬拼出已停用的坏图。
 */
const DATA = `${import.meta.env.BASE_URL}data`
const INDEX_URL = `${DATA}/thumbs.json`

export interface ThumbsIndex {
  /** 媒体域名前缀，如 `https://bird.wewalk.world/media/` */
  base: string
  /** 物种 id → 首图缩略路径段，如 `image-1.thumb.webp` */
  thumb: Record<string, string>
  /** 物种 id → 首音路径段，如 `audio-1.mp3`（含 .wav/.m4a 直连源站的情形） */
  audio: Record<string, string>
}

let indexCache: Promise<ThumbsIndex | null> | null = null

/** 测试用：清空加载缓存（与其他 core 模块的 _reset 惯例一致） */
export function _resetThumbsCache(): void {
  indexCache = null
}

const fetchJson = (url: string): Promise<ThumbsIndex | null> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<ThumbsIndex>) : null))
    .catch(() => null)

/** 加载索引；失败返回 null（卡片退化为无缩略图/无播放按钮，不阻塞页面） */
export function loadThumbs(): Promise<ThumbsIndex | null> {
  indexCache ??= fetchJson(INDEX_URL)
  return indexCache
}

/** 该物种的缩略图 URL（无图/索引未就绪 → null） */
export function thumbUrlOf(index: ThumbsIndex | null, id: string | null | undefined): string | null {
  const seg = id ? index?.thumb[id] : null
  return seg && index ? `${index.base}${id}/${seg}` : null
}

/** 该物种的首音 URL（无音/索引未就绪 → null） */
export function audioUrlOf(index: ThumbsIndex | null, id: string | null | undefined): string | null {
  const seg = id ? index?.audio[id] : null
  return seg && index ? `${index.base}${id}/${seg}` : null
}
