import type { MediaType, Question, Tier } from '@/types'
import type { BankSpecies } from './bank'
import { TIERS, type DistractorStrategy } from './difficulty'

export interface BuildOptions {
  type: MediaType
  count?: number
  tier?: Tier
  /** E1 错题重练：只从这个物种集合出题（干扰项仍取全库）；空集/无素材时返回空数组 */
  speciesIds?: ReadonlySet<string>
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

/** 按策略选出干扰项（去重，不含答案） */
export function pickDistractors(
  target: BankSpecies,
  pool: BankSpecies[],
  n: number,
  strategy: DistractorStrategy = 'mixed',
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
  const used = new Set<string>([target.nameZh])
  for (const s of ordered) {
    if (picked.length >= n) break
    if (used.has(s.nameZh)) continue
    used.add(s.nameZh)
    picked.push(s.nameZh)
  }
  return picked
}

function mediaPool(bank: BankSpecies[], type: MediaType): BankSpecies[] {
  return bank.filter((s) => (type === 'image' ? s.image : s.audio))
}

/**
 * 从题库构建一轮题目。
 * - 按档位筛常见度（样本不足时放宽到全部）
 * - 选项数量与干扰项策略来自档位配置
 * - speciesIds（错题重练）：题目只取该集合内的物种，不做档位放宽
 */
export function buildQuestions(bank: BankSpecies[], opts: BuildOptions): Question[] {
  const { type, count = 10, tier = 2, speciesIds } = opts
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

  return picked.map((sp, i) => {
    const media = (type === 'image' ? sp.image : sp.audio)!
    const distractors = pickDistractors(sp, full, Math.max(0, cfg.optionCount - 1), cfg.distractor)
    return {
      id: `${sp.id}-${type}-${i}`,
      tier,
      type,
      media,
      answer: sp.nameZh,
      sci: sp.nameSci,
      family: sp.family,
      options: shuffle([sp.nameZh, ...distractors]),
      answerMode: 'choice',
      timeLimitSec: cfg.timeLimitSec,
    }
  })
}
