import type { MediaAsset, MediaType, Question, Tier } from '@/types'
import type { BankSpecies } from './bank'
import { TIERS, type DistractorStrategy } from './difficulty'

export interface BuildOptions {
  type: MediaType
  count?: number
  tier?: Tier
  /** E1 错题重练：只从这个物种集合出题（干扰项仍取全库）；空集/无素材时返回空数组 */
  speciesIds?: ReadonlySet<string>
  /** 出题语种（015 §6.1）：'en' 时答案/选项优先 nameEn，缺失回退学名；缺省中文 */
  locale?: string
}

/** 物种显示名：数据驱动文案按 locale 取（manifest 的 nameEn 缺失时回退学名） */
export function speciesName(sp: BankSpecies, locale?: string): string {
  if (locale === 'en') return sp.nameEn || sp.nameSci
  return sp.nameZh
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

/** 按策略选出干扰项（去重，不含答案；nameOf 决定选项语种，缺省中文名） */
export function pickDistractors(
  target: BankSpecies,
  pool: BankSpecies[],
  n: number,
  strategy: DistractorStrategy = 'mixed',
  nameOf: (s: BankSpecies) => string = (s) => s.nameZh,
): string[] {
  const others = pool.filter((s) => s.id !== target.id)
  const same = others.filter((s) => s.family && s.family === target.family)
  const diff = others.filter((s) => !same.includes(s))

  const shuffledSame = shuffle(same)
  const shuffledDiff = shuffle(diff)

  let ordered: BankSpecies[]
  if (strategy === 'cross') {
    ordered = [...shuffledDiff, ...shuffledSame]
  } else if (strategy === 'same') {
    ordered = [...shuffledSame, ...shuffledDiff]
  } else {
    // mixed：先放 1 个同科，再跨科，最后补同科
    const head = shuffledSame.slice(0, 1)
    ordered = [...head, ...shuffledDiff, ...shuffledSame.slice(1)]
  }

  const picked: string[] = []
  const used = new Set<string>([nameOf(target)])
  for (const s of ordered) {
    if (picked.length >= n) break
    const name = nameOf(s)
    if (used.has(name)) continue
    used.add(name)
    picked.push(name)
  }
  return picked
}

/** 某物种在指定题型下的素材数组（manifest v2 优先，兼容期回退到单张 image/audio） */
export function assetsOf(sp: BankSpecies, type: MediaType): MediaAsset[] {
  const arr = type === 'image' ? sp.images : sp.audios
  if (arr && arr.length) return arr
  const single = type === 'image' ? sp.image : sp.audio
  return single ? [single] : []
}

function mediaPool(bank: BankSpecies[], type: MediaType): BankSpecies[] {
  return bank.filter((s) => assetsOf(s, type).length > 0)
}

/**
 * 分档取材（011 §8）：取前 min(mediaPoolSize, 实际数) 个，L1 只用首选（最佳/标准照），
 * 高档位在池内随机（多样姿态/环境）。素材不足按实际；数组缺省时回退单张。
 */
export function pickMedia(sp: BankSpecies, type: MediaType, poolSize: number): MediaAsset | undefined {
  const assets = assetsOf(sp, type)
  if (!assets.length) return undefined
  const n = Math.max(1, Math.min(poolSize, assets.length))
  if (poolSize <= 1 || n === 1) return assets[0]
  return assets[Math.floor(Math.random() * n)]
}

/**
 * 从题库构建一轮题目。
 * - 按档位筛常见度（样本不足时放宽到全部）
 * - 选项数量与干扰项策略来自档位配置
 * - speciesIds（错题重练）：题目只取该集合内的物种，不做档位放宽
 */
export function buildQuestions(bank: BankSpecies[], opts: BuildOptions): Question[] {
  const { type, count = 10, tier = 2, speciesIds, locale } = opts
  const cfg = TIERS[tier]
  const full = mediaPool(bank, type)

  let pool: BankSpecies[]
  if (speciesIds) {
    pool = full.filter((s) => speciesIds.has(s.id))
  } else {
    const tiered = full.filter((s) => cfg.commonness.includes(s.commonness))
    pool = tiered.length >= Math.min(count, 4) ? tiered : full
  }
  const picked = shuffle(pool).slice(0, Math.min(count, pool.length))

  const otherType: MediaType = type === 'image' ? 'audio' : 'image'
  return picked.map((sp, i) => {
    const media = pickMedia(sp, type, cfg.mediaPoolSize)!
    const distractors = pickDistractors(
      sp,
      full,
      Math.max(0, cfg.optionCount - 1),
      cfg.distractor,
      (s) => speciesName(s, locale),
    )
    // C3（R8）：携带同种两类全部素材，供答题/回顾查看其它图、音（不按档位裁剪——
    // 出题仍严格用第 1/前 3/前 5，画廊只是额外练习资源）
    return {
      id: `${sp.id}-${type}-${i}`,
      tier,
      type,
      media,
      assets: assetsOf(sp, type),
      crossAssets: assetsOf(sp, otherType),
      answer: speciesName(sp, locale),
      sci: sp.nameSci,
      family: sp.family,
      options: shuffle([speciesName(sp, locale), ...distractors]),
      answerMode: 'choice',
      timeLimitSec: cfg.timeLimitSec,
    }
  })
}
