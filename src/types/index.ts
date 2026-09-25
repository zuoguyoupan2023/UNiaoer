/** 难度档位：1 入门 / 2 进阶 / 3 高手 / 4 专家 */
export type Tier = 1 | 2 | 3 | 4

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
  id: string
  speciesId: string
  type: MediaType
  url: string
  license: string
  licenseUrl: string
  author: string
  source: string // 'Xeno-canto' | 'iNaturalist' | ...
  sourceUrl: string
  quality?: 'A' | 'B' | 'C' | 'D' | 'E'
  durationSec?: number
}

/** 题目 */
export interface Question {
  id: string
  tier: Tier
  type: MediaType
  media: MediaAsset
  answer: string
  sci: string
  family: string
  options: string[]
  answerMode: AnswerMode
  timeLimitSec?: number
}
