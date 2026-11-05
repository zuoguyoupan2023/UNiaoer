import type { MediaAsset, MediaType, NameMode, Question, Tier } from '@/types'
import { speciesName, loadSpeciesAssets, type BankSpecies } from './bank'
import { TIERS, L6_TIERS, L7_TIERS, timeLimitFor, type DistractorStrategy } from './difficulty'
import { isStarterBird } from './starterBirds'
import { speciesTokens } from './nameTokens'

/** 072-a 观测：组题过程的计数（只用于诊断，不参与判定） */
export interface BuildStats {
  /** 进入组题链路的物种数（= 入参 bank 的长度） */
  candidates: number
  /** 过命名体系/档位/轮内去重后的池大小 */
  unique: number
  /** 其中真正取到素材、进入题目的物种数 */
  enriched: number
  /** 目标题数（min(count, unique)） */
  want: number
}

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
   * 051 S1：**选项命名体系**（默认按 `locale` 推断：'en' → en，否则 zh）。
   *
   * 规则（用户 2026-10-10 拍板 D1）：**某体系下缺名字的种，既不当正确答案，也不当干扰项**。
   * 理由：中文卷里混进英文名选项，等于在告诉测试者"英文的都是干扰项"，
   * 既让题目失去意义，也让"这道题考什么"变得不可判断。
   *
   * 覆盖面（权威层 10,844 种实测）：学名 10,844 · 英文名 10,844 · **中文名仅 5,646**。
   * 因此中文模式会少掉一半物种，但对难度与观感都是必要的代价。
   */
  nameMode?: NameMode
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
  /**
   * 新手福利（2026-10-09）：候选限定在 `STARTER_BIRD_IDS`（喜鹊/麻雀/白头鹎…）。
   * 仅由 quiz store 在「第一轮 + L1」时置 true；池内不足一轮时**自动回退常规 L1**（绝不出空）。
   * 之后照常走 地区档位 → 媒体 → 轮内去重 既有链路（地域自适应，见 starterBirds.ts）。
   */
  starterOnly?: boolean
  /**
   * 072-a 观测：组题计数回调（可选；不改变任何行为）。
   * 用来区分「池子本来就小」与「素材取不到被丢弃」——两者的修法完全不同。
   */
  onStats?: (s: BuildStats) => void
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

/**
 * 099 §3.1 nameSimilar 回退链的候选排序（供经典卷与 L6 共用）：
 * ①同 (色，部位) 组 → ②同色不同部位 → ③同科 → ④其余；桶内各自洗牌。
 * token 来自中英并集 + overrides（nameTokens.speciesTokens，带缓存）。
 */
function orderNameSimilar(target: BankSpecies, others: BankSpecies[]): BankSpecies[] {
  const targetTokens = speciesTokens(target)
  const targetKeys = new Set(targetTokens.map((t) => `${t.color}|${t.part}`))
  const targetColors = new Set(targetTokens.map((t) => t.color))

  const sameGroup: BankSpecies[] = []
  const sameColor: BankSpecies[] = []
  const sameFam: BankSpecies[] = []
  const rest: BankSpecies[] = []
  for (const s of others) {
    let placed = false
    for (const t of speciesTokens(s)) {
      if (targetKeys.has(`${t.color}|${t.part}`)) {
        sameGroup.push(s)
        placed = true
        break
      }
    }
    if (!placed) {
      for (const t of speciesTokens(s)) {
        if (targetColors.has(t.color)) {
          sameColor.push(s)
          placed = true
          break
        }
      }
    }
    if (!placed) {
      if (s.family && s.family === target.family) sameFam.push(s)
      else rest.push(s)
    }
  }
  return [...shuffle(sameGroup), ...shuffle(sameColor), ...shuffle(sameFam), ...shuffle(rest)]
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
  } else if (strategy === 'nameSimilar') {
    // 099 第一批：token 相似优先，同科保留在回退链第③层
    ordered = orderNameSimilar(target, others)
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

/**
 * 某物种在该题型下**是否有可用素材**（有可用媒体）。
 * S6：名单来自 meta（不含媒体），故先看内联素材，无则看 `playableImage/playableAudio` 标记
 * （构建期已按「有图/有音」烘焙）。真正的素材在 `ensureMedia` 里按需从 assets 分片取。
 */
export function speciesPlayable(sp: BankSpecies, type: MediaType): boolean {
  const inline = type === 'image' ? sp.images?.length || (sp.image ? 1 : 0) : sp.audios?.length || (sp.audio ? 1 : 0)
  if (inline) return true
  return type === 'image' ? sp.playableImage === true : sp.playableAudio === true
}

/** 题型 → 有素材物种池（092 起导出：memoryEngine 复用同一"素材可用"口径） */
export function mediaPool(bank: BankSpecies[], type: MediaType): BankSpecies[] {
  return bank.filter((s) => speciesPlayable(s, type))
}

/**
 * S6：为出题种补齐素材——内联缺失时按需从 assets 分片取。
 * （092 起导出：memoryEngine.buildMemoryPairs 复用同一"标记有素材但分片缺失则跳过"链路。）
 */
export async function ensureMedia(sp: BankSpecies, type: MediaType): Promise<BankSpecies> {
  if (assetsOf(sp, type).length) return sp
  const a = await loadSpeciesAssets(sp.id).catch(() => null)
  if (!a) return sp
  return {
    ...sp,
    images: a.images ?? sp.images,
    audios: a.audios ?? sp.audios,
    image: a.images?.[0] ?? sp.image ?? null,
    audio: a.audios?.[0] ?? sp.audio ?? null,
  }
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
/**
 * 051 S1：某物种在当前 `nameMode` 下**是否可用**。
 *
 * **严格匹配该体系自己的名字字段，不做跨语言回退**：中文卷只收有名中文名的种。
 * 若允许"回退学名/英文名"，中文卷里就会混进英文名选项——等于在告诉测试者
 * "英文的都是干扰项"，题目失去意义（用户 2026-10-10 拍板 D1）。
 *
 * 覆盖面（权威层 10,844 种实测）：学名 10,844 · 英文名 10,844 · **中文名 5,646**。
 */
export function usableInNameMode(sp: BankSpecies, mode: NameMode): boolean {
  if (mode === 'sci') return !!sp.nameSci
  if (mode === 'en') return !!sp.nameEn
  return !!sp.nameZh
}

/** 按命名体系过滤物种列表（出题池与干扰项池共用；保持原顺序） */
export function filterByNameMode(list: BankSpecies[], mode: NameMode): BankSpecies[] {
  return list.filter((s) => usableInNameMode(s, mode))
}

export async function buildQuestions(bank: BankSpecies[], opts: BuildOptions): Promise<Question[]> {
  const {
    type,
    count = 10,
    tier = 2,
    speciesPool,
    locale,
    nameMode = locale === 'en' ? 'en' : 'zh',
    distractorPool,
    regionTiers,
    starterOnly,
    onStats,
  } = opts
  const cfg = TIERS[tier]
  // 051 S1：**先按命名体系过滤，再进后续所有链路**（档位筛选、干扰项、新手池都基于过滤后的集合）
  const full = filterByNameMode(mediaPool(bank, type), nameMode)
  // 干扰项池：默认与出题池同源（本地模式）；在线模式传入服务端候选（含无素材的名字条目）
  const rawDPool = distractorPool && distractorPool.length ? distractorPool : full
  const dPool = filterByNameMode(rawDPool, nameMode)
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
  const candidates = speciesPool ? full.filter((s) => speciesPool.has(s.id)) : full
  /**
   * 新手福利（2026-10-09）：首轮 L1 把候选收窄到"人人皆知的最常见鸟"（starterBirds.ts）。
   *
   * 顺序很重要——**先按地区表收窄、再取新手池**：
   *   · 新手池先与本地物种求交（`starterLocal`），保证不会把外地新手鸟塞给本地用户；
   *   · 交集能撑满一轮（≥ count）才启用；**不足则回退常规 L1**（仍是本地池）——
   *     实测 49 个省的本省新手鸟 < 10（AU-NT 仅 2），直接放宽会出一轮 5–8 题的短轮，
   *     违反"每轮最少十道题"（用户 2026-10-09 定稿）。
   *   · 收窄只是前置过滤，后面照常走 地区档位 → 媒体 → 轮内去重 的既有链路。
   */
  if (starterOnly && tier === 1) {
    const localBase = hasRegion ? candidates.filter((s) => regionTiers!.has(s.id)) : candidates
    const starterLocal = (localBase.length ? localBase : candidates).filter((s) => isStarterBird(s.id))
    pool = starterLocal.length >= count ? buildPool(starterLocal) : buildPool(candidates)
  } else {
    pool = buildPool(candidates)
  }
  // 轮内不重复（用户 2026-10-09 定稿原则）：按物种 id 去重后取样——
  // 同一轮里每只鸟最多出现一次；不同轮次之间允许重复（"再来一轮"复用候选池是预期行为）。
  const seen = new Set<string>()
  const unique = pool.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
  const want = Math.min(count, unique.length)
  const ordered = shuffle(unique)

  const otherType: MediaType = type === 'image' ? 'audio' : 'image'
  // S6：名单（meta）不含媒体 → 只对入选物种按需拉取 assets 分片（在线路径已带媒体则跳过）。
  // P0（2026-10-19 白屏事故）：meta 的 playable 标记可能与 assets 分片不一致，或分片请求失败
  // （loadSpeciesAssets 的 catch 是静默的）。此时绝不能把 undefined 当"有素材"发进题目 →
  // 只保留真正取到素材的种，不足继续往后取；池里实在不够就少出几题（宁可少一题，绝不发空题）。
  const enriched: BankSpecies[] = []
  for (let cursor = 0; cursor < ordered.length && enriched.length < want; ) {
    // 一次多取几个，补偿"标记有素材但实际无素材"的种
    const batchSize = Math.min(want - enriched.length + 3, ordered.length - cursor)
    const batch = ordered.slice(cursor, cursor + batchSize)
    cursor += batchSize
    const resolved = await Promise.all(batch.map((sp) => ensureMedia(sp, type)))
    for (const sp of resolved) {
      if (assetsOf(sp, type).length) enriched.push(sp)
      if (enriched.length >= want) break
    }
  }
  if (enriched.length < want) {
    // dev-only 日志：用英文，避免触发 015 §8 的「src/** 不得有未包裹 CJK 字面量」门禁
    console.warn(
      `[questionEngine] not enough media-backed species: wanted ${want}, built ${enriched.length}` +
        ` (meta "playable" flag disagrees with assets shards, or a shard failed to load)`,
    )
  }
  // 072-a 观测：把「池子多大 / 素材丢了几只」交给调用方记录（不影响返回结果）
  onStats?.({ candidates: bank.length, unique: unique.length, enriched: enriched.length, want })

  return enriched.map((sp, i) => {
    // 上面已按 assetsOf(sp, type).length 过滤，此处的 media 必定存在
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
      nameMode,
      family: sp.family,
      options: optionPairs.map((p) => p.name),
      optionIds: optionPairs.map((p) => p.id),
      answerMode: 'choice',
      timeLimitSec: timeLimitFor(cfg, type),
    }
  })
}

// ---------------------------------------------------------------------------
// L6 半鸟人（docs/081 §7 / docs/085 §5）：名字作题干、媒体作选项的反向辨认题。
// ---------------------------------------------------------------------------

export interface BuildNameOptions {
  type: MediaType
  count?: number
  /**
   * 卷别（docs/085 D-1/D-2）：缺省 'zh'（调用方按界面语言决定传 zh/en）；学名卷
   * （D-2 的 switch）暂未在 UI 露出（087 §4.8 回退为纯难度档后挂起），引擎能力保留。
   * 判分体系锁定（D-8）：题干与全部选项都来自同一卷别的名字体系，不做跨语言回退。
   */
  nameMode?: NameMode
  /**
   * 赛制选题池（013 §4；087 §4.8：L6 与 L1–L5 同为难度档，介绍页的赛制选择对它生效）——
   * 答案物种只从这个集合取；干扰项仍取全池（与经典卷同语义）。
   */
  speciesPool?: ReadonlySet<string>
  /** 072-a 观测：组题计数回调（与经典卷同语义） */
  onStats?: (s: BuildStats) => void
}

/**
 * 卷别 → 该卷显示名（**卷别权威**，与 speciesName 的 locale 链无关——
 * D-8 判分体系锁定：en 卷必须出英文名，即使调用方传了 zh locale；
 * 回退链与 bank.speciesName 同构，`usableInNameMode` 已保证主字段非空）。
 * （092 起导出：memoryEngine 的名字牌与 L6 选项共用同一卷别权威。）
 */
export function nameByMode(s: BankSpecies, mode: NameMode): string {
  if (mode === 'sci') return s.nameSci
  if (mode === 'en') return s.nameEn || s.nameSci || s.nameZh
  return s.nameZh || s.nameEn || s.nameSci
}

/**
 * 构建一轮 L6 题（名字 → 6 图 / 4 音）。
 *
 * 与经典卷 buildQuestions 的关键差异：
 *  - **全部选项都要有真实素材**（选项即媒体）：干扰项也从「可播 ∧ 有本卷名字」的池里出，
 *    取不到素材的候选直接跳过、从后续候选补位——宁可少一题，绝不出空选项；
 *  - 干扰项策略固定 same（同科为主，docs/081 §7「多选项都是同科鸟」），素材不够时自然
 *    回落到跨科（与 pickDistractorPairs 的 same 语义一致）；
 *  - 不走在线候选（服务端干扰项无素材，当不了选项）、无地区档位/赛制池（L6 无档位选择）；
 *  - 每题选项数/限时按题型取 L6_TIERS（图 6 选项 15s / 音 4 选项 20s）。
 *
 * 池子语义与经典卷共用：先 mediaPool 再 filterByNameMode（051 S1 的 D1 决策顺序不变，
 * docs/084 §4-3）；`usableInNameMode` 已保证卷内名字非空，选项名/答案名不会是空串。
 */
export async function buildNameQuestions(
  bank: BankSpecies[],
  opts: BuildNameOptions,
): Promise<Question[]> {
  const { type, count = 10, nameMode = 'zh', speciesPool, onStats } = opts
  const cfg = L6_TIERS[type]
  const pool = filterByNameMode(mediaPool(bank, type), nameMode)
  // 013 §4 语义：**答案只出赛制池，干扰项仍取全池**（与经典 buildQuestions 同构）。
  // 门槛：池子（答案∪全量）要能拼出至少一个整题（optionCount 个选项），答案池非空即可
  // ——复活赛等小池也能出题（答案 1 种 + 干扰项从全池补，072-a 短轮说明兜底）。
  const scoped = speciesPool ? pool.filter((s) => speciesPool.has(s.id)) : pool
  const buildable = scoped.length >= 1 && pool.length >= cfg.optionCount
  const want = buildable ? Math.min(count, scoped.length) : 0
  onStats?.({ candidates: bank.length, unique: scoped.length, enriched: 0, want })

  // 轮内按物种 id 去重（meta 名单理论上唯一，这里与经典卷同则保险）；
  // 两个列表各自独立去重——干扰项池含答案物种是预期（见下 others 过滤）
  const dedup = (list: BankSpecies[]) => {
    const seen = new Set<string>()
    return list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
  }
  const answerList = shuffle(dedup(scoped))
  /** 干扰项候选池 = 全量（不受赛制池收窄；经典卷 dPool 同语义） */
  const distractorList = shuffle(dedup(pool))
  const questions: Question[] = []
  const otherType: MediaType = type === 'image' ? 'audio' : 'image'
  /** 已用作答案的物种（轮内去重：同一轮每只鸟最多当一次答案，与经典卷同则） */
  const usedAnswers = new Set<string>()
  /**
   * 已用作答案的**名字**（2026-11-03）：全球有 35 对物种共用同一中文名
   * （AviList 拆种遗留，如 `Cinnyris jugularis` 与 `Cinnyris ornatus` 都叫「黄腹花蜜鸟」），
   * 只按 id 去重会让同一轮出现两道题干相同的题。名字维度必须一并去重。
   */
  const usedAnswerNames = new Set<string>()

  for (const answerSp of answerList) {
    if (questions.length >= want) break
    if (usedAnswers.has(answerSp.id)) continue
    // 同名物种跳过（同一轮题干不得重复，2026-11-03；见 usedAnswerNames 注释）。
    // 用 nameByMode 而不是 speciesName：L6 的卷别由 nameMode 决定（zh/en/sci），
    // 去重必须和「题干实际显示的名字」同一口径，否则英文卷/学名卷下会去重失效。
    const preName = nameByMode(answerSp, nameMode)
    if (!preName || usedAnswerNames.has(preName)) continue
    // ensureMedia 可能返回带素材的新对象（分片懒加载），必须用它而不是原 species
    const answerResolved = await ensureMedia(answerSp, type)
    const answerAssets = assetsOf(answerResolved, type)
    if (!answerAssets.length) continue // 标记有素材但实际取不到素材 → 跳过该候选

    // 干扰项候选排序：L6 固定 same（同科优先，081 §7「多选项都是同科鸟」；
    // 2026-11-03 用户拍板 token 相似不进 L6——那是独立模式 S1（buildSimilarQuestions））。
    // 轮内已当过答案的种排后面但不排除（经典卷同语义）。
    const others = distractorList.filter((s) => s.id !== answerSp.id)
    const same = shuffle(others.filter((s) => s.family && s.family === answerSp.family))
    const diff = shuffle(others.filter((s) => !(s.family && s.family === answerSp.family)))
    const candidates =
      cfg.distractor === 'nameSimilar' ? orderNameSimilar(answerSp, others) : [...same, ...diff]

    // 分批解析候选素材（分片按桶缓存，跨题复用）；先取需要量的 2 倍补偿取不到的
    const need = cfg.optionCount - 1
    const answerName = nameByMode(answerSp, nameMode)
    const picked: { id: string; name: string; media: MediaAsset }[] = []
    let cursor = 0
    while (picked.length < need && cursor < candidates.length) {
      const batch = candidates.slice(cursor, cursor + (need - picked.length) * 2)
      cursor += batch.length
      const resolvedList = await Promise.all(batch.map((sp) => ensureMedia(sp, type)))
      const resolved = new Map<string, MediaAsset[]>()
      for (const sp of resolvedList) {
        const assets = assetsOf(sp, type)
        if (assets.length) resolved.set(sp.id, assets)
      }
      // 选项名体系与答案一致（D-8：判分体系锁定，不跨卷）
      const filled = fillDistractorsInMode(answerName, batch, resolved, need - picked.length, nameMode)
      picked.push(...filled)
    }
    if (picked.length < need) continue // 同卷可播候选不足一个整题的选项数 → 少出一题

    usedAnswers.add(answerSp.id)
    usedAnswerNames.add(preName)
    const optionPairs = shuffle([
      { id: answerSp.id, name: answerName, media: answerAssets[0]! },
      ...picked,
    ])
    questions.push({
      id: `${answerSp.id}-${type}-${questions.length}`,
      tier: 6,
      type,
      media: answerAssets[0]!,
      assets: answerAssets,
      crossAssets: assetsOf(answerSp, otherType),
      answer: answerName,
      sci: answerSp.nameSci,
      family: answerSp.family,
      options: optionPairs.map((p) => p.name),
      optionIds: optionPairs.map((p) => p.id),
      optionsMedia: optionPairs.map((p) => p.media),
      answerMode: 'choice',
      nameMode,
      timeLimitSec: cfg.timeLimitSec,
    })
    onStats?.({ candidates: bank.length, unique: scoped.length, enriched: questions.length, want })
  }
  return questions
}

/** fillDistractors 的卷别感知版本（nameByMode 决定选项名体系） */
function fillDistractorsInMode(
  answerName: string,
  ordered: BankSpecies[],
  resolved: Map<string, MediaAsset[]>,
  n: number,
  mode: NameMode,
): { id: string; name: string; media: MediaAsset }[] {
  const used = new Set<string>([answerName])
  const picked: { id: string; name: string; media: MediaAsset }[] = []
  for (const s of ordered) {
    if (picked.length >= n) break
    const name = nameByMode(s, mode)
    if (!name || used.has(name)) continue
    const assets = resolved.get(s.id)
    if (!assets?.length) continue
    used.add(name)
    picked.push({ id: s.id, name, media: assets[0]! })
  }
  return picked
}

// ---------------------------------------------------------------------------
// S1 相似种挑战（docs/099 §3.2；独立模式 tier 9，S1_ENABLED 控制上架——
// 2026-11-03 用户拍板：token 相似**不混入** L1–L8 任何档位，做成独立模式排在 L8 后）。
// ---------------------------------------------------------------------------

export interface BuildSimilarOptions {
  type: MediaType
  count?: number
  /**
   * 题型（2026-11-03 用户定，介绍页选择，双题型统一 20s）：
   * - 'media-stem' 看图选名：媒体作题干、名字作选项（经典形态）；
   * - 'name-stem' 看名选图：名字作题干、6 张图作选项（全部选项需真实图片素材）。
   */
  form?: 'media-stem' | 'name-stem'
  locale?: string
  /** 卷别（缺省按 locale 推断：'en' → en，否则 zh） */
  nameMode?: NameMode
  /**
   * 赛制选题池（013 §4，与经典卷同语义）：**答案只出池内，干扰项仍取全池同色**
   * （色组是这个模式的前提，收窄色组会直接出不了题）。
   */
  speciesPool?: ReadonlySet<string>
  /** 072-a 观测（与经典卷同语义） */
  onStats?: (s: BuildStats) => void
}

/**
 * 构建一轮 S1 题（docs/099 §3.2）。
 *
 * 分组（2026-11-03 用户定）：按**大色类**（canonical 11 色）——答案只要有一个颜色 C 的
 * 同色同伴 ≥ optionCount-1（全身或局部有 C 都算）即可出题；干扰项**同色同部位优先**
 * （红耳鹎和其他红耳的放一起），不足用同色异部位/全身回填（红耳和红身体放一起也可）。
 * 部位只是优先级不是门槛——太细的色×部位组不做出题门槛（预习侧才按色×部位细分，099 §3.9）。
 *
 * 题型：
 * - media-stem：只有答案需要素材（经典链路）；
 * - name-stem：答案与全部选项都要真实图片（ensureMedia 逐个解析，无图候选跳过、
 *   同色组后续补位；整组凑不满 optionCount 张图 → 该答案不出题，宁少一题不发空题）。
 *
 * 复用经典链路：nameMode 过滤在前（051 S1）、mediaPool、ensureMedia；不走地区档位/
 * 自适应/新手池（独立模式，与 L6 同构）；赛制池只收答案（013 §4）。S1 仅看图（入口保证）。
 *
 * 选题策略（2026-11-03 用户定，最高原则「刷题辨识鸟」）：
 * 1. **跨轮去重——降权不排除**：最近几轮出过的答案按次数降权（`1/(1+n)`），
 *    但不设 0 权重——小组（候选本来就少）永远还有机会，不会因为被刷过就彻底消失。
 * 2. **大组加权——只加不压**：同色组越大（同伴越多、干扰项越贴切）权重略高，
 *    但有上限；小组保持基础权重，**不因为它们小就降低**。
 * 3. **组内轮换**：同一色组里出过的答案降权（与 1 同源，但按「组」维度再叠一层），
 *    让「红耳组」下次换人做答案，而不是总出红耳鹎。
 * 三者相乘后 **按权重做加权随机**（不是排序取 Top N）——否则低权重鸟永远轮不到，
 * 与「不要排除」的要求矛盾。
 *
 * 权重状态存在模块级 Map（按 nameMode 分开），并落 sessionStorage 以便刷新后延续；
 * 只记 id/计数，不含任何用户信息。
 */
// ---------------------------------------------------------------------------
// S1 选题：色类索引缓存 + 权重状态（2026-11-03）
// ---------------------------------------------------------------------------

/** 色类索引：canonical 色 → 种列表；`色|部位` → 种列表 */
interface ColorIndex {
  byColor: Map<string, BankSpecies[]>
  byPair: Map<string, BankSpecies[]>
  /** 签名：nameMode + 池规模 + 首尾 id，用于判断能否复用 */
  sig: string
}

let colorIndexCache: ColorIndex | null = null

/**
 * 建/取色类索引（带缓存）。
 *
 * 为什么要缓存：每轮出题对全池（全球池 11,026 种）遍历建两个 Map，
 * 虽然只有毫秒级，但完全没必要重复——`speciesTokens` 本身已按 id 缓存，
 * 这里缓存的是「聚合结果」。
 *
 * 签名不含 `opts.speciesPool`（赛制池）：索引建的是**全池**索引，赛制过滤在
 * `answerCandidates` 那一步做（和改之前一致，语义不变）。
 */
function colorIndex(pool: BankSpecies[], nameMode: string): ColorIndex {
  const first = pool[0]?.id ?? ''
  const last = pool[pool.length - 1]?.id ?? ''
  const sig = `${nameMode}|${pool.length}|${first}|${last}`
  if (colorIndexCache && colorIndexCache.sig === sig) return colorIndexCache

  const byColor = new Map<string, BankSpecies[]>()
  const byPair = new Map<string, BankSpecies[]>()
  for (const s of pool) {
    for (const t of speciesTokens(s)) {
      const c = byColor.get(t.color)
      if (c) c.push(s)
      else byColor.set(t.color, [s])
      const pk = `${t.color}|${t.part}`
      const pr = byPair.get(pk)
      if (pr) pr.push(s)
      else byPair.set(pk, [s])
    }
  }
  colorIndexCache = { byColor, byPair, sig }
  return colorIndexCache
}

/** 清索引缓存（测试用；生产路径池不变则无需失效） */
export function clearColorIndexCache(): void {
  colorIndexCache = null
}

const S1_STATE_KEY = 'uniaoer-s1-pick'

/**
 * 跨轮选题状态（只记计数，不含用户信息）：
 * - `recent`: 物种 id → 最近 3 轮内作为答案的次数（用于跨轮去重降权）
 * - `pairRecent`: `色|部位` → 最近 2 轮内出过的答案 id 列表（用于组内轮换）
 *
 * 存在 sessionStorage：刷新页面延续，关标签页即清（不做长期画像，符合 028 隐私口径）。
 */
interface S1PickState {
  recent: Record<string, number>
  pairRecent: Record<string, string[]>
}

/** 跨轮去重的窗口：看最近几轮（10 题/轮 → 30 题，足够避免「刚做过又抽到」） */
const S1_RECENT_WINDOW = 3
/** 组内轮换的窗口：同组最近 2 轮出过的人降权 */
const S1_PAIR_WINDOW = 2

function loadS1State(): S1PickState {
  try {
    const raw = sessionStorage.getItem(S1_STATE_KEY)
    if (raw) {
      const j = JSON.parse(raw) as S1PickState
      if (j && typeof j === 'object' && j.recent && j.pairRecent) return j
    }
  } catch {
    /* 隐私模式 / 非法 JSON：从头开始，不影响出题 */
  }
  return { recent: {}, pairRecent: {} }
}

function saveS1State(st: S1PickState): void {
  try {
    sessionStorage.setItem(S1_STATE_KEY, JSON.stringify(st))
  } catch {
    /* 静默：存不下就只是少了跨轮降权，不影响出题 */
  }
}

/** 清跨轮状态（测试用） */
export function clearS1PickState(): void {
  try {
    sessionStorage.removeItem(S1_STATE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 计算答案权重（2026-11-03 用户定）。
 *
 * 三条策略相乘，**全部只降/只升，绝不置 0**：
 * 1. 跨轮去重：`1/(1+recentCount)` —— 刚出过 → 低，但永远 > 0。
 * 2. 组内轮换：该组最近出过此人 → 再乘 `1/2`（同组换人；不在组内则是 1）。
 * 3. 大组加权：`1 + min(groupSize, CAP) * STEP` —— 只给大组加成，小组保持 1.0，
 *    不用「小组降权」的写法（那样小组会因候选少+权重低而饿死）。
 *    但大组加成有上限（CAP），避免红/黑这类超大色组垄断出题。
 */
const S1_GROUP_BONUS_CAP = 40
const S1_GROUP_BONUS_STEP = 0.01 // 上限 1 + 40*0.01 = 1.4

function answerWeight(pick: SimilarPickLike, st: S1PickState): number {
  const recent = st.recent[pick.answer.id] ?? 0
  // 1. 跨轮去重（降权不排除）
  let w = 1 / (1 + recent)
  // 2. 组内轮换：同组最近出过的答案再降一半
  const pairList = st.pairRecent[pick.pairKey] ?? []
  if (pairList.includes(pick.answer.id)) w *= 0.5
  // 3. 大组加权（只加不压，带封顶）
  w *= 1 + Math.min(pick.groupSize, S1_GROUP_BONUS_CAP) * S1_GROUP_BONUS_STEP
  return w
}

/** 供 answerWeight 用的最小形状（避免把内部 interface 提到模块作用域） */
interface SimilarPickLike {
  answer: BankSpecies
  pairKey: string
  groupSize: number
}

/**
 * 按权重做**加权随机抽取**（不放回），抽 n 个。
 *
 * 为什么不用「排序取 Top N」：低权重的鸟会永远轮不到，与「降权但不排除」的要求相反。
 * 加权随机保证每只鸟都有非零概率，只是刚做过的概率低一些。
 *
 * 实现：累加权重 → 每次按剩余权重和取随机点 → 命中即摘除。O(n²) 但 n 通常几十~几百，
 * 且只在一轮出题时跑一次，可接受；避免为了 O(n log n) 引入额外依赖。
 */
function weightedSample<T>(items: T[], weightOf: (t: T) => number, n: number): T[] {
  const rest = [...items]
  const out: T[] = []
  while (out.length < n && rest.length) {
    let total = 0
    for (const it of rest) total += weightOf(it)
    if (total <= 0) {
      // 理论上不会发生（权重恒 >0）；兜底退化为均匀随机，保证出题不中断
      out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]!)
      continue
    }
    let r = Math.random() * total
    let idx = rest.length - 1
    for (let i = 0; i < rest.length; i++) {
      r -= weightOf(rest[i]!)
      if (r <= 0) {
        idx = i
        break
      }
    }
    out.push(rest.splice(idx, 1)[0]!)
  }
  return out
}

export async function buildSimilarQuestions(
  bank: BankSpecies[],
  opts: BuildSimilarOptions,
): Promise<Question[]> {
  const {
    type,
    count = 10,
    form = 'media-stem',
    locale,
    nameMode = locale === 'en' ? 'en' : 'zh',
    onStats,
  } = opts
  const cfg = TIERS[9]
  const pool = filterByNameMode(mediaPool(bank, type), nameMode)

  // 色类索引（2026-11-03 优化）：canonical 色 → 池内种列表；色×部位 → 池内种列表。
  // 按 (nameMode + bank 身份 + pool 规模) 缓存——每轮重建这两个 Map 是纯浪费
  // （11,026 种 × 平均 2 token ≈ 22,000 次插入，虽然毫秒级但没必要）。
  // 注意 cache 的是 **bank 引用**：bank 每次 loadBank() 复用同一数组实例，
  // 长度/首尾 id 一起做签名，能挡住「热更新换了数据但引用没变」的极端情况。
  const { byColor, byPair } = colorIndex(pool, nameMode)

  // 答案资格：存在某色 C，同色（任意部位）同伴 ≥ optionCount-1（2026-11-03 用户定：
  // 「全身或者局部有某个颜色都会出题」）。一鸟多 token 取「同色同部位组最大」的 token
  // 作主组（红耳优先于红身），平局取色组更大者。
  const answerCandidates = opts.speciesPool ? pool.filter((s) => opts.speciesPool!.has(s.id)) : pool
  interface SimilarPick {
    answer: BankSpecies
    /** 有序干扰项候选：同色同部位在前，同色异部位/全身在后（桶内已洗牌） */
    mates: BankSpecies[]
    /** 主组 key（`色|部位`）与同色组大小——供大组加权与组内轮换使用 */
    pairKey: string
    color: string
    groupSize: number
  }
  const answerPicks: SimilarPick[] = []
  const seenIds = new Set<string>()
  for (const s of answerCandidates) {
    if (seenIds.has(s.id)) continue
    seenIds.add(s.id)
    const tokens = speciesTokens(s)
    if (!tokens.length) continue
    let best: { mates: BankSpecies[]; pairKey: string; color: string; groupSize: number } | null = null
    let bestPair = -1
    let bestColor = -1
    for (const t of tokens) {
      const colorMates = (byColor.get(t.color) ?? []).filter((m) => m.id !== s.id)
      if (colorMates.length + 1 < cfg.optionCount) continue
      const pairMates = (byPair.get(`${t.color}|${t.part}`) ?? []).filter((m) => m.id !== s.id)
      if (
        pairMates.length > bestPair ||
        (pairMates.length === bestPair && colorMates.length > bestColor)
      ) {
        best = {
          mates: [...shuffle(pairMates), ...shuffle(colorMates.filter((m) => !pairMates.includes(m)))],
          pairKey: `${t.color}|${t.part}`,
          color: t.color,
          // 组大小取「同色组」（出题资格的依据），不是同色同部位组——
          // 后者可能很小（如「红|耳」只有 2 只），用它加权会让小组被系统性压死。
          groupSize: colorMates.length + 1,
        }
        bestPair = pairMates.length
        bestColor = colorMates.length
      }
    }
    if (best) answerPicks.push({ answer: s, ...best })
  }

  const want = Math.min(count, answerPicks.length)
  onStats?.({ candidates: bank.length, unique: answerPicks.length, enriched: 0, want })

  // 选题（2026-11-03 用户定）：加权随机——跨轮去重降权 / 组内轮换 / 大组加权，
  // 全部只调权重不排除（详见上方 answerWeight 注释）。
  // 抽取顺序即出题顺序；`weightedSample` 已保证每只鸟都有非零概率。
  const st = loadS1State()
  // 多抽一些作为替补余量：两种消耗来源——
  //   a) media-stem 可能因缺图跳过（`!answerAssets.length`）；
  //   b) 同名物种去重会跳过（见下方 roundAnswerNames）。
  // 抽 4 倍（原 3 倍）以覆盖两者叠加，避免「有候选却凑不满题数」。
  const pickedOrder = weightedSample(answerPicks, (p) => answerWeight(p, st), Math.min(answerPicks.length, want * 4))

  const questions: Question[] = []
  const otherType: MediaType = type === 'image' ? 'audio' : 'image'
  const nameStem = form === 'name-stem'
  /**
   * 本轮已回答过的**名字**（2026-11-03 修）：
   *
   * 不能只靠 id 去重——全球有 35 对物种**共用同一个中文名**（AviList 拆种遗留），
   * 典型如 `Cinnyris jugularis` 与 `Cinnyris ornatus` 都叫「黄腹花蜜鸟」。
   * 只按 id 去重的话，同一轮里会出现两道题干完全一样的题（用户看到的就是「重复题」）。
   *
   * 所以：**同一轮内，答案名不得重复**（同名 → 跳过该候选，继续取下一个）。
   * 注意这是**题与题之间**的去重，与单题内部干扰项去重（下面的 `used`）是两回事。
   */
  const roundAnswerNames = new Set<string>()
  /** 本轮实际出过的答案（落库到跨轮状态用） */
  const usedAnswers: SimilarPick[] = []
  for (const pick of pickedOrder) {
    if (questions.length >= want) break
    const resolved = await ensureMedia(pick.answer, type)
    const answerAssets = assetsOf(resolved, type)
    if (!answerAssets.length) continue // 标记有素材但实际取不到素材 → 换下一个候选

    const answerName = speciesName(resolved, locale)
    if (!answerName) continue
    if (roundAnswerNames.has(answerName)) continue // 同名物种（如两个「黄腹花蜜鸟」）→ 本轮不再出
    roundAnswerNames.add(answerName)
    const used = new Set<string>([answerName])
    const distractors: { id: string; name: string; media: MediaAsset }[] = []
    if (!nameStem) {
      // 看图选名：干扰项只要名字（同色同部位优先序已在 pick.mates 里）
      for (const mate of pick.mates) {
        if (distractors.length >= cfg.optionCount - 1) break
        const name = speciesName(mate, locale)
        if (!name || used.has(name)) continue // 选项名去重（used 含答案名，经典卷同则）
        used.add(name)
        distractors.push({ id: mate.id, name, media: answerAssets[0]! })
      }
      if (distractors.length < cfg.optionCount - 1) continue // 去重后不足一个整题 → 换候选
    } else {
      // 看名选图：每个选项都要真实图片——分批解析（同 L6：一次多取补偿取不到的），
      // 无图候选跳过、同色组后续补位；整组凑不满 → 该答案不出题
      const need = cfg.optionCount - 1
      let cursor = 0
      while (distractors.length < need && cursor < pick.mates.length) {
        const batch = pick.mates.slice(cursor, cursor + (need - distractors.length) * 2)
        cursor += batch.length
        const resolvedList = await Promise.all(batch.map((sp) => ensureMedia(sp, type)))
        for (const mate of resolvedList) {
          if (distractors.length >= need) break
          const name = speciesName(mate, locale)
          if (!name || used.has(name)) continue
          const imgs = assetsOf(mate, type)
          if (!imgs.length) continue // 无图候选 → 跳过
          used.add(name)
          distractors.push({ id: mate.id, name, media: imgs[0]! })
        }
      }
      if (distractors.length < need) continue // 整组凑不满 6 张图 → 不出题（宁少一题不发空题）
    }

    const optionPairs = shuffle([
      { id: resolved.id, name: answerName, media: answerAssets[0]! },
      ...distractors.map((d) => ({ id: d.id, name: d.name, media: d.media })),
    ])
    questions.push({
      id: `${resolved.id}-${type}-${questions.length}-s1`,
      tier: 9,
      type,
      media: answerAssets[0]!,
      assets: answerAssets,
      crossAssets: assetsOf(resolved, otherType),
      answer: answerName,
      sci: resolved.nameSci,
      nameMode,
      family: resolved.family,
      options: optionPairs.map((p) => p.name),
      optionIds: optionPairs.map((p) => p.id),
      ...(nameStem
        ? { stemName: answerName, optionsMedia: optionPairs.map((p) => p.media) }
        : {}),
      answerMode: 'choice',
      timeLimitSec: timeLimitFor(cfg, type),
    })
    usedAnswers.push(pick)
    onStats?.({ candidates: bank.length, unique: answerPicks.length, enriched: questions.length, want })
  }

  // 落库跨轮状态（只在本轮真出了题时才更新，避免空轮污染）
  if (usedAnswers.length) {
    recordS1Usage(st, usedAnswers)
    saveS1State(st)
  }
  return questions
}

/**
 * 把本轮实际出过的答案写进跨轮状态。
 *
 * - `recent`：+1，超过窗口的旧计数整体衰减（每轮把所有计数 -1 并删 0，
 *   等价于「只记最近 S1_RECENT_WINDOW 轮」，但不需要存时间戳/轮次号）。
 * - `pairRecent`：按主组 key 追加本轮答案 id，只保留最近 S1_PAIR_WINDOW 轮。
 */
/**
 * 把本轮实际出过的答案写进跨轮状态。
 *
 * - `recent`：每轮整体 -1（窗口滑出即归零），再给本轮答案 +1。
 *   因此某 id 的值 = 「最近 S1_RECENT_WINDOW 轮内作为答案的次数」，上限就是窗口长度。
 * - `pairRecent`：按主组 key 追加本轮答案 id，只保留最近 S1_PAIR_WINDOW 轮。
 */
function recordS1Usage(st: S1PickState, used: SimilarPickLike[]): void {
  // 1. 整体衰减（窗口滑动）+ 本轮 +1，并夹到窗口上限（防脏数据累计出超大计数）
  const nextRecent: Record<string, number> = {}
  for (const [id, n] of Object.entries(st.recent)) {
    const v = Math.min(n + 1, S1_RECENT_WINDOW) - 1
    if (v > 0) nextRecent[id] = v
  }
  for (const p of used) {
    nextRecent[p.answer.id] = Math.min((nextRecent[p.answer.id] ?? 0) + 1, S1_RECENT_WINDOW)
  }
  st.recent = nextRecent

  // 3. 组内轮换：每轮把各组的「最近出过」前移，只保留最近 N 轮
  const nextPair: Record<string, string[][]> = {}
  for (const [k, rounds] of Object.entries(st.pairRecent)) {
    // 兼容旧格式（string[] → 视作单轮）
    const asRounds: string[][] = Array.isArray(rounds[0]) ? (rounds as unknown as string[][]) : [rounds as unknown as string[]]
    const kept = asRounds.slice(0, S1_PAIR_WINDOW - 1)
    if (kept.length) nextPair[k] = kept
  }
  for (const p of used) {
    const rounds = nextPair[p.pairKey] ?? []
    rounds.unshift([p.answer.id])
    nextPair[p.pairKey] = rounds.slice(0, S1_PAIR_WINDOW)
  }
  // 拍平成 string[]（保持 sessionStorage 结构简单：组 → 最近 N 轮出现过的 id）
  st.pairRecent = Object.fromEntries(
    Object.entries(nextPair).map(([k, rounds]) => [k, rounds.flat()]),
  )
}

// ---------------------------------------------------------------------------
// L7 鸟娲·造鸟者（docs/089 §6.1）：媒体作题干 → 输入鸟名（answerMode 'input'）。
// ---------------------------------------------------------------------------

export interface BuildInputOptions {
  type: MediaType
  count?: number
  tier?: Tier
  speciesPool?: ReadonlySet<string>
  locale?: string
  /** 卷别（语言名 zh/en 或学名 sci——介绍页模式选择，089 §6.2） */
  nameMode?: NameMode
  regionTiers?: Map<string, number> | null
  distractorPool?: BankSpecies[]
  starterOnly?: boolean
  onStats?: (s: BuildStats) => void
}

/**
 * 构建一轮 L7 题：**复用经典 buildQuestions 的全部池子语义**（nameMode 过滤在最前、
 * 档位/地区档位、赛制池、轮内去重、ensureMedia 补素材），差异只有：
 *  - 无选项/干扰项（answerMode 'input'，options/optionIds 为空数组——错题 chosenId 天然 undefined）；
 *  - 限时取 L7_TIERS（图 15s / 音 18s；素材切换递减由组件管）；
 *  - answer = 该卷显示名（判分在 nameMatch，接受集合含港台名/繁体字形）。
 */
export async function buildInputQuestions(
  bank: BankSpecies[],
  opts: BuildInputOptions,
): Promise<Question[]> {
  const classic = await buildQuestions(bank, { ...opts, tier: opts.tier ?? 7 })
  const limit = L7_TIERS[opts.type].timeLimitSec
  return classic.map((q, i) => ({
    ...q,
    id: `${q.id}-input-${i}`,
    tier: 7,
    answerMode: 'input' as const,
    options: [],
    optionIds: [],
    timeLimitSec: limit,
  }))
}
