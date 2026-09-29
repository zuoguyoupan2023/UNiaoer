/** 难度档位：1 入门 / 2 进阶 / 3 高手 / 4 专家 / 5 地狱（随机鸟鸣干扰，R23） */
export type Tier = 1 | 2 | 3 | 4 | 5

/** 题型 */
export type MediaType = 'image' | 'audio'

/** 作答方式 */
export type AnswerMode = 'choice' | 'input'

/** 许可策略：strict = 仅开放许可(CC0/BY/BY-SA)；relaxed = 放行全部(含 NC，非商业项目) */
export type LicensePolicy = 'strict' | 'relaxed'

/** 自动进入下一题的时机 */
export type AutoNextMode = 'correct' | 'all' | 'manual'

/** 物种 */
export interface Species {
  id: string // 'turdus-merula'
  nameZh: string // 乌鸫
  nameSci: string // Turdus merula
  family: string // 鸫科
  commonness: Tier // 常见度 → 难度
  desc: string
  location: string
  habit: string
}

/** 媒体素材（必须携带署名信息） */
export interface MediaAsset {
  id?: string
  speciesId: string
  type: MediaType
  /** 图片=full（≤1280px，答题主图）；音频=mp3。不可转码/下载失败时为原始文件或源站地址 */
  url: string
  /** 图片多分辨率（C2）：缩略图（320px），小尺寸展示用 */
  thumbUrl?: string
  /** 图片多分辨率（C2）：母版原分辨率，点击放大与海报背景用 */
  xlUrl?: string
  /** 图片多分辨率（C2）：AVIF 版 full，浏览器支持时优先 */
  avifUrl?: string
  /** 图片多分辨率（C2）：ThumbHash（base64），解码出模糊占位图 */
  thumbhash?: string
  license: string
  licenseUrl?: string
  /** 原始许可标识（XC 的完整 URL / iNat 短码） */
  licenseRaw?: string
  author: string
  source: string // 'Xeno-canto' | 'iNaturalist' | ...
  sourceUrl: string
  /** 源站直链（下载母版前的 URL；与官网比对用，manifest v2 起） */
  originalUrl?: string
  /** 源站稳定 id（iNat observation/photo id 或 XC recording id，manifest v2 起） */
  sourceId?: string
  quality?: 'A' | 'B' | 'C' | 'D' | 'E'
  durationSec?: number
  /** ND 等不可转码的素材为 false（占位/派生均不做） */
  transcode?: boolean
  /** 来自人工覆盖表 */
  overridden?: boolean
}

/** 题目 */
export interface Question {
  id: string
  tier: Tier
  type: MediaType
  media: MediaAsset
  /** 同种同类型全部素材（best-first，含当前 media）；C3 同种多素材查看（R8） */
  assets?: MediaAsset[]
  answer: string
  sci: string
  family: string
  options: string[]
  answerMode: AnswerMode
  timeLimitSec?: number
}
