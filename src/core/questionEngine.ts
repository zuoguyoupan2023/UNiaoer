import type { MediaAsset, MediaType, Question, Tier } from '@/types'
import { speciesName, type BankSpecies } from './bank'
import { TIERS, type DistractorStrategy } from './difficulty'

export interface BuildOptions {
  type: MediaType
  count?: number
  tier?: Tier
  /** A2 赛制选题池（013 §4）：只从这个物种集合出题（干扰项仍取全库）；
   *  池上仍按档位筛常见度，样本不足时放宽到池内全部；缺省全库 */
  speciesPool?: ReadonlySet<string>
  /** 出题语种（015 §6.1）：'en' 时答案/选项优先 nameEn，缺失回退学名；缺省中文 */
  locale?: string
  /**
   * 029 M4:干扰项来源池（缺省 = 从 bank 的素材池取）。
   * 在线出题（/api/questions）时传入「服务端返回的目标种 + 名字候选」——
   * 名字候选无素材、只用于选项，故不能走 mediaPool 过滤。
   */
  distractorPool?: BankSpecies[]
  /**
   * 036：**地区档位表**（省级常见度，见 core/provinceCommonness.ts）。
   * 提供时用它替代全局 `sp.commonness` 做档位筛选——同一只鸟在不同省份的
   * "常见/稀有"不同（北京天天见的鸟，在某县可能是罕见旅鸟）。
   * 语义（2026-10-09 定稿，D-036-8）：表里有该物种 → 用地区档位；
   * 表里没有 → **视为本地罕见，不参与筛选**（排除式，不回退全局 commonness）；
   * 表内不足 count → 放宽到表内其余档位；表内全空才兜底整池（绝不出空）。
   */
  regionTiers?: Map<string, number> | null
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

/** 干扰项（名字 + 物种 id；id 供错选记录按 locale 解析，015 #1） */
export interface DistractorPair {
  id: string
  name: string
}

/** 按策略选出干扰项（去重，不含答案；nameOf 决定选项语种，缺省中文名） */
export function pickDistractorPairs(
  target: BankSpecies,
  pool: BankSpecies[],
  n: number,
  strategy: DistractorStrategy = 'mixed',
  nameOf: (s: BankSpecies) => string = (s) => s.nameZh,
): DistractorPair[] {
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

  const picked: DistractorPair[] = []
  const used = new Set<string>([nameOf(target)])
  for (const s of ordered) {
    if (picked.length >= n) break
    const name = nameOf(s)
    if (used.has(name)) continue
    used.add(name)
    picked.push({ id: s.id, name })
  }
  return picked
}

/** 按策略选出干扰项名字（pickDistractorPairs 的便捷封装，兼容旧调用） */
export function pickDistractors(
  target: BankSpecies,
  pool: BankSpecies[],
  n: number,
  strategy: DistractorStrategy = 'mixed',
  nameOf: (s: BankSpecies) => string = (s) => s.nameZh,
): string[] {
  return pickDistractorPairs(target, pool, n, strategy, nameOf).map((p) => p.name)
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
 * - speciesPool（A2 赛制）：题目只取池内物种，池上仍按档位筛常见度（不足放宽到池）
 *
 * 地区档位语义（036 / D-036-8，2026-10-09 定稿）：
 *   表里**有**该物种 → 用地区档位（本地常见度）；
 *   表里**没有**该物种 → 视为"本地罕见"，**不参与档位筛选**（排除式），
 *     不会因为它"全球常见（2–3 档）"就被放进该省题池。
 *
 *   为什么不能回退全局 commonness（原语义，实测暴露的问题）：
 *   省表只覆盖"该省有记录"的物种；不在表里最常见的原因就是**该省罕见/无记录**
 *   （GBIF 中国仅 1 条的笼养逃逸噪声如长尾鹦鹉，以及西南分布种黄颈凤鹛混进北京轮次）。
 *   回退全局会把"本地没有的鸟"当"本地常见鸟"出题，语义方向相反（docs/036 §10）。
 *
 *   出池规则（保证"每轮尽量满 count 题"且不出本地没有的鸟）：
 *     ① 严格档位（cfg.commonness）物种 ≥ count → 只用严格档位；
 *     ② 不足 count → 严格档位 ∪ **表内其余档位**（本地罕见也比外地鸟贴近语义）；
 *     ③ 表内一个都没有 → 全池（绝不出空；仅数据缺失时发生）。
 *   无地区表（离线/分片缺失）→ 全局 commonness 语义（保持旧行为）。
 *
 * 轮内不重复：`pool` 内物种 id 唯一，`picked` 取样天然无重复（同一轮每只鸟最多一次）；
 *   不同轮次之间允许重复（"再来一轮"复用候选池是预期行为，见 onlinePool.ts 头注释）。
 */
export function buildQuestions(bank: BankSpecies[], opts: BuildOptions): Question[] {
  const { type, count = 10, tier = 2, speciesPool, locale, distractorPool, regionTiers } = opts
  const cfg = TIERS[tier]
  const full = mediaPool(bank, type)
  // 干扰项池：默认与出题池同源（本地模式）；在线模式传入服务端候选（含无素材的名字条目）
  const dPool = distractorPool && distractorPool.length ? distractorPool : full
  const hasRegion = !!regionTiers?.size

  /** 构造出题池：严格档位优先，不足 count 用表内其余档位补齐（绝不引入表外物种） */
  const buildPool = (candidates: BankSpecies[]): BankSpecies[] => {
    if (!hasRegion) {
      // 无地区表：全局 commonness（旧行为；样本不足放宽到全部，绝不出空）
      const tiered = candidates.filter((s) => cfg.commonness.includes(s.commonness))
      return tiered.length >= Math.min(count, 4) ? tiered : candidates
    }
    const strict: BankSpecies[] = []
    const localRest: BankSpecies[] = []
    for (const s of candidates) {
      const t = regionTiers!.get(s.id)
      if (t == null) continue // 表外 = 本地罕见/无记录 → 剔除
      if (cfg.commonness.includes(t)) strict.push(s)
      else localRest.push(s)
    }
    if (strict.length >= count) return strict
    const union = strict.concat(localRest)
    return union.length ? union : candidates // 表内全空才兜底整池（绝不出空）
  }

  let pool: BankSpecies[]
  if (speciesPool) {
    // 池上仍按档位筛常见度；样本不足放宽到池内全部（013 §4.2 标准赛也允许难度筛选）
    pool = buildPool(full.filter((s) => speciesPool.has(s.id)))
  } else {
    pool = buildPool(full)
  }
  // 轮内不重复（用户 2026-10-09 定稿原则）：按物种 id 去重后取样——
  // 同一轮里每只鸟最多出现一次；不同轮次之间允许重复（"再来一轮"复用候选池是预期行为）。
  const seen = new Set<string>()
  const unique = pool.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
  const picked = shuffle(unique).slice(0, Math.min(count, unique.length))

  const otherType: MediaType = type === 'image' ? 'audio' : 'image'
  return picked.map((sp, i) => {
    const media = pickMedia(sp, type, cfg.mediaPoolSize)!
    const distractors = pickDistractorPairs(
      sp,
      dPool,
      Math.max(0, cfg.optionCount - 1),
      cfg.distractor,
      (s) => speciesName(s, locale),
    )
    // 名字与 id 成对洗牌，保证 optionIds 与 options 一一对应
    const optionPairs = shuffle([{ id: sp.id, name: speciesName(sp, locale) }, ...distractors])
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
      options: optionPairs.map((p) => p.name),
      optionIds: optionPairs.map((p) => p.id),
      answerMode: 'choice',
      timeLimitSec: cfg.timeLimitSec,
    }
  })
}
