import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MediaType, Question, QuizRegime, Tier } from '@/types'
import { loadBank, registerSpecies, BankError, type BankErrorCode, type BankSpecies } from '@/core/bank'
import { assetsOf, buildQuestions } from '@/core/questionEngine'
import { loadRegionalPool } from '@/core/globalPool'
import { fetchOnlinePool } from '@/core/onlinePool'
import { regionTierMap } from '@/core/provinceCommonness'
import { suggestTier, type TierSuggestion } from '@/core/adaptive'
import { getWrongBook, listRounds, type RoundRecord, type WrongEntry } from '@/core/historyDb'
import { useSettingsStore } from './settings'
import { currentLocale } from '@/i18n'

/** 超时未作答的标记（区别于 null=未作答） */
export const TIMEOUT = '__timeout__'

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
  /** 赛制（013 §4）：介绍页选择，决定选题池；再来一轮沿用同赛制 */
  const regime = ref<QuizRegime>('standard')
  const roundId = ref<string>('')
  const startedAt = ref<number>(0)
  const questions = ref<Question[]>([])
  const chosen = ref<(string | null)[]>([])
  const index = ref(0)
  const loading = ref(false)
  const error = ref('')

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

/** D5：按最近表现给出档位建议（图/声隔离；IndexedDB 不可用时保持当前档） */
async function tierSuggestion(type: MediaType, currentTier: Tier): Promise<TierSuggestion> {
  return suggestTier(await safeListRounds(), type, currentTier)
}

/**
 * 029 M2:合入全球池（懒加载；失败静默回退核心 1299）。
 * 只收「可玩」物种（图/音任一有素材，且未被质量降级 quizExcluded）。
 * 地区过滤（D-029-2）：L1–L3 走地区包（用户地区偏好），L4–L5 全球开放。
 */
async function mergedSpecies(type: MediaType, tier: Tier): Promise<BankSpecies[]> {
  const bank = await loadBank()
  const core = bank.species.filter(
    (sp) => assetsOf(sp, type).length > 0 && !sp.quizExcluded,
  )
  const settings = useSettingsStore()
  const region = tier <= 3 ? settings.region : 'ALL'
  const global = await loadRegionalPool(region).catch(() => null)
  if (!global?.length) return core
  const usable = global.filter(
    (sp) =>
      !sp.quizExcluded &&
      (type === 'image' ? sp.playableImage !== false && !!sp.image : sp.playableAudio !== false && !!sp.audio),
  )
  registerSpecies(usable) // 历史/错题本的名字解析需要
  const seen = new Set(core.map((s) => s.id))
  return [...core, ...usable.filter((sp) => !seen.has(sp.id))]
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
    if (opts.tier) tier.value = opts.tier
    if (!opts.keepSession) {
      sessionRound.value = 1
      sessionCorrect.value = 0
      sessionTotal.value = 0
    }
    if (opts.regime) regime.value = opts.regime
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
      const online = opts.keepSession
        ? null
        : await fetchOnlinePool(type, tier.value, settings.region)

      let speciesForBuild: BankSpecies[]
      let distractorPool: BankSpecies[] | undefined
      let speciesPool = poolResult.pool
      if (online) {
        speciesForBuild = online.species
        distractorPool = online.distractors.length ? online.distractors : undefined
        // 赛制池（复习/强化/错题本依赖本地练习史）仍需按 id 过滤在线候选；
        // 标准赛的"未练过"过滤同样适用
        if (speciesPool) {
          const filtered = online.species.filter((sp) => speciesPool!.has(sp.id))
          if (!filtered.length) {
            // 在线候选与本地赛制池无交集（如全球种尚未练过）：回退本地池
            speciesForBuild = (await poolData(type, tier.value)).species
            distractorPool = undefined
            speciesPool = poolResult.pool
          } else {
            speciesForBuild = filtered
          }
        }
        registerSpecies(online.species)
        if (online.distractors.length) registerSpecies(online.distractors)
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
      const qs = buildQuestions(speciesForBuild, {
        type,
        count,
        tier: tier.value,
        speciesPool,
        locale: currentLocale(),
        distractorPool,
        regionTiers,
      })
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
      roundId.value =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    if (useSettingsStore().adaptiveTier) {
      const s = await tierSuggestion(mode.value, tier.value)
      tier.value = s.tier
    }
    // 保持与上一轮相同的题量
    await start(mode.value, {
      tier: tier.value,
      count: questions.value.length || undefined,
      keepSession: true,
    })
  }

  /** E1 → 复活赛（013 §10 并入赛制）：标记下一轮为"错题重练"并进入对应答题页（难度仍在介绍页选） */
  function startWrongBook(type: MediaType) {
    regime.value = 'revival'
    mode.value = type
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
    sessionRound.value = 1
    sessionCorrect.value = 0
    sessionTotal.value = 0
    pendingContinue.value = false
    regime.value = 'standard'
    source.value = 'normal'
    escapedQuit.value = false
  }

  return {
    mode,
    tier,
    roundId,
    startedAt,
    questions,
    chosen,
    index,
    loading,
    error,
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
