import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MediaType, Question, Tier } from '@/types'
import { loadBank } from '@/core/bank'
import { buildQuestions } from '@/core/questionEngine'
import { getWrongBook } from '@/core/historyDb'

/** 超时未作答的标记（区别于 null=未作答） */
export const TIMEOUT = '__timeout__'

export const useQuizStore = defineStore('quiz', () => {
  const mode = ref<MediaType>('image')
  const tier = ref<Tier>(2)
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

  // ---- E1 错题重练：下一轮 start() 只出错误本中的物种；开轮后自动复原 ----
  const wrongPoolOnly = ref(false)
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

  async function start(
    type: MediaType,
    opts: { count?: number; tier?: Tier; keepSession?: boolean } = {},
  ) {
    mode.value = type
    if (opts.tier) tier.value = opts.tier
    if (!opts.keepSession) {
      sessionRound.value = 1
      sessionCorrect.value = 0
      sessionTotal.value = 0
    }
    loading.value = true
    error.value = ''
    try {
      const bank = await loadBank()
      let ids: Set<string> | undefined
      if (wrongPoolOnly.value) {
        ids = new Set((await getWrongBook()).map((w) => w.speciesId))
        wrongPoolOnly.value = false // 只影响即将开始的这一轮
        source.value = 'wrong-practice'
      } else if (!opts.keepSession) {
        source.value = 'normal'
      }
      escapedQuit.value = false
      const qs = buildQuestions(bank.species, {
        type,
        count: opts.count ?? 10,
        tier: tier.value,
        speciesIds: ids,
      })
      if (!qs.length) {
        throw new Error(
          ids
            ? '错题本里没有可用的这类素材（可能缺图/缺音），换个模式或先去答题'
            : `题库中没有可用的${type === 'image' ? '图片' : '音频'}素材`,
        )
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
      error.value = e instanceof Error ? e.message : String(e)
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

  /** D4：把本轮并入 session 累计，再以同模式/同难度开新一轮 */
  async function nextRound() {
    sessionCorrect.value += correctCount.value
    sessionTotal.value += total.value
    sessionRound.value += 1
    pendingContinue.value = true
    // 保持与上一轮相同的题量
    await start(mode.value, {
      tier: tier.value,
      count: questions.value.length || undefined,
      keepSession: true,
    })
  }

  /** E1：标记下一轮为"错题重练"并进入对应答题页（难度仍在介绍页选） */
  function startWrongBook(type: MediaType) {
    wrongPoolOnly.value = true
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
    wrongPoolOnly.value = false
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
    wrongPoolOnly.value = false
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
    wrongPoolOnly,
    source,
    escapedQuit,
    overallAccuracy,
    start,
    answer,
    timeUp,
    next,
    nextRound,
    startWrongBook,
    truncateTo,
    reset,
  }
})
