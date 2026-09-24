import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MediaType, Question, Tier } from '@/types'
import { loadBank } from '@/core/bank'
import { buildQuestions } from '@/core/questionEngine'

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

  async function start(type: MediaType, opts: { count?: number; tier?: Tier } = {}) {
    mode.value = type
    if (opts.tier) tier.value = opts.tier
    loading.value = true
    error.value = ''
    try {
      const bank = await loadBank()
      const qs = buildQuestions(bank.species, { type, count: opts.count ?? 10, tier: tier.value })
      if (!qs.length) {
        throw new Error(`题库中没有可用的${type === 'image' ? '图片' : '音频'}素材`)
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

  function reset() {
    questions.value = []
    chosen.value = []
    index.value = 0
    error.value = ''
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
    total,
    correctCount,
    accuracy,
    finished,
    start,
    answer,
    timeUp,
    next,
    reset,
  }
})
