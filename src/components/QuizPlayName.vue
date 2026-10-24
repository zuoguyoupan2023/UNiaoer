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
import { isDiag } from '@/core/diag'
import { TIERS } from '@/core/difficulty'
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
  Smartphone,
  Timer,
  X,
} from 'lucide-vue-next'
import type { MediaType } from '@/types'
import AttributionLine from './AttributionLine.vue'
import OptionMediaList from './OptionMediaList.vue'
import ProgressBar from './ProgressBar.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()

// ---- G1 报错按钮（与经典卷同款） ----
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
      mediaUrl: q.media?.url,
      reason: reportReason.value,
      suggestedAnswer: reportAnswer.value.trim() || undefined,
      note: reportNote.value.trim() || undefined,
    })
    try {
      await uploadReport(row, getClientId())
      await markReportSynced(row.id)
      track('report_submit')
    } catch {
      /* 离线/后端不可用：保留 pending */
    }
    reportState.value = 'done'
    setTimeout(closeReport, 1200)
  } catch {
    reportState.value = 'error'
  }
}

/** 科名「拉丁名+本地名」组合，随 locale 切换（015 #2） */
const familyOf = (fam: string) => familyDisplay(fam, currentLocale())

const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

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

/** 答疑专栏入口：**仅作答后**显示（题干是答案名，答题前入口会泄露答案） */
const bankReady = ref(false)
const faqId = computed<string | null>(() => {
  if (!bankReady.value || !quiz.answered) return null
  const id = quiz.current?.media?.speciesId
  return id && speciesNoteById(id) ? id : null
})

/** 「下一题」；最后一题改为「查看结果」 */
const nextLabel = computed(() =>
  quiz.index + 1 >= quiz.total ? t('quiz.viewResult') : t('quiz.next'),
)

// ---- 计时：L6 无「先听题面音频」阶段，看图/听音都在切题后立即开始；选项即刻可见 ----
const timeLeft = ref<number | null>(null)
let tick: number | undefined

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

// ---- L6 选项试听（听音版）：作答后停播 ----
const optionListRef = ref<InstanceType<typeof OptionMediaList> | null>(null)

onMounted(() => {
  document.addEventListener('keydown', onKey)
  // 答疑入口需要物种 notes（bank 通常已由 startName 加载，此处兜底）
  void loadBank()
    .then(() => (bankReady.value = true))
    .catch(() => {})
  // 「再来一轮」续轮（ResultView → nextRound 重建题目后回到本页）
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
    ambiencePlayer.stop()
  }
  preloadQuestions(quiz.questions, quiz.index, 2) // 当前题 + 下 1 题（每题素材多，少预）
  startTimer()
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
    preloadQuestions(quiz.questions, i + 1, 1) // 之后 1 题（每题素材多，少预）
    startTimer()
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
  <!-- G1 报错浮窗（本地记录） -->
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
        <h3 class="wizard-title">
          <Flag class="ic" :size="18" /> {{ t('report.title') }}
        </h3>

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

          <p v-if="reportState === 'error'" class="report-err" role="alert">
            {{ t('report.error') }}
          </p>

          <div class="wizard-actions">
            <button class="btn btn-primary" type="button" @click="submitReport">
              {{ t('report.submit') }}
            </button>
            <button class="btn btn-secondary" type="button" @click="closeReport">
              {{ t('common.cancel') }}
            </button>
          </div>
        </template>

        <p v-else class="report-done">{{ t('report.done') }}</p>
      </div>
    </div>
  </Teleport>

  <!-- 答题 -->
  <template v-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <p v-if="shortRoundNote" class="short-round-note" role="status">{{ shortRoundNote }}</p>
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
        <span v-if="timeLeft !== null && !quiz.answered" class="timer" :class="{ warn: timeLeft <= warnThreshold }">
          <Timer class="ic" :size="14" /> {{ timeLeft }}s
        </span>
        <span v-else>{{
          quiz.answered || quiz.index > 0
            ? t('quiz.accuracyLabel', { acc: quiz.accuracy })
            : '--'
        }}</span>
      </span>
    </div>

    <div class="card" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
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
        @select="quiz.answer($event)"
      />

      <!-- G1 报错按钮 -->
      <button class="report-link" type="button" @click="openReport">
        <Flag class="ic" :size="14" /> {{ t('report.button') }}
      </button>

      <!-- 答疑专栏入口（仅作答后显示，避免泄露答案） -->
      <RouterLink v-if="faqId" class="faq-link" :to="`/faq/${faqId}`">
        {{ props.type === 'audio' ? t('faq.whyAudio') : t('faq.whyImage') }}
      </RouterLink>

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
        {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
          t('quiz.answerSci', { sci: quiz.current.sci })
        }}
        <span class="muted"> · {{ familyOf(quiz.current.family) }}</span>
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

      <!-- 署名：选项素材的合并署名行（作答前就在，许可义务不因题型打折） -->
      <div v-if="optionAttributions.length" class="option-attr">
        <template v-for="(a, i) in optionAttributions" :key="i">
          <template v-if="i > 0"> · </template>
          <a v-if="a.href" :href="a.href" target="_blank" rel="noopener noreferrer"
            >{{ a.source }} · {{ a.author }} ({{ a.license }})</a
          >
          <span v-else>{{ a.source }} · {{ a.author }} ({{ a.license }})</span>
        </template>
      </div>
      <AttributionLine v-else class="quiz-attr" :media="quiz.current.media" />
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
.quit-corner:hover {
  color: var(--wrong);
  border-color: var(--wrong);
  background: #fff;
}
.card {
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
.option-attr a:hover {
  color: var(--primary);
}
.quiz-attr {
  margin-top: 14px;
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
.btn-mini:hover {
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
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
@keyframes pop {
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
