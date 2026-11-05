<script setup lang="ts">
/**
 * L6 半鸟人答题区（docs/081 §7 / 085 / 087 §4.8）——**纯答题组件**。
 *
 * 087 §4.8（用户定）：L6 就是难度第六档，与 L1–L5 同一个介绍页/开轮链路（quiz.start，
 * tier=6 时引擎分支到 buildNameQuestions）。本组件只负责答题态——计时/选项/反馈/自动切题/退出/署名——
 * 由 QuizPlay 在 `quiz.tier === 6` 时挂载；介绍页与开轮（quiz.start，第六档）都在
 * QuizPlay。「再来一轮」经 ResultView → nextRound 重建题目后回到同一页面，
 * 本组件挂载时消费 pendingContinue。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { preloadQuestions } from '@/core/mediaLoader'
import { ambiencePlayer } from '@/core/ambience'
import { AUTO_NEXT_DELAY_WRONG_MS } from '@/core/pacing'
import { isLeftSwipe } from '@/core/swipe'
import { diagMarkAdvance, diagMarkAnswer, isDiag } from '@/core/diag'
import { TIERS } from '@/core/difficulty'
import { useMediaGate } from '@/composables/useMediaGate'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import {
  AlarmClock,
  ArrowRight,
  CircleCheck,
  CircleX,
  Flag,
  Hourglass,
  Keyboard,
  LogOut,
  Play,
  Smartphone,
  Timer,
  X,
} from 'lucide-vue-next'
import type { MediaType } from '@/types'
import AttributionLine from './AttributionLine.vue'
import AnswerReview from './AnswerReview.vue'
import OptionMediaList from './OptionMediaList.vue'
import ProgressBar from './ProgressBar.vue'
import ReportDialog from './ReportDialog.vue'

// 必须赋给变量：下方 answerIsImage 要用 props.type 判断题型
// （2026-11-03 bug：只写 defineProps<...>() 不赋值，却在 computed 里引 props.type
//   → 运行时 ReferenceError，整个 L6 组件挂死、按钮无响应、倒计时不走）
const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()

// ---- G1 报错按钮（与经典卷同款；浮窗见 ReportDialog） ----
const showReport = ref(false)
const reportTarget = ref<{
  speciesId: string
  speciesName: string
  sci: string
  questionType: MediaType
  mediaUrl: string
} | null>(null)
function openReport() {
  const q = quiz.current
  if (!q) return
  reportTarget.value = {
    speciesId: q.media.speciesId,
    speciesName: q.answer,
    sci: q.sci,
    questionType: q.type,
    mediaUrl: q.media.url,
  }
  showReport.value = true
}

/** 科名「拉丁名+本地名」组合，随 locale 切换（015 #2） */
const familyOf = (fam: string) => familyDisplay(fam, currentLocale())

const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

/**
 * L6 半鸟人（识图版）同样是「题干是鸟名、选项是图片」，
 * 所以反馈里的答案必须以**选项标号**呈现（「正确图片：C」），
 * 而不是重复题干鸟名（2026-11-03 用户定，与 S1 看名选图同口径）。
 */
const answerIsImage = computed(() => props.type === 'image')
const answerLetter = computed(() => {
  const q = quiz.current
  if (!q) return ''
  const i = q.options.indexOf(q.answer)
  return i >= 0 ? (['A', 'B', 'C', 'D', 'E', 'F'][i] ?? '') : ''
})

// ---- 072-a 说明：本组题量不足时明确告知 ----
const shortRoundNote = computed(() => {
  const d = quiz.lastBuild
  if (!d || d.built >= d.want) return ''
  return t('quiz.shortRound', { built: d.built, want: d.want })
})

// ---- 072-a 观测：诊断行（?diag=1 才渲染） ----
const diagOn = isDiag()
const diagHead = computed(() => {
  const d = quiz.lastBuild
  if (!d) return ''
  return t('quiz.diagHead', {
    tier: t(TIERS[d.tier].labelKey),
    region: '',
    regime: t('regime.random.label'),
  })
})
const diagBody = computed(() => {
  const d = quiz.lastBuild
  if (!d) return ''
  return t('quiz.diagBody', {
    pool: '-',
    cand: d.candidates,
    after: d.afterFilter,
    drop: d.dropped,
    path: t('quiz.diagPathLocal'),
    built: d.built,
    want: d.want,
  })
})


/** 「下一题」；最后一题改为「查看结果」 */
const nextLabel = computed(() =>
  quiz.index + 1 >= quiz.total ? t('quiz.viewResult') : t('quiz.next'),
)

// ---- 计时：看图等 6 张选项图全部加载完；听音无预载素材，切题即计 ----
const timeLeft = ref<number | null>(null)
let tick: number | undefined

/** 媒体就绪门：选项图就是题面，图没出来不该开始倒数 */
const gate = useMediaGate()

/**
 * 本题必须等齐的媒体数（决定何时开始计时）：
 * - **看图** = 选项图数（题干是名字，无图）→ 全部 load 后（或 1s 兜底）才开始倒计时；
 * - **听音** = 0 → mediaGate 立即放行，但计时**不立刻开始**：
 *   听音题在设计上是「点按某项试听」，没有统一的预载时机，
 *   所以由 `audioStarted` 标记控制——**用户第一次点按播放时才开始倒数**
 *   （2026-11-03：与「加载完/听到声音才计时」同一原则，不惩罚「还没听就被扣时间」）。
 */
function gateCount(): number {
  const q = quiz.current
  if (!q || q.type !== 'image') return 0
  return (q.optionsMedia ?? []).filter((m) => (m.thumbUrl || m.url) && m.type === 'image').length
}

/** 网络失败过多时的提示（2026-11-05 用户定：不再展示网速数值） */
const networkNote = computed(() => t('quiz.networkPoor'))

function onOptionMediaSettled(ok: boolean) {
  if (ok) gate.markLoaded()
  else gate.markFailed()
}

function stopTimer() {
  if (tick !== undefined) {
    clearInterval(tick)
    tick = undefined
  }
}

function resetTimer() {
  stopTimer()
  timeLeft.value = quiz.current?.timeLimitSec ?? null
}

function startTimer() {
  resetTimer()
  if (timeLeft.value === null || quiz.answered) return
  tick = window.setInterval(() => {
    if (timeLeft.value === null) return
    timeLeft.value -= 1
    if (timeLeft.value <= 0) {
      stopTimer()
      quiz.timeUp()
    }
  }, 1000)
}

/**
 * 每题起点（2026-11-03 统一为「真正可用才开始计时」）：
 * - **看图**：等选项图全部 load（1s 兜底）→ gate 就绪后 startTimer；
 * - **听音**：没有统一的预载时机（靠点按试听），所以**等第一次开播**
 *   （`onAudioStarted`）才 startTimer。在此之前倒计时保持冻结在原值。
 */
function beginTiming() {
  gate.reset(gateCount(), true)
  if (gate.ready.value) {
    // 听音题：gate 立即就绪（count=0），但要等开播才起表——先冻住
    if (quiz.current?.type === 'audio') resetTimer()
    else startTimer()
  } else {
    resetTimer()
  }
}

/** 门禁放行即开始计时（看图路径；听音走 onAudioStarted） */
watch(
  () => gate.ready.value,
  (ok) => {
    if (!ok || quiz.answered) return
    if (quiz.current?.type === 'audio') resetTimer() // 听音：等开播，先冻住
    else startTimer()
  },
)

/** 听音题首次开播 → 正式起表（只触发一次，由 OptionMediaList 的 audioStarted 保证） */
function onAudioStarted() {
  if (quiz.answered) return
  if (timeLeft.value === null) return // 已结束（如超时）
  startTimer()
}

// ---- D2 自动下一题 / R43 浮窗与取消（与经典卷同款） ----
const autoPending = ref(false)
const cancelledThisQuestion = ref(false)
let autoNextTimer: number | undefined
const autoNextRemaining = ref<number | null>(null)
let autoNextTicker: number | undefined

const willAuto = computed(() => {
  const mode = settings.autoNext
  return mode === 'all' || (mode === 'correct' && isCorrect.value)
})
const showToast = computed(() => quiz.answered && willAuto.value && !cancelledThisQuestion.value)
const showInline = computed(() => quiz.answered && !showToast.value)
const feedbackRef = ref<HTMLElement | null>(null)
const showDisableBtn = computed(
  () => quiz.answered && cancelledThisQuestion.value && settings.autoNext !== 'manual',
)
const showEnableBtn = computed(() => quiz.answered && settings.autoNext === 'manual')

function stopCountdown() {
  if (autoNextTicker !== undefined) {
    clearInterval(autoNextTicker)
    autoNextTicker = undefined
  }
  autoNextRemaining.value = null
}

function clearAutoNext() {
  if (autoNextTimer !== undefined) {
    clearTimeout(autoNextTimer)
    autoNextTimer = undefined
  }
  stopCountdown()
  autoPending.value = false
}

function scheduleAutoNext() {
  clearAutoNext()
  if (!willAuto.value) return
  autoPending.value = true
  const delay = isCorrect.value
    ? Math.round(settings.autoNextDelaySec * 1000)
    : AUTO_NEXT_DELAY_WRONG_MS
  const deadline = Date.now() + delay
  autoNextRemaining.value = delay / 1000
  autoNextTicker = window.setInterval(() => {
    const left = (deadline - Date.now()) / 1000
    autoNextRemaining.value = left > 0 ? left : 0
    if (left <= 0) stopCountdown()
  }, 100)
  autoNextTimer = window.setTimeout(() => {
    autoNextTimer = undefined
    autoPending.value = false
    quiz.next()
  }, delay)
}

function goNext() {
  clearAutoNext()
  quiz.next()
}

function cancelAutoOnce() {
  clearAutoNext()
  cancelledThisQuestion.value = true
}

function disableAuto() {
  clearAutoNext()
  settings.autoNext = 'manual'
  cancelledThisQuestion.value = false
}

function enableAuto() {
  settings.autoNext = 'correct'
  scheduleAutoNext()
}

/** 计时变红的最后秒数（与经典卷 R30 同则） */
const warnThreshold = computed(() => 5)

/** 中途退出：已作答部分按"截至成绩"落库（与经典卷同则） */
function quitRound() {
  const n = quiz.answeredCount
  const msg =
    n > 0
      ? t('quiz.quitConfirmDetail', { n, total: quiz.total })
      : t('quiz.quitConfirmEmpty')
  if (!confirm(msg)) return
  stopTimer()
  clearAutoNext()
  if (n === 0) {
    quiz.reset()
    router.push('/')
    return
  }
  quiz.truncateTo(n)
  router.push('/result')
}

/**
 * 2026-10-25（问题 3）：幽灵点击防护（与经典卷同则）——
 * 只有「pointerdown 发生在切题之前」的那次 click 才可能是跨题残留，其余照常作答。
 */
let advancedAt = 0
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
let pointerBeforeAdvance = false
function onPointerDownCapture() {
  pointerBeforeAdvance = nowMs() < advancedAt
}

/** 选项作答唯一入口：先记诊断轨迹（?diag=1 才生效），再写答案；切题 250ms 内的点击视为幽灵点击 */
function onSelectOption(value: string) {
  const q = quiz.current
  if (!q) return
  const stale = pointerBeforeAdvance
  diagMarkAnswer({
    questionIndex: quiz.index,
    questionId: q.id,
    value,
    source: 'click',
    autoPending: autoPending.value,
  })
  pointerBeforeAdvance = false
  if (stale) return
  quiz.answer(value)
}

// ---- L6 选项试听（听音版）：作答后停播 ----
const optionListRef = ref<InstanceType<typeof OptionMediaList> | null>(null)

onMounted(() => {
  document.addEventListener('keydown', onKey)
  // 「再来一轮」续轮（ResultView → nextRound 重建题目后回到本页）
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
    ambiencePlayer.stop()
  }
  advancedAt = nowMs() // 首题的静默期起点
  preloadQuestions(quiz.questions, quiz.index, 2) // 当前题 + 下 1 题（每题素材多，少预）
  beginTiming()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  stopTimer()
  clearAutoNext()
})

watch(
  () => quiz.index,
  (i) => {
    clearAutoNext()
    cancelledThisQuestion.value = false
    advancedAt = nowMs()
    diagMarkAdvance()
    preloadQuestions(quiz.questions, i + 1, 1) // 之后 1 题（每题素材多，少预）
    beginTiming()
  },
)
watch(
  () => quiz.answered,
  (a) => {
    if (a) {
      stopTimer()
      optionListRef.value?.stopPlayback()
      scheduleAutoNext()
      void nextTick(() => {
        if (showInline.value) feedbackRef.value?.focus()
      })
    } else {
      clearAutoNext()
      cancelledThisQuestion.value = false
    }
  },
)
watch(
  () => quiz.finished,
  (f) => {
    if (f) router.push('/result')
  },
)

function onKey(e: KeyboardEvent) {
  // 弹层打开时答题快捷键让位；带修饰键的组合不是答题意图
  if (showReport.value) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const el = e.target
  if (
    el instanceof HTMLElement &&
    (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
  ) {
    return
  }
  const q = quiz.current
  if (!q) return

  // 已作答：→ / 空格 = 下一题
  if (quiz.answered) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      goNext()
    }
    return
  }

  const map: Record<string, number> = {
    '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5,
    a: 0, b: 1, c: 2, d: 3, e: 4, f: 5,
  }
  const idx = map[e.key.toLowerCase()]
  if (idx !== undefined) {
    e.preventDefault()
    optionListRef.value?.pressIndex(idx)
  }
}

// ---- D3 触屏左滑 = 下一题 ----
let touchStart: { x: number; y: number } | null = null

function onTouchStart(e: TouchEvent) {
  const t = e.changedTouches?.[0]
  touchStart = t ? { x: t.clientX, y: t.clientY } : null
}

function onTouchEnd(e: TouchEvent) {
  const start = touchStart
  touchStart = null
  const t = e.changedTouches?.[0]
  if (!start || !t || !quiz.answered) return
  if (isLeftSwipe(t.clientX - start.x, t.clientY - start.y)) goNext()
}

// ---- 署名：L6 展示的是全部选项素材，合并成一条紧凑署名行（许可义务不因题型打折） ----
const optionAttributions = computed(() => {
  const q = quiz.current
  if (!q?.optionsMedia?.length) return []
  const seen = new Set<string>()
  const list: { source: string; author: string; license: string; href: string }[] = []
  for (const m of q.optionsMedia) {
    const key = `${m.source}|${m.author}|${m.license}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({
      source: m.source,
      author: m.author,
      license: m.license,
      href: m.licenseUrl || m.sourceUrl || '',
    })
  }
  return list
})
</script>

<template>
  <!-- G1 报错浮窗（本地记录 + 可选昵称） -->
  <ReportDialog
    v-if="reportTarget"
    v-model:open="showReport"
    :species-id="reportTarget.speciesId"
    :species-name="reportTarget.speciesName"
    :sci="reportTarget.sci"
    :question-type="reportTarget.questionType"
    :media-url="reportTarget.mediaUrl"
  />

  <!-- 答题 -->
  <template v-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <p v-if="shortRoundNote" class="short-round-note" role="status">{{ shortRoundNote }}</p>
    <p v-if="gate.shouldPromptRetry.value" class="network-note" role="alert">{{ networkNote }}</p>
    <p v-if="diagOn && diagHead" class="diag-line" data-testid="diag-line">
      {{ diagHead }}<br /><span class="diag-body">{{ diagBody }}</span>
    </p>
    <!-- 状态行：左=题型·卷别 · 中=题号 · 右=计时/正确率 -->
    <div class="status-bar">
      <span class="sb-left">
        <span class="tier-tag">{{ t(TIERS[quiz.current.tier].labelKey) }}</span>
        <span class="tier-tag mode">{{ t(`quiz6.mode.${quiz.nameMode}`) }}</span>
      </span>
      <span class="sb-mid">{{ t('quiz.progress', { n: quiz.index + 1, total: quiz.total }) }}</span>
      <span class="sb-right">
        <span v-if="!gate.ready.value && !quiz.answered" class="timer loading">
          <span class="spin" aria-hidden="true"></span> {{ t('quiz.loadingMedia') }}
        </span>
        <span v-else-if="timeLeft !== null && !quiz.answered" class="timer" :class="{ warn: timeLeft <= warnThreshold }">
          <Timer class="ic" :size="14" /> {{ timeLeft }}s
        </span>
        <span v-else>{{
          quiz.answered || quiz.index > 0
            ? t('quiz.accuracyLabel', { acc: quiz.accuracy })
            : '--'
        }}</span>
      </span>
    </div>

    <div
      class="card"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
      @pointerdown.capture="onPointerDownCapture"
    >
      <!-- 题干：鸟名（学名卷为斜体拉丁名） -->
      <div class="stem">
        <p class="stem-cap muted">{{ t('quiz6.stemCap') }}</p>
        <h3 class="stem-name" :class="{ sci: quiz.current.nameMode === 'sci' }">
          {{ quiz.current.answer }}
        </h3>
      </div>

      <button class="quit-corner" type="button" @click="quitRound">
        <LogOut class="ic" :size="13" /> {{ t('quiz.quit') }}
      </button>

      <OptionMediaList
        ref="optionListRef"
        :key="quiz.current.id"
        :options="quiz.current.options"
        :options-media="quiz.current.optionsMedia ?? []"
        :answer="quiz.current.answer"
        :chosen="quiz.currentChoice"
        :type="quiz.current.type"
        hint-key="l6"
        @select="onSelectOption"
        @media-settled="onOptionMediaSettled"
        @audio-started="onAudioStarted"
      />

      <!-- G1 报错按钮 -->
      <button class="report-link" type="button" @click="openReport">
        <Flag class="ic" :size="14" /> {{ t('report.button') }}
      </button>

      <!-- 自动切换中：浮窗（与经典卷同款） -->
      <Transition name="toast">
        <div
          v-if="showToast"
          class="correct-toast"
          :class="{ 'is-wrong': !isCorrect }"
          role="status"
          aria-live="polite"
        >
          <div class="ct-row">
            <CircleCheck v-if="isCorrect" class="ic" :size="20" />
            <CircleX v-else class="ic" :size="20" />
            <div class="ct-main">
              <strong v-if="isCorrect">{{ t('quiz.correct') }}</strong>
              <strong v-else-if="timedOut">{{ t('quiz.timeout') }}</strong>
              <strong v-else>{{ t('quiz.wrong') }}</strong>
              <span v-if="answerIsImage">
                {{ t('quiz.correctImage', { letter: answerLetter }) }}
              </span>
              <span v-else>
                {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
                  t('quiz.answerSci', { sci: quiz.current.sci })
                }}
              </span>
            </div>
          </div>
          <div class="ct-auto">
            <span class="ct-count" aria-hidden="true">
              <Hourglass class="ic" :size="13" />
              {{ t('quiz.autoAdvancing', { sec: (autoNextRemaining ?? 0).toFixed(1) }) }}
            </span>
            <button class="btn-mini" type="button" @click="cancelAutoOnce">{{ t('quiz.cancelAuto') }}</button>
            <button class="btn-mini ct-next" type="button" @click="goNext">{{ nextLabel }}</button>
          </div>
        </div>
      </Transition>

      <!-- 下方常驻反馈：手动 / 不触发自动 / 取消了本次自动 时显示 -->
      <div
        v-if="showInline"
        ref="feedbackRef"
        class="feedback"
        :class="isCorrect ? 'ok' : 'no'"
        role="status"
        tabindex="-1"
      >
        <strong v-if="timedOut"><AlarmClock class="ic" :size="16" /> {{ t('quiz.timeout') }}</strong>
        <strong v-else-if="isCorrect"><CircleCheck class="ic" :size="16" /> {{ t('quiz.correct') }}</strong>
        <strong v-else><CircleX class="ic" :size="16" /> {{ t('quiz.wrong') }}</strong>
        <template v-if="answerIsImage">
          {{ t('quiz.correctImage', { letter: answerLetter }) }}
        </template>
        <template v-else>
          {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
            t('quiz.answerSci', { sci: quiz.current.sci })
          }}
          <span class="muted"> · {{ familyOf(quiz.current.family) }}</span>
        </template>
      </div>

      <!-- 「不再自动切换」/「自动切换」 -->
      <div v-if="showDisableBtn || showEnableBtn" class="auto-ctrl">
        <button v-if="showDisableBtn" class="btn-mini" type="button" @click="disableAuto">
          <X class="ic" :size="12" /> {{ t('quiz.disableAuto') }}
        </button>
        <button v-else-if="showEnableBtn" class="btn-mini" type="button" @click="enableAuto">
          <Play class="ic" :size="12" /> {{ t('quiz.enableAuto') }}
        </button>
      </div>

      <!-- 作答后：选项对照（A→鸟名）+ 图片来源（A→作者·许可证），铁律 11。
           L6 识图模式的选项也是**纯图片**（名字是题干，选项上不能放字——泄题），
           作答后必须补上「A 是什么鸟」，否则做题人只知道错了、不知道别人是什么鸟。
           上方的 optionAttributions 是**合并去重**的许可行（仍需保留：作答前就显示，
           履行 CC 署名义务且不泄题）；本块是**逐项对应**，供对照学习。 -->
      <AnswerReview
        v-if="quiz.answered && quiz.current"
        :options="quiz.current.options"
        :options-media="quiz.current.optionsMedia"
        :answer="quiz.current.answer"
        :chosen="quiz.currentChoice"
      />

      <!-- 署名：选项素材的合并署名行（**作答前**就在，许可义务不因题型打折）。
           作答后改由 AnswerReview 逐项列出（A→作者），这块合并行会重复，故隐藏（铁律 10）。 -->
      <div v-if="optionAttributions.length && !quiz.answered" class="option-attr">
        <template v-for="(a, i) in optionAttributions" :key="i">
          <template v-if="i > 0"> · </template>
          <a v-if="a.href" :href="a.href" target="_blank" rel="noopener noreferrer"
            >{{ a.source }} · {{ a.author }} ({{ a.license }})</a
          >
          <span v-else>{{ a.source }} · {{ a.author }} ({{ a.license }})</span>
        </template>
      </div>
      <AttributionLine v-else-if="!quiz.answered" class="quiz-attr" :media="quiz.current.media" />

      <!-- 键盘/滑动提示（2026-11-03 用户定）：**放在卡片最底部**（所有信息之后）。
           之前夹在「下一题」按钮与选项对照之间，会被误读成答案区的一部分。 -->
      <div v-if="quiz.answered && !autoPending" class="quiz-foot">
        <span class="foot-hint">
          <Keyboard class="ic" :size="13" /> {{ t('quiz.footPress') }}
          <ArrowRight class="ic" :size="12" /> {{ t('quiz.footOrSpace') }} ·
          <Smartphone class="ic" :size="13" /> {{ t('quiz.footSwipe') }}
        </span>
      </div>

      <!-- 主按钮放**卡片最末**（2026-11-03 用户定）：先看反馈信息，最后才是「下一题」。 -->
      <div v-if="showInline" class="actions">
        <button class="btn btn-primary" @click="goNext">
          {{ nextLabel }}
          <ArrowRight class="ic" :size="16" />
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* 072-a 观测：诊断行（默认不渲染；?diag=1 才出现）。小字、弱色、允许换行，不干扰答题。 */
.diag-line {
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--text-light);
  background: #f3f4f2;
  border: 1px dashed #d8dcd4;
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  margin: 0 0 8px;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
}
.short-round-note {
  font-size: 0.75rem;
  color: #8a6d00;
  background: #fdf3d8;
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  margin: 0 0 8px;
}
.network-note {
  font-size: 0.75rem;
  color: #8a3b2e;
  background: #fdeae6;
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  margin: 0 0 8px;
}
.timer.loading .spin {
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: gate-spin 0.8s linear infinite;
}
@keyframes gate-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .timer.loading .spin {
    animation: none;
  }
}
.diag-body {
  color: var(--text-light);
  opacity: 0.92;
}
.status-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.78rem;
}
.sb-left {
  justify-self: start;
  display: inline-flex;
  gap: 6px;
}
.sb-mid {
  font-weight: 700;
  color: var(--text);
}
.sb-right {
  justify-self: end;
  font-weight: 700;
  color: var(--text);
  display: inline-flex;
  align-items: center;
}
.tier-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
}
.tier-tag.mode {
  background: #f0eaf8;
  color: #5b3f8f;
}
.timer {
  font-variant-numeric: tabular-nums;
  background: #eaf4ef;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
}
.timer.warn {
  color: var(--wrong);
  background: #fdecee;
  font-size: 1rem;
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
/* 题干（鸟名） */
.stem {
  text-align: center;
  padding: 6px 0 14px;
}
.stem-cap {
  font-size: 0.72rem;
  margin-bottom: 2px;
}
.stem-name {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--primary-dark);
  line-height: 1.3;
}
.stem-name.sci {
  font-style: italic;
  font-weight: 700;
}
.quit-corner {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.88);
  color: var(--text-light);
  font-size: 0.72rem;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: all 0.18s ease;
}
@media (hover: hover) {
.quit-corner:hover{
  color: var(--wrong);
  border-color: var(--wrong);
  background: #fff;
}
}.card {
  position: relative;
}
.feedback {
  margin-top: 16px;
  padding: 15px 18px;
  border-radius: var(--radius);
  font-size: 0.9rem;
  line-height: 1.7;
  animation: pop 0.3s ease;
}
.feedback.ok {
  background: linear-gradient(135deg, #eafaf1, #d8f3dc);
  border-left: 5px solid var(--correct);
}
.feedback.no {
  background: #fdecee;
  border-left: 5px solid var(--wrong);
}
.feedback strong {
  display: block;
  margin-bottom: 5px;
}
.feedback:focus {
  outline: none;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.actions .btn {
  flex: 1;
}
.quiz-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 0.75rem;
  color: var(--text-light);
}
.foot-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.option-attr {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  font-size: 0.68rem;
  color: var(--text-light);
  line-height: 1.7;
  text-align: center;
  word-break: break-word;
}
.option-attr a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
}
@media (hover: hover) {
.option-attr a:hover{
  color: var(--primary);
}
}.quiz-attr {
  margin-top: 14px;
}
.correct-toast {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 21vh;
  z-index: 80;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: min(92vw, 560px);
  padding: 12px 18px;
  border-radius: var(--radius);
  background: linear-gradient(135deg, #eafaf1, #d8f3dc);
  border: 1px solid var(--correct);
  box-shadow: 0 18px 40px -18px rgba(20, 52, 42, 0.6);
  text-align: center;
}
.correct-toast.is-wrong {
  background: linear-gradient(135deg, #fdecee, #fbd8dc);
  border-color: var(--wrong);
}
.ct-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.correct-toast .ic {
  color: var(--correct);
  flex-shrink: 0;
}
.correct-toast.is-wrong .ic {
  color: var(--wrong);
}
.ct-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
  text-align: left;
  overflow-wrap: anywhere;
}
.ct-main strong {
  font-size: 0.92rem;
  color: var(--correct);
}
.correct-toast.is-wrong .ct-main strong {
  color: var(--wrong);
}
.ct-main span {
  font-size: 0.8rem;
  color: var(--text-light);
}
.ct-auto {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  row-gap: 8px;
  flex-wrap: wrap;
}
.ct-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.74rem;
  color: var(--primary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
.auto-ctrl {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.btn-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: #f0f4f2;
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
@media (hover: hover) {
.btn-mini:hover{
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
}
}.ct-next {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
@media (hover: hover) {
.ct-next:hover{
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  filter: brightness(0.94);
}
}.report-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-light);
  font-size: 0.78rem;
  cursor: pointer;
  vertical-align: middle;
}
@media (hover: hover) {
.report-link:hover{
  color: var(--primary);
}
}@keyframes pop {
  0% {
    transform: scale(0.96);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
