import type { MediaType, Question, Tier } from '@/types'
import type { BankSpecies } from './bank'

export interface BuildOptions {
  type: MediaType
  count?: number
  optionCount?: number
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

/** 选出干扰项：优先同科（更难），不足则用其他物种补足，保证去重 */
export function pickDistractors(target: BankSpecies, pool: BankSpecies[], n: number): string[] {
  const others = pool.filter((s) => s.id !== target.id)
  const sameFamily = others.filter((s) => s.family && s.family === target.family)
  const different = others.filter((s) => !sameFamily.includes(s))

  const picked: string[] = []
  const used = new Set<string>([target.nameZh])
  for (const s of [...shuffle(sameFamily), ...shuffle(different)]) {
    if (picked.length >= n) break
    if (used.has(s.nameZh)) continue
    used.add(s.nameZh)
    picked.push(s.nameZh)
  }
  return picked
}

/**
 * 从题库构建一轮题目。
 * 只使用具备所需媒体（image / audio）的物种；不足时返回实际数量。
 */
export function buildQuestions(bank: BankSpecies[], opts: BuildOptions): Question[] {
  const { type, count = 10, optionCount = 4 } = opts
  const pool = bank.filter((s) => (type === 'image' ? s.image : s.audio))
  const picked = shuffle(pool).slice(0, Math.min(count, pool.length))

  return picked.map((sp, i) => {
    const media = (type === 'image' ? sp.image : sp.audio)!
    const distractors = pickDistractors(sp, pool, Math.max(0, optionCount - 1))
    return {
      id: `${sp.id}-${type}-${i}`,
      tier: (sp.commonness >= 1 && sp.commonness <= 4 ? sp.commonness : 2) as Tier,
      type,
      media,
      answer: sp.nameZh,
      sci: sp.nameSci,
      family: sp.family,
      options: shuffle([sp.nameZh, ...distractors]),
      answerMode: 'choice',
    }
  })
}
