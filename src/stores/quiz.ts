import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MediaType, NameMode, Question, QuizRegime, Tier } from '@/types'
import { loadBank, BankError, type BankErrorCode, type BankSpecies } from '@/core/bank'
import { buildQuestions, buildNameQuestions, speciesPlayable } from '@/core/questionEngine'
import type { BuildStats } from '@/core/questionEngine'
import { loadRegionalPool } from '@/core/globalPool'
import { fetchOnlinePool } from '@/core/onlinePool'
import { isDiag } from '@/core/diag'
import { regionTierMap } from '@/core/provinceCommonness'
import { suggestTier, type TierSuggestion } from '@/core/adaptive'
import { getWrongBook, listRounds, type RoundRecord, type WrongEntry } from '@/core/historyDb'
import { useSettingsStore } from './settings'
import { currentLocale } from '@/i18n'

/** 超时未作答的标记（区别于 null=未作答） */
export const TIMEOUT = '__timeout__'

/** 072-a 观测：本轮实际走的出题链路 */
export type QuizBuildPath = 'online' | 'online-fallback' | 'local'

/**
 * 072-a 观测：单轮出题的链路快照。
 * **只读展示/日志用**，不参与任何出题判定 —— 先观测再决定「凑满 10 题」还是「允许不足但说明」。
 */
export interface QuizBuildDiag {
  type: MediaType
  tier: Tier
  region: string
  regime: QuizRegime
  nameMode: NameMode
  path: QuizBuildPath
  /** 在线候选总条数（null = 本轮没走在线） */
  onlineTotal: number | null
  /** 在线候选中命中赛制池的条数（path='online' 时即实际参与组题的物种数） */
  onlineHits: number | null
  /** 赛制池大小（random 无池 → null） */
  regimePool: number | null
  /** 在线候选来源（null = 本轮没走在线） */
  onlineFrom: 'client' | 'network' | null
  /** 进入组题链路的物种数 */
  candidates: number
  /** 过档位/命名/去重后的池大小 */
  afterFilter: number
  /** 有"可玩"标记但取不到素材而被丢弃的物种数（= 目标数 − 实际取到素材数） */
  dropped: number
  /** 目标题数 */
  want: number
  /** 实际出题数 */
  built: number
  starterOnly: boolean
}

/** 出题失败错误码（UI 层映射 errors.* 文案，015 §6.5） */
export type QuizErrorCode =
  | BankErrorCode
  | 'wrongPoolEmpty'
  | 'noImageMedia'
  | 'noAudioMedia'
  | 'standardPoolEmpty'
  | 'poolEmpty'
  | 'unknown'

export const useQuizStore = defineStore('quiz', () => {
  const mode = ref<MediaType>('image')
  const tier = ref<Tier>(2)
  /**
   * 题型链路（docs/081 §7）：'classic' = L1–L5（媒体作题干）；'name' = L6 半鸟人
   * （名字作题干，选项是图/音）。决定 start 的走线与「再来一轮」的重建路径。
   */
  const kind = ref<'classic' | 'name'>('classic')
  /** 赛制（013 §4）：介绍页选择，决定选题池；再来一轮沿用同赛制 */
  const regime = ref<QuizRegime>('standard')
  const roundId = ref<string>('')
  const startedAt = ref<number>(0)
  const questions = ref<Question[]>([])
  /** 051 S1：本轮命名体系（出题时确定，落进每道题与轮次记录，供 046 分区统计） */
  const nameMode = ref<NameMode>(currentLocale() === 'en' ? 'en' : 'zh')
  const chosen = ref<(string | null)[]>([])
  const index = ref(0)
  const loading = ref(false)
  const error = ref('')
  /** 072-a 观测：上一轮出题的链路快照（默认 null；仅诊断模式展示） */
  const lastBuild = ref<QuizBuildDiag | null>(null)

  // ---- D4：连续多轮 session（再来一轮=同难度下一轮，累计轮次/整体正确率） ----
  const sessionRound = ref(1)
  const sessionCorrect = ref(0)
  const sessionTotal = ref(0)
  /** 标记"从结果页继续下一轮"，供 QuizPlay 跳过介绍页直接开始 */
  const pendingContinue = ref(false)

  /** 本轮来源（落库标记，隐藏徽章/称号统计用，R28） */
  const source = ref<'normal' | 'wrong-practice'>('normal')
  /** 退出确认点了「取消」后继续答题（"浪子回头"标记） */
  const escapedQuit = ref(false)

  const current = computed<Question | null>(() => questions.value[index.value] ?? null)
  const currentChoice = computed<string | null>(() => chosen.value[index.value] ?? null)
  const answered = computed(() => currentChoice.value !== null)
  const total = computed(() => questions.value.length)
  const correctCount = computed(
    () => questions.value.reduce((n, q, i) => n + (chosen.value[i] === q.answer ? 1 : 0), 0),
  )
  const accuracy = computed(() =>
    total.value ? Math.round((correctCount.value / total.value) * 100) : 0,
  )
  const finished = computed(() => total.value > 0 && index.value >= total.value)
  /** 已作答题数（超时计为已作答；中途退出按此数截断落库） */
  const answeredCount = computed(() => {
    const i = chosen.value.findIndex((c) => c == null)
    return i === -1 ? questions.value.length : i
  })
  /** 本次 session 的整体正确率（含当前轮） */
  const overallAccuracy = computed(() => {
    const t = sessionTotal.value + total.value
    return t ? Math.round(((sessionCorrect.value + correctCount.value) / t) * 100) : 0
  })

/** IndexedDB 不可用（隐私模式等）时按"无练习史"降级，不阻塞出题 */
async function safeListRounds(): Promise<RoundRecord[]> {
  try {
    return await listRounds()
  } catch {
    return []
  }
}
async function safeWrongBook(): Promise<WrongEntry[]> {
  try {
    return await getWrongBook()
  } catch {
    return []
  }
}

/**
 * 是否为"新手首轮"（2026-10-09 新手福利）。
 * 判定 = 当前档案**尚无任何已完成轮次**（历史为空）。只影响 L1 首轮的候选池，
 * 之后不再干预（用户定稿："只有第一次做 L1 固定常见鸟"）。
 */
async function isFirstRoundEver(): Promise<boolean> {
  return (await safeListRounds()).length === 0
}

/** D5：按最近表现给出档位建议（图/声隔离；IndexedDB 不可用时保持当前档） */
async function tierSuggestion(type: MediaType, currentTier: Tier): Promise<TierSuggestion> {
  return suggestTier(await safeListRounds(), type, currentTier)
}

/**
 * S6：出题名单 = **权威层 meta（唯一源）**，不再 core（1,299）+ 全球池（9,545）拼接。
 * 只收「可玩」物种（图/音任一有素材，且未被质量降级 quizExcluded）。
 * 地区过滤（D-029-2）：L1–L3 走地区（元数据按国家区系过滤），L4–L5 全球开放。
 */
async function mergedSpecies(type: MediaType, tier: Tier): Promise<BankSpecies[]> {
  const bank = await loadBank()
  const settings = useSettingsStore()
  const region = tier <= 3 ? settings.region : 'ALL'
  const regional = await loadRegionalPool(region).catch(() => null)
  const list = regional ?? bank.species
  return list.filter((sp) => !sp.quizExcluded && speciesPlayable(sp, type))
}

/** 各赛制的派生集合（按「物种 × 媒体类型」；computePool 与 regimeCounts 共用） */
async function poolData(type: MediaType, tier: Tier = 2) {
  const [species, rounds, wrong] = await Promise.all([
    mergedSpecies(type, tier),
    safeListRounds(),
    safeWrongBook(),
  ])
  const withMedia = new Set(species.map((sp) => sp.id))
  const practiced = new Set<string>()
  const correctSet = new Set<string>()
  for (const round of rounds) {
    for (const it of round.items) {
      if (it.type !== type || !withMedia.has(it.speciesId)) continue
      practiced.add(it.speciesId)
      if (it.correct) correctSet.add(it.speciesId)
    }
  }
  const wrongSet = new Set(
    wrong.map((w) => w.speciesId).filter((id) => withMedia.has(id)),
  )
  return { withMedia, practiced, correctSet, wrongSet, species }
}

/** 各赛制当前可用物种数（UI 据此置灰/隐藏不可用赛制，013 §4） */
async function regimeCounts(type: MediaType, tier: Tier): Promise<Record<QuizRegime, number>> {
  const { withMedia, practiced, correctSet, wrongSet } = await poolData(type, tier)
  return {
    standard: [...withMedia].filter((id) => !practiced.has(id)).length,
    review: practiced.size,
    reinforce: correctSet.size,
    revival: wrongSet.size,
    random: withMedia.size,
  }
}

/** 赛制 → 选题池（undefined = 全库随机）；池空返回错误码，由 UI 引导去专项赛/新建档案 */
  async function computePool(
    r: QuizRegime,
    type: MediaType,
    tier: Tier,
  ): Promise<{ pool?: ReadonlySet<string>; errorCode?: QuizErrorCode }> {
    if (r === 'random') return {}
    const { withMedia, practiced, correctSet, wrongSet } = await poolData(type, tier)
    if (r === 'standard') {
      const pool = new Set([...withMedia].filter((id) => !practiced.has(id)))
      return pool.size ? { pool } : { errorCode: 'standardPoolEmpty' }
    }
    if (r === 'revival') {
      return wrongSet.size ? { pool: new Set(wrongSet) } : { errorCode: 'wrongPoolEmpty' }
    }
    const wanted = r === 'review' ? practiced : correctSet
    return wanted.size ? { pool: new Set(wanted) } : { errorCode: 'poolEmpty' }
  }

  async function start(
    type: MediaType,
    opts: { count?: number; tier?: Tier; keepSession?: boolean; regime?: QuizRegime } = {},
  ) {
    mode.value = type
    kind.value = 'classic'
    if (opts.tier) tier.value = opts.tier
    if (!opts.keepSession) {
      sessionRound.value = 1
      sessionCorrect.value = 0
      sessionTotal.value = 0
    }
    if (opts.regime) regime.value = opts.regime
    // 051 S1：开轮时按当前界面语言确定命名体系（设置页可随时切语言）
    nameMode.value = currentLocale() === 'en' ? 'en' : 'zh'
    loading.value = true
    error.value = ''
    try {
      await loadBank()
      // A2 赛制选题池（013 §4）：standard=未练过 / review=练过 / reinforce=练对过 /
      // revival=错题本 / random=全库；按「物种 × 媒体类型」记练过（013 P2 粒度）
      // 029 M2：池含全球种（L1–L3 按地区偏好过滤，L4–L5 全球开放），出题用合并后的物种表
      const poolResult = await computePool(regime.value, type, tier.value)
      if (poolResult.errorCode) {
        error.value = poolResult.errorCode
        questions.value = []
        chosen.value = []
        index.value = 0
        return
      }
      if (!opts.keepSession) {
        source.value = regime.value === 'revival' ? 'wrong-practice' : 'normal'
      }
      escapedQuit.value = false

      // 029 M4(D-029-4):在线出题优先——由 D1 按档位/题型/地区出候选池(服务端已过滤),
      // 前端本地组装题面;失败/离线回退本地核心库+全球池(功能不降级)。
      // 030 措施 5:**仅会话首轮**走在线——「再来一轮」等后续轮次直接用本地全量池
      //   （10,844 种，质量已足够），从源头避免连续请求 D1。
      // 030 措施 3:在线路径自带 sessionStorage 缓存（10 分钟 / 30 条候选），
      //   客户端命中即零网络；一次取 30 条也够本轮多次取材。
      const count = opts.count ?? 10
      const settings = useSettingsStore()
      // 新手福利（2026-10-09）：**第一轮 + L1** → 候选限定为人人皆知的最常见鸟
      // （starterBirds.ts；不足一轮自动回退常规逻辑）。仅在会话首轮判定，后续轮不再干预。
      let starterOnly = false
      if (tier.value === 1 && !opts.keepSession) {
        starterOnly = await isFirstRoundEver()
      }
      // 新手轮**跳过在线池**：服务端 30 条随机候选里新手鸟可能只有个位数，会误触发"不足一轮"回退。
      // 本地全量池（核心 1299 + 全球池）才能让新手池完整参与筛选（也顺带省一次 D1 读）。
      const online = opts.keepSession || starterOnly
        ? null
        : await fetchOnlinePool(type, tier.value, settings.region)

      let speciesForBuild: BankSpecies[]
      let distractorPool: BankSpecies[] | undefined
      let speciesPool = poolResult.pool
      // 072-a 观测（只记录，不参与判定）：本轮走的是在线 / 在线回退 / 本地
      let buildPath: QuizBuildPath = 'local'
      let onlineTotal: number | null = null
      let onlineHits: number | null = null
      let onlineFrom: 'client' | 'network' | null = null
      /** 072-a 观测：组题计数（由 questionEngine 回调填充；用对象持有点位，避免 TS 把闭包赋值判成 never） */
      const buildStats: { v: BuildStats | null } = { v: null }
      if (online) {
        onlineTotal = online.species.length
        onlineFrom = online.from ?? null
        speciesForBuild = online.species
        distractorPool = online.distractors.length ? online.distractors : undefined
        // 赛制池（复习/强化/错题本依赖本地练习史）仍需按 id 过滤在线候选；
        // 标准赛的"未练过"过滤同样适用
        if (speciesPool) {
          const filtered = online.species.filter((sp) => speciesPool!.has(sp.id))
          onlineHits = filtered.length
          // 072-a-fix-1（2026-10-22 用户定：允许不足但说明，但**不许因交集而少题**）：
          // 交集不足目标题数时回退本地赛制池（本地池是完整的，够就能凑满）；
          // 本地池也真的不够（复活赛只有 4 条等）才短轮，并在答题页明确说明。
          if (filtered.length < count) {
            // 在线候选与本地赛制池交集不足（如全球种尚未练过）：回退本地池
            buildPath = 'online-fallback'
            speciesForBuild = (await poolData(type, tier.value)).species
            distractorPool = undefined
            speciesPool = poolResult.pool
          } else {
            buildPath = 'online'
            speciesForBuild = filtered
          }
        } else {
          buildPath = 'online'
        }
      } else {
        speciesForBuild = (await poolData(type, tier.value)).species
      }

      // 036：L1–L3 用「该省/该国档位」出题（与 D-029-2 的地区策略一致）；
      // L4–L5 保持全球口径（"省里稀有=高手题"是语义错位）。取不到档位表 → null → 回退全局 commonness。
      let regionTiers: Map<string, number> | null = null
      if (tier.value <= 3) {
        const settingsForRegion = useSettingsStore()
        const rm = await regionTierMap(settingsForRegion.region).catch(() => null)
        regionTiers = rm?.tiers ?? null
      }
      const qs = await buildQuestions(speciesForBuild, {
        type,
        count,
        tier: tier.value,
        speciesPool,
        locale: currentLocale(),
        // 051 S1：界面语言决定命名体系（'en' 界面 → 英文名卷，其余中文名卷；L6 学名卷另设）
        nameMode: nameMode.value,
        distractorPool,
        regionTiers,
        starterOnly,
        onStats: (s) => {
          buildStats.v = s
        },
      })
      // 072-a 观测：把本轮链路与池子大小留痕（不改任何出题行为）。
      // 短轮用 warn（默认就能在控制台看到）；诊断模式下每轮都打一行 info。
      const diag: QuizBuildDiag = {
        type,
        tier: tier.value,
        region: settings.region,
        regime: regime.value,
        nameMode: nameMode.value,
        path: buildPath,
        onlineTotal,
        onlineHits,
        regimePool: poolResult.pool?.size ?? null,
        onlineFrom,
        candidates: buildStats.v?.candidates ?? speciesForBuild.length,
        afterFilter: buildStats.v?.unique ?? 0,
        dropped: buildStats.v ? Math.max(0, buildStats.v.want - buildStats.v.enriched) : 0,
        want: count,
        built: qs.length,
        starterOnly,
      }
      lastBuild.value = diag
      if (qs.length < count) {
        console.warn('[quiz] short round:', JSON.stringify(diag))
      } else if (isDiag()) {
        console.info('[quiz] built:', JSON.stringify(diag))
      }
      if (!qs.length) {
        // 无素材（池内物种都缺对应媒体）：错误码入 store，文案由组件按 locale 渲染（015 §6.5）
        error.value = type === 'image' ? 'noImageMedia' : 'noAudioMedia'
        questions.value = []
        chosen.value = []
        index.value = 0
        return
      }
      questions.value = qs
      chosen.value = Array.from<string | null>({ length: qs.length }).fill(null)
      index.value = 0
      roundId.value = newRoundId()
      startedAt.value = Date.now()
    } catch (e) {
      error.value = e instanceof BankError ? e.code : 'unknown'
      questions.value = []
      chosen.value = []
      index.value = 0
    } finally {
      loading.value = false
    }
  }

  function answer(choice: string) {
    if (answered.value || !current.value) return
    chosen.value[index.value] = choice
  }

  /** 新轮次 id（crypto.randomUUID 优先，旧环境退时间戳） */
  function newRoundId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  /**
   * L6 半鸟人开轮（docs/081 §7 / docs/085 §5）：名字 → 图/音选择题。
   * 与经典 start 的差异：无赛制池（全库随机）、无在线候选（服务端干扰项无素材，
   * 当不了 L6 的选项）、无地区档位/新手池（L6 无档位选择，难度由题型本身承载）；
   * 卷别由介绍页 switch 决定（085 D-2），落进每题与轮次记录供统计分卷（D-3）。
   */
  async function startName(
    type: MediaType,
    opts: { count?: number; nameMode?: NameMode; keepSession?: boolean } = {},
  ) {
    mode.value = type
    kind.value = 'name'
    tier.value = 6
    regime.value = 'random'
    if (!opts.keepSession) {
      sessionRound.value = 1
      sessionCorrect.value = 0
      sessionTotal.value = 0
    }
    nameMode.value = opts.nameMode ?? (currentLocale() === 'en' ? 'en' : 'zh')
    loading.value = true
    error.value = ''
    try {
      await loadBank()
      const count = opts.count ?? 10
      const settings = useSettingsStore()
      const species = (await poolData(type, tier.value)).species
      const buildStats: { v: BuildStats | null } = { v: null }
      const qs = await buildNameQuestions(species, {
        type,
        count,
        nameMode: nameMode.value,
        onStats: (s) => {
          buildStats.v = s
        },
      })
      // 072-a 同款观测（L6 固定走本地全量池，path 恒为 'local'）
      lastBuild.value = {
        type,
        tier: 6,
        region: settings.region,
        regime: 'random',
        nameMode: nameMode.value,
        path: 'local',
        onlineTotal: null,
        onlineHits: null,
        regimePool: null,
        onlineFrom: null,
        candidates: buildStats.v?.candidates ?? species.length,
        afterFilter: buildStats.v?.unique ?? 0,
        dropped: buildStats.v ? Math.max(0, buildStats.v.want - buildStats.v.enriched) : 0,
        want: count,
        built: qs.length,
        starterOnly: false,
      }
      if (qs.length < count) {
        console.warn('[quiz] L6 short round:', JSON.stringify(lastBuild.value))
      }
      if (!qs.length) {
        error.value = type === 'image' ? 'noImageMedia' : 'noAudioMedia'
        questions.value = []
        chosen.value = []
        index.value = 0
        return
      }
      questions.value = qs
      chosen.value = Array.from<string | null>({ length: qs.length }).fill(null)
      index.value = 0
      roundId.value = newRoundId()
      startedAt.value = Date.now()
    } catch (e) {
      error.value = e instanceof BankError ? e.code : 'unknown'
      questions.value = []
      chosen.value = []
      index.value = 0
    } finally {
      loading.value = false
    }
  }

  /** 超时：标记为未作答但已结束 */
  function timeUp() {
    if (answered.value || !current.value) return
    chosen.value[index.value] = TIMEOUT
  }

  function next() {
    if (index.value < questions.value.length) index.value++
  }

  /** D4：把本轮并入 session 累计，再以同模式开新一轮；D5 开自适应时按最近表现升降档 */
  async function nextRound() {
    sessionCorrect.value += correctCount.value
    sessionTotal.value += total.value
    sessionRound.value += 1
    pendingContinue.value = true
    // L6 无档位/赛制/自适应概念：直接按同卷别重建一轮（题量按标准重新申请，同 072-a-fix-2）
    if (kind.value === 'name') {
      await startName(mode.value, { keepSession: true, nameMode: nameMode.value })
      return
    }
    if (useSettingsStore().adaptiveTier) {
      const s = await tierSuggestion(mode.value, tier.value)
      tier.value = s.tier
    }
    // 072-a-fix-2：不再继承上一轮的题量。
    // 旧实现传 `count: 上一轮题数`，一旦出现 7 题，整场都是 7 题（用户明确反对）。
    // 现在每轮都按标准题量重新申请，池子真不够时会自然少题并由答题页说明原因。
    await start(mode.value, {
      tier: tier.value,
      keepSession: true,
    })
  }

  /** E1 → 复活赛（013 §10 并入赛制）：标记下一轮为"错题重练"并进入对应答题页（难度仍在介绍页选） */
  function startWrongBook(type: MediaType) {
    regime.value = 'revival'
    mode.value = type
    kind.value = 'classic'
    tier.value = 2
    sessionRound.value = 1
    sessionCorrect.value = 0
    sessionTotal.value = 0
    pendingContinue.value = false
    error.value = ''
  }

  /** 中途退出：把本轮截断为前 n 题已作答部分，供结果页按"截至成绩"落库（错题本/统计同步） */
  function truncateTo(n: number) {
    const len = Math.max(0, Math.min(n, questions.value.length))
    questions.value = questions.value.slice(0, len)
    chosen.value = chosen.value.slice(0, len)
    index.value = len
    pendingContinue.value = false
    regime.value = 'standard'
  }

  function reset() {
    questions.value = []
    chosen.value = []
    index.value = 0
    error.value = ''
    lastBuild.value = null
    sessionRound.value = 1
    sessionCorrect.value = 0
    sessionTotal.value = 0
    pendingContinue.value = false
    regime.value = 'standard'
    kind.value = 'classic'
    source.value = 'normal'
    escapedQuit.value = false
  }

  return {
    mode,
    tier,
    kind,
    nameMode,
    roundId,
    startedAt,
    questions,
    chosen,
    index,
    loading,
    error,
    lastBuild,
    current,
    currentChoice,
    answered,
    answeredCount,
    total,
    correctCount,
    accuracy,
    finished,
    sessionRound,
    sessionCorrect,
    sessionTotal,
    pendingContinue,
    regime,
    source,
    escapedQuit,
    overallAccuracy,
    start,
    startName,
    regimeCounts,
    tierSuggestion,
    answer,
    timeUp,
    next,
    nextRound,
    startWrongBook,
    truncateTo,
    reset,
  }
})
