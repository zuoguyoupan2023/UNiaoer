/**
 * 092 记忆挑战鸟出题引擎（docs/092）：12 对「图/音 ↔ 鸟名」翻牌配对。
 *
 * 与经典卷的关键差异：
 *  - **没有干扰项**——每对 = 一个物种的一张媒体牌（A）+ 一张名字牌（B），
 *    判定"配上"的是两个 speciesId 相等，不需要 distractor 体系；
 *  - 每对只用**首选素材**（标准照/最佳录音，TIERS[8].mediaPoolSize=1）；
 *  - 池子语义与经典卷同构：先 mediaPool 再 filterByNameMode（051 S1 的 D1 决策顺序不变），
 *    赛制池（standard/review/reinforce/random）照常收窄答案池；
 *  - **对数可以少于目标**（小地区/小赛制池凑不满 12 对）：返回实际对数，
 *    调用方经 quiz.lastBuild 的 built/want 差值向用户**明确说明**（绝不静默，docs/092 §2.1）。
 */
import type { MediaAsset, MediaType, NameMode, Question } from '@/types'
import type { BankSpecies } from './bank'
import { MEMORY_PAIRS } from './difficulty'
import {
  assetsOf,
  ensureMedia,
  filterByNameMode,
  mediaPool,
  nameByMode,
  shuffle,
  type BuildStats,
} from './questionEngine'

export interface BuildMemoryOptions {
  /** A 牌类型：'image' 看图版 / 'audio' 听音版 */
  type: MediaType
  /** 目标对数（缺省 12；盘面常量 MEMORY_PAIRS） */
  pairs?: number
  /** 名字牌卷别（zh/en/sci）；`usableInNameMode` 保证卷内名字非空 */
  nameMode?: NameMode
  /** 赛制选题池（013 §4）：配对物种只从这个集合取 */
  speciesPool?: ReadonlySet<string>
  /** 072-a 观测：组题计数回调（与经典卷同语义） */
  onStats?: (s: BuildStats) => void
}

/** 一对牌：A = 媒体，B = 名字（同 speciesId 即配上） */
export interface MemoryPair {
  speciesId: string
  /** 名字牌文案（卷别权威 nameByMode，不做跨语言回退） */
  name: string
  sci: string
  family: string
  /** A 牌素材（首选；看图版=图，听音版=音） */
  media: MediaAsset
}

/**
 * 构建一轮记忆翻牌的配对集合。
 * 轮内去重双保险：物种 id 唯一 + **显示名唯一**（同卷两名同字会让两张名字牌不可分辨，
 * 配对语义被破坏——按名字先到先得跳过）。
 */
export async function buildMemoryPairs(
  bank: BankSpecies[],
  opts: BuildMemoryOptions,
): Promise<MemoryPair[]> {
  const { type, pairs = MEMORY_PAIRS, nameMode = 'zh', speciesPool, onStats } = opts
  const pool = filterByNameMode(mediaPool(bank, type), nameMode)
  const scoped = speciesPool ? pool.filter((s) => speciesPool.has(s.id)) : pool
  const want = Math.min(pairs, scoped.length)
  onStats?.({ candidates: bank.length, unique: scoped.length, enriched: 0, want })

  const ordered = shuffle(scoped)
  const out: MemoryPair[] = []
  const usedNames = new Set<string>()
  const usedIds = new Set<string>()
  for (const sp of ordered) {
    if (out.length >= want) break
    // ensureMedia 可能返回带素材的新对象（分片懒加载），必须用它而不是原 species
    const resolved = await ensureMedia(sp, type)
    const assets = assetsOf(resolved, type)
    if (!assets.length) continue // 标记可玩但实际取不到素材 → 跳过该候选
    const name = nameByMode(sp, nameMode)
    if (!name || usedNames.has(name)) continue
    usedIds.add(sp.id)
    usedNames.add(name)
    out.push({
      speciesId: sp.id,
      name,
      sci: sp.nameSci,
      family: sp.family,
      media: assets[0]!,
    })
  }
  onStats?.({ candidates: bank.length, unique: scoped.length, enriched: out.length, want })
  return out
}

/** MemoryPair → Question（沿用 store 的轮次形态：每题 = 一对；options 留空，无作答语义） */
export async function buildMemoryQuestions(
  bank: BankSpecies[],
  opts: BuildMemoryOptions,
): Promise<Question[]> {
  const { type, nameMode = 'zh' } = opts
  const pairs = await buildMemoryPairs(bank, opts)
  return pairs.map((p, i) => ({
    id: `${p.speciesId}-memory-${type}-${i}`,
    tier: 8,
    type,
    media: p.media,
    assets: [p.media],
    crossAssets: [],
    answer: p.name,
    sci: p.sci,
    family: p.family,
    options: [],
    optionIds: [],
    answerMode: 'choice' as const,
    nameMode,
  }))
}
