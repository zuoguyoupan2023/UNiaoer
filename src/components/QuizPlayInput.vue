<script setup lang="ts">
/**
 * L7 鸟娲·造鸟者答题区（docs/089 §6.1 定稿；085 判分口径）——图/音 → **输入**鸟名。
 *
 * 关键交互（均用户拍板）：
 *  - **计时起点**：看图=切题即计；听音=**正式开播起计**（audio-play，R24 同机制，加载不耗时）；
 *  - **素材切换**（图糊/录音差）：换同物种下一份素材 → **重新计时**，但本题限时递减
 *    （第 1 次 −1s、第 n 次 −n s），减到 ≤0 禁用；听音切换需重新开播才重新起计；
 *  - **IME 门禁**：中文输入法候选期的 Enter 是选词不是提交（compositionstart/end +
 *    e.isComposing 双保险）——不处理就会「没打完被提交」；
 *  - **D-10 超时**：计时到 → 输入框非空按当时内容判，空=错（不宽限）；
 *  - **判分**：submit 走中心 nameMatch（中文卷接受 简体/港台名/繁体字形；非对即错 D-9）。
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
import { loadBank, speciesNoteById } from '@/core/bank'
import { addReport, markReportSynced, type ReportReason } from '@/core/reportStore'
import { submitReport as uploadReport } from '@/core/reportsApi'
import { getClientId } from '@/core/anonymousId'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { track } from '@/core/metrics'
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
  RefreshCw,
  Smartphone,
  Timer,
  X,
} from 'lucide-vue-next'
import type { MediaAsset, MediaType } from '@/types'
import AttributionLine from './AttributionLine.vue'
import MediaCard from './MediaCard.vue'
import ProgressBar from './ProgressBar.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()

// ---- G1 报错（与经典卷同款） ----
const REPORT_REASONS: { id: ReportReason; labelKey: string }[] = [
  { id: 'image', labelKey: 'report.reasons.image' },
  { id: 'audio', labelKey: 'report.reasons.audio' },
  { id: 'answer', labelKey: 'report.reasons.answer' },
  { id: 'quality', labelKey: 'report.reasons.quality' },
  { id: 'other', labelKey: 'report.reasons.other' },
]
const showReport = ref(false)
const reportReason = ref<ReportReason>('image')
const reportAnswer = ref('')
const reportNote = ref('')
const reportState = ref<'idle' | 'done' | 'error'>('idle')
const { panelRef: reportPanelRef } = useDialogA11y(() => showReport.value, {
  onClose: closeReport,
})
function openReport() {
  reportReason.value = quiz.current?.type === 'audio' ? 'audio' : 'image'
  reportAnswer.value = ''
  reportNote.value = ''
  reportState.value = 'idle'
  showReport.value = true
}
function closeReport() {
  showReport.value = false
}
async function submitReport() {
  const q = quiz.current
  if (!q) return
  try {
    const row = await addReport({
      speciesId: q.media?.speciesId,
      speciesName: q.answer,
      sci: q.sci,
      questionType: q.type,
      mediaUrl: currentMedia.value?.url ?? q.media.url,
      reason: reportReason.value,
      suggestedAnswer: reportAnswer.value.trim() || undefined,
      note: reportNote.value.trim() || undefined,
    })
    try {
      await uploadReport(row, getClientId())
      await markReportSynced(row.id)
      track('report_submit')
    } catch {
      /* 离线：保留 pending */
    }
    reportState.value = 'done'
    setTimeout(closeReport, 1200)
  } catch {
    reportState.value = 'error'
  }
}

const familyOf = (fam: string) => familyDisplay(fam, currentLocale())
const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

// ---- 素材池与切换（递减计时） ----
/** 同类型素材池（assets 由引擎携带，best-first；含默认题面） */
const assetPool = computed<MediaAsset[]>(() => {
  const q = quiz.current
  if (!q) return []
  return q.assets && q.assets.length ? q.assets : [q.media]
})
/** 当前题已切换次数（第 n 次切换限时 −n s） */
const switches = ref(0)
/** 当前素材下标（在 assetPool 内；切题时重置） */
const assetIdx = ref(0)
const currentMedia = computed<MediaAsset | null>(() => assetPool.value[assetIdx.value] ?? quiz.current?.media ?? null)
/** 本题基础限时（引擎已按题型给：图 15s / 音 18s） */
const baseLimit = computed(() => quiz.current?.timeLimitSec ?? 15)
/** 切换后仍 >0 才允许再切（减尽禁用，不可无限刷素材） */
const canSwitch = computed(() => {
  if (!quiz.current || quiz.answered) return false
  if (assetIdx.value + 1 >= assetPool.value.length) return false
  return baseLimit.value - (switches.value + 1) > 0
})
/** 切一次素材：重置输入与计时（等新素材就绪：图 load / 音开播） */
function switchAsset() {
  if (!canSwitch.value) return
  assetIdx.value++
  switches.value++
  draft.value = ''
  beginTiming()
}

// ---- 072-a 说明 / 诊断行（与 L6 同款） ----
const shortRoundNote = computed(() => {
  const d = quiz.lastBuild
  if (!d || d.built >= d.want) return ''
  return t('quiz.shortRound', { built: d.built, want: d.want })
})
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

/** 答疑入口：仅作答后显示（题面即谜底，提前入口=泄题） */
const bankReady = ref(false)
const faqId = computed<string | null>(() => {
  if (!bankReady.value || !quiz.answered) return null
  const id = quiz.current?.media?.speciesId
  return id && speciesNoteById(id) ? id : null
})

const nextLabel = computed(() =>
  quiz.index + 1 >= quiz.total ? t('quiz.viewResult') : t('quiz.next'),
)

// ---- 输入框（IME 门禁是本题型命门） ----
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const composing = ref(false)
function onCompositionStart() {
  composing.value = true
}
function onCompositionEnd() {
  composing.value = false
}
/** 提交：空输入不判（未作答）；非空走中心判分（quiz.answer 内部由 correctCount 判分） */
function submitAnswer() {
  if (composing.value) return // 候选期 Enter = 选词
  if (quiz.answered || !quiz.current) return
  const v = draft.value.trim()
  if (!v) return
  // 诊断（?diag=1）：记录输入来源与距切题的毫秒数（观察输入框焦点/自动提交类异常）
  diagMarkAnswer({
    questionIndex: quiz.index,
    questionId: quiz.current.id,
    value: v,
    source: 'key',
    autoPending: autoPending.value,
  })
  quiz.answer(v)
}

// ---- 计时：图/音都等媒体就绪（图 load / 音开播）；切换素材重置 ----
const timeLeft = ref<number | null>(null)
const timerBegun = ref(false)
let tick: number | undefined

/** 媒体就绪门：网络等待不计入答题时间 */
const gate = useMediaGate()

function stopTimer() {
  if (tick !== undefined) {
    clearInterval(tick)
    tick = undefined
  }
}
function startTimer() {
  stopTimer()
  const limit = Math.max(1, baseLimit.value - switches.value)
  timeLeft.value = limit
  if (quiz.answered) {
    timeLeft.value = null
    return
  }
  tick = window.setInterval(() => {
    if (timeLeft.value === null) return
    timeLeft.value -= 1
    if (timeLeft.value <= 0) {
      stopTimer()
      onTimeUp()
    }
  }, 1000)
}
/** D-10：计时到 → 按当时输入判（非空=提交判，空=错）；不宽限 */
function onTimeUp() {
  if (quiz.answered) return
  const v = draft.value.trim()
  if (v) quiz.answer(v)
  else quiz.timeUp()
}
/** 听音：正式开播才起计（加载/网络不耗时）；换素材后同样等开播 */
function onMediaAudioPlay() {
  gate.release()
}

/** 图片加载成功/失败：交给门禁计数（失败达 1/3 时门禁自行测速） */
function onImageSettled(ok: boolean) {
  if (ok) gate.markLoaded()
  else gate.markFailed()
}

// 门禁放行即开始计时（图 load / 音开播 / 兜底 都在这里汇合）
watch(
  () => gate.ready.value,
  (ok) => {
    if (!ok || quiz.answered || timerBegun.value) return
    timerBegun.value = true
    startTimer()
  },
)

// ---- 自动切题 / 反馈（与 L6 同款骨架） ----
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
const warnThreshold = computed(() => 5)

/** 媒体加载失败过多时的提示（带实时网速） */
const networkNote = computed(() => {
  const speed = gate.speedMbps.value
  return speed === null
    ? t('quiz.networkPoorUnknown')
    : t('quiz.networkPoor', { speed: speed.toFixed(1) })
})

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

onMounted(() => {
  document.addEventListener('keydown', onKey)
  void loadBank()
    .then(() => (bankReady.value = true))
    .catch(() => {})
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
    ambiencePlayer.stop()
  }
  diagMarkAdvance()
  preloadQuestions(quiz.questions, quiz.index, 2)
  beginTiming()
  void nextTick(() => inputRef.value?.focus())
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  stopTimer()
  clearAutoNext()
})

/** 每题计时起点：等题面媒体就绪（图 load / 音开播） */
function beginTiming() {
  timerBegun.value = false
  // 图：等 image-settled（1s 兜底）；音：等 audio-play（不设兜底）
  gate.reset(1, props.type === 'image', currentMedia.value?.url)
  // 听音：音频可能永远播不出来，10s 后放行并记为失败
  if (props.type === 'audio') gate.armStall()
  stopTimer()
  timeLeft.value = Math.max(1, baseLimit.value - switches.value) // 冻结显示，等就绪信号
  if (gate.ready.value) {
    timerBegun.value = true
    startTimer()
  }
}

watch(
  () => quiz.index,
  (i) => {
    clearAutoNext()
    cancelledThisQuestion.value = false
    switches.value = 0
    assetIdx.value = 0
    draft.value = ''
    diagMarkAdvance()
    preloadQuestions(quiz.questions, i + 1, 1)
    beginTiming()
    void nextTick(() => inputRef.value?.focus())
  },
)
watch(
  () => quiz.answered,
  (a) => {
    if (a) {
      stopTimer()
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
  if (showReport.value) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  // 输入框内除 Enter 外不接管（Enter 的提交走 input 自身 keyup；这里只管已作答后的切题键）
  const el = e.target
  const inField =
    el instanceof HTMLElement &&
    (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
  if (quiz.answered) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
      if (inField) return // 输入框残留焦点时空格别切题
      e.preventDefault()
      goNext()
    }
    return
  }
  if (inField) return
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    submitAnswer()
  }
}

// ---- 触屏左滑 = 下一题（已作答后） ----
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
</script>

<template>
  <!-- G1 报错浮窗 -->
  <Teleport to="body">
    <div
      v-if="showReport"
      class="wizard-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('report.title')"
      @click.self="closeReport"
    >
      <div ref="reportPanelRef" class="wizard-panel report-panel">
        <h3 class="wizard-title"><Flag class="ic" :size="18" /> {{ t('report.title') }}</h3>
        <template v-if="reportState !== 'done'">
          <p class="wizard-sub">{{ t('report.sub') }}</p>
          <p class="report-label">{{ t('report.reasonLabel') }}</p>
          <div class="report-reasons" role="group" :aria-label="t('report.reasonLabel')">
            <button
              v-for="r in REPORT_REASONS"
              :key="r.id"
              type="button"
              class="reason"
              :class="{ on: reportReason === r.id }"
              :aria-pressed="reportReason === r.id"
              @click="reportReason = r.id"
            >
              {{ t(r.labelKey) }}
            </button>
          </div>
          <label class="report-field">
            <span>{{ t('report.answerLabel') }}</span>
            <input v-model="reportAnswer" type="text" :placeholder="t('report.answerPlaceholder')" />
          </label>
          <label class="report-field">
            <span>{{ t('report.noteLabel') }}</span>
            <textarea v-model="reportNote" rows="2" :placeholder="t('report.notePlaceholder')"></textarea>
          </label>
          <p v-if="reportState === 'error'" class="report-err" role="alert">{{ t('report.error') }}</p>
          <div class="wizard-actions">
            <button class="btn btn-primary" type="button" @click="submitReport">{{ t('report.submit') }}</button>
            <button class="btn btn-secondary" type="button" @click="closeReport">{{ t('common.cancel') }}</button>
          </div>
        </template>
        <p v-else class="report-done">{{ t('report.done') }}</p>
      </div>
    </div>
  </Teleport>

  <template v-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <p v-if="shortRoundNote" class="short-round-note" role="status">{{ shortRoundNote }}</p>
    <p v-if="gate.shouldPromptRetry.value" class="network-note" role="alert">{{ networkNote }}</p>
    <p v-if="diagOn && diagHead" class="diag-line" data-testid="diag-line">
      {{ diagHead }}<br /><span class="diag-body">{{ diagBody }}</span>
    </p>
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
          quiz.answered || quiz.index > 0 ? t('quiz.accuracyLabel', { acc: quiz.accuracy }) : '--'
        }}</span>
      </span>
    </div>

    <div class="card" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
      <button class="quit-corner" type="button" @click="quitRound">
        <LogOut class="ic" :size="13" /> {{ t('quiz.quit') }}
      </button>

      <!-- 题面：图/音（音=正式开播起计） -->
      <MediaCard
        :key="currentMedia?.url ?? quiz.current.id"
        :type="quiz.current.type"
        :media="currentMedia ?? quiz.current.media"
        :autoplay="quiz.current.type === 'audio' && quiz.index >= 1 && settings.autoplayAudio"
        :autoplay-delay="settings.autoplayDelayMs"
        :show-attribution="false"
        @audio-play="onMediaAudioPlay"
        @image-settled="onImageSettled"
      />

      <!-- 作答区：输入框 + 提交（IME 门禁见 input 事件） -->
      <form class="answer-row" @submit.prevent="submitAnswer">
        <input
          ref="inputRef"
          v-model="draft"
          class="answer-input"
          type="text"
          :placeholder="t('quiz7.placeholder')"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="quiz.answered"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keyup.enter="submitAnswer"
        />
        <button class="btn btn-primary" type="submit" :disabled="quiz.answered || !draft.trim()">
          {{ t('quiz7.submit') }}
        </button>
      </form>

      <!-- 素材切换：重新计时、限时 −n s（减尽禁用） -->
      <div class="switch-row">
        <button
          v-if="assetPool.length > 1"
          class="btn-mini"
          type="button"
          :disabled="!canSwitch"
          :title="canSwitch ? t('quiz7.switchHint', { n: switches + 1 }) : t('quiz7.switchDisabled')"
          @click="switchAsset"
        >
          <RefreshCw class="ic" :size="12" />
          {{ t('quiz7.switchLabel') }}
          <span v-if="canSwitch" class="muted">−{{ switches + 1 }}s</span>
        </button>
        <span v-else class="muted small">{{ t('quiz7.noAltAsset') }}</span>
      </div>

      <button class="report-link" type="button" @click="openReport">
        <Flag class="ic" :size="14" /> {{ t('report.button') }}
      </button>

      <RouterLink v-if="faqId" class="faq-link" :to="`/faq/${faqId}`">
        {{ type === 'audio' ? t('faq.whyAudio') : t('faq.whyImage') }}
      </RouterLink>

      <!-- 自动切换浮窗 -->
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
              <span>
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

      <!-- 常驻反馈 -->
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
        <template v-if="!isCorrect && quiz.currentChoice && quiz.currentChoice !== TIMEOUT">
          {{ t('quiz7.yourAnswer', { input: quiz.currentChoice }) }}
        </template>
        {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
          t('quiz.answerSci', { sci: quiz.current.sci })
        }}
        <span class="muted"> · {{ familyOf(quiz.current.family) }}</span>
      </div>

      <div v-if="showDisableBtn || showEnableBtn" class="auto-ctrl">
        <button v-if="showDisableBtn" class="btn-mini" type="button" @click="disableAuto">
          <X class="ic" :size="12" /> {{ t('quiz.disableAuto') }}
        </button>
        <button v-else-if="showEnableBtn" class="btn-mini" type="button" @click="enableAuto">
          <Play class="ic" :size="12" /> {{ t('quiz.enableAuto') }}
        </button>
      </div>

      <div v-if="showInline" class="actions">
        <button class="btn btn-primary" @click="goNext">
          {{ nextLabel }}
          <ArrowRight class="ic" :size="16" />
        </button>
      </div>
      <div v-if="quiz.answered && !autoPending" class="quiz-foot">
        <span class="foot-hint">
          <Keyboard class="ic" :size="13" /> {{ t('quiz.footPress') }}
          <ArrowRight class="ic" :size="12" /> {{ t('quiz.footOrSpace') }} ·
          <Smartphone class="ic" :size="13" /> {{ t('quiz.footSwipe') }}
        </span>
      </div>

      <AttributionLine class="quiz-attr" :media="currentMedia ?? quiz.current.media" />
    </div>
  </template>
</template>


<style scoped>
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
.wizard-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(10, 30, 22, 0.55);
  backdrop-filter: blur(6px);
}
.wizard-panel {
  width: min(480px, 100%);
  background: #fff;
  border-radius: var(--radius);
  padding: 24px;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.6);
}
.wizard-title {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--primary-dark);
  text-align: center;
  margin-bottom: 6px;
}
.wizard-sub {
  font-size: 0.82rem;
  color: var(--text-light);
  text-align: center;
  margin-bottom: 14px;
}
.wizard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 16px;
}
.wizard-actions .btn {
  flex: 1;
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
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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
  z-index: 2;
}
.quit-corner:hover {
  color: var(--wrong);
  border-color: var(--wrong);
  background: #fff;
}
.card {
  position: relative;
}
/* 作答行：输入框 + 提交 */
.answer-row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.answer-input {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border: 2px solid var(--primary-light);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 1rem;
}
.answer-input:focus {
  outline: none;
  border-color: var(--primary);
}
.answer-input:disabled {
  background: #f5f8f6;
  color: var(--text-light);
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  min-height: 26px;
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
.btn-mini:hover:not(:disabled) {
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
}
.btn-mini:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.report-link {
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
.report-link:hover {
  color: var(--primary);
}
.report-panel {
  text-align: left;
  max-width: 400px;
}
.report-panel .wizard-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.report-panel .wizard-title .ic {
  color: var(--primary);
}
.report-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
  margin: 12px 0 6px;
}
.report-reasons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.report-reasons .reason {
  padding: 8px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
}
.report-reasons .reason.on {
  border-color: var(--primary);
  background: #eaf4ef;
  font-weight: 700;
}
.report-field {
  display: block;
  margin-top: 12px;
}
.report-field span {
  display: block;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
  margin-bottom: 4px;
}
.report-field input,
.report-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--text);
  resize: vertical;
}
.report-err {
  margin-top: 10px;
  color: var(--wrong);
  font-size: 0.8rem;
}
.report-done {
  margin: 12px 0;
  text-align: center;
  color: var(--primary);
  font-weight: 700;
}
.faq-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 12px 0 0 10px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f0f4f2;
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 600;
  transition: all 0.18s ease;
}
.faq-link:hover {
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
  text-decoration: none;
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
.quiz-attr {
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
  transition: opacity 0.25s ease, transform 0.25s ease;
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
.ct-next {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.ct-next:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  filter: brightness(0.94);
}
@keyframes pop {
  0% { transform: scale(0.96); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
