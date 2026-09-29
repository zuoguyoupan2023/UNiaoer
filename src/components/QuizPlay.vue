<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { preloadQuestions } from '@/core/mediaLoader'
import { ambiencePlayer, interferencePlayer } from '@/core/ambience'
import {
  AUTO_NEXT_DELAY_CORRECT_MS,
  AUTO_NEXT_DELAY_WRONG_MS,
  secondsUntilReveal,
} from '@/core/pacing'
import { isLeftSwipe } from '@/core/swipe'
import { TIER_LIST, TIERS } from '@/core/difficulty'
import {
  AlarmClock,
  ArrowRight,
  AudioLines,
  CircleCheck,
  CircleX,
  Hourglass,
  Image as ImageIcon,
  Keyboard,
  LogOut,
  Play,
  Smartphone,
  Timer,
  X,
} from 'lucide-vue-next'
import type { MediaAsset, MediaType, Tier } from '@/types'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import AttributionLine from './AttributionLine.vue'
import MediaCard from './MediaCard.vue'
import OptionList from './OptionList.vue'
import ProgressBar from './ProgressBar.vue'
import SpeciesGallery from './SpeciesGallery.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()
/** 科名「拉丁名+本地名」组合，随 locale 切换（015 #2） */
const familyOf = (fam: string) => familyDisplay(fam, currentLocale())

// 从结果页「再来一轮」进入时，跳过介绍页直接续答（D4）
const started = ref(quiz.pendingContinue && quiz.questions.length > 0)
const tier = ref<Tier>(quiz.tier)

const intro = computed(() =>
  props.type === 'audio'
    ? { title: t('nav.audioQuiz'), lead: t('quiz.introAudioLead') }
    : { title: t('nav.imageQuiz'), lead: t('quiz.introImageLead') },
)

const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

// ---- C3 同种多素材查看（R8）：可切换该鸟的其它图/音，并支持跨类型 ----
/** 用户手动选择的素材（null = 用题目默认题面） */
const selected = ref<MediaAsset | null>(null)
watch(
  () => quiz.current?.id,
  () => {
    selected.value = null
  },
)
/** 同类型全部素材（buildQuestions 提供，不按档位裁剪，L1 也全给）；缺省回退当前题面 */
const samePool = computed<MediaAsset[]>(() => {
  const q = quiz.current
  if (!q) return []
  return q.assets && q.assets.length ? q.assets : [q.media]
})
/** 另一类型池（跨类型：看图题听鸟鸣 / 听音题看图） */
const crossPool = computed<MediaAsset[]>(() => quiz.current?.crossAssets ?? [])
/** 当前真正展示的素材 */
const displayMedia = computed<MediaAsset | null>(
  () => selected.value ?? quiz.current?.media ?? samePool.value[0] ?? null,
)
/** 当前展示类型（跨类型切换时会变） */
const displayType = computed<MediaType>(
  () => displayMedia.value?.type ?? quiz.current?.type ?? props.type,
)
const galleryImages = computed<MediaAsset[]>(() =>
  quiz.current?.type === 'image' ? samePool.value : crossPool.value,
)
const galleryAudios = computed<MediaAsset[]>(() =>
  quiz.current?.type === 'audio' ? samePool.value : crossPool.value,
)
/** 「下一题」；最后一题改为「查看结果」（没有第 11 题） */
const nextLabel = computed(() =>
  quiz.index + 1 >= quiz.total ? t('quiz.viewResult') : t('quiz.next'),
)

// ---- 计时 ----
const timeLeft = ref<number | null>(null)
/** 本题计时是否已真正开始（听音版等考题音频开播，R24） */
const timerBegun = ref(false)
let tick: number | undefined

/** D1：限时题前段隐藏选项（缺省 1/3；L1 固定前 5s），revealInSec 为出现前倒计时秒数 */
const revealInSec = computed(() => {
  if (quiz.answered || !quiz.current) return null
  const q = quiz.current
  return secondsUntilReveal(q.timeLimitSec, timeLeft.value, TIERS[q.tier]?.optionRevealSec)
})
const optionsHidden = computed(() => revealInSec.value !== null)

function stopTimer() {
  if (tick !== undefined) {
    clearInterval(tick)
    tick = undefined
  }
}

/** 把计时冻结在满值显示（听音版音频未开播时不倒数，R24） */
function resetTimer() {
  stopTimer()
  const q = quiz.current
  timeLeft.value = q?.timeLimitSec ?? null
}

/** 真正开始倒数：看图=切题即开始；听音=考题音频开播后（R24） */
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

// ---- D2 自动下一题 / R43 浮窗与取消 ----
const autoPending = ref(false)
/** 本题是否被用户点了「取消切换」（只影响这一次） */
const cancelledThisQuestion = ref(false)
let autoNextTimer: number | undefined
/** 浮窗倒计时（秒，015 #4：精确到 0.1s 实时递减） */
const autoNextRemaining = ref<number | null>(null)
let autoNextTicker: number | undefined

/** 是否处于"会自动切换"的情形：「都自动」=任意；「答对自动」=仅答对 */
const willAuto = computed(() => {
  const mode = settings.autoNext
  return mode === 'all' || (mode === 'correct' && isCorrect.value)
})
/** 自动切换中：显示浮窗 */
const showToast = computed(() => quiz.answered && willAuto.value && !cancelledThisQuestion.value)
/** 其余已作答情形（手动 / 不触发自动 / 取消本次后）：下方常驻 */
const showInline = computed(() => quiz.answered && !showToast.value)
/** 「不再自动切换」仅在"取消本次"后出现 */
const showDisableBtn = computed(
  () => quiz.answered && cancelledThisQuestion.value && settings.autoNext !== 'manual',
)
/** 彻底手动时出现「自动切换」 */
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
  // 答对 3s；「都自动」的错题/超时 4s
  const delay = isCorrect.value ? AUTO_NEXT_DELAY_CORRECT_MS : AUTO_NEXT_DELAY_WRONG_MS
  // 浮窗实时倒计时（0.1s 步进，015 #4）
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

/** 取消切换：只停"本次"自动切换 → 回落下方常驻，并出现「不再自动切换」（R43） */
function cancelAutoOnce() {
  clearAutoNext()
  cancelledThisQuestion.value = true
}

/** 不再自动切换：与设置互通，后续一律手动（R43） */
function disableAuto() {
  clearAutoNext()
  settings.autoNext = 'manual'
  cancelledThisQuestion.value = false
}

/** 手动模式点「自动切换」：恢复默认"答对自动"，并在本题已答对时立即开始倒计时（R43） */
function enableAuto() {
  settings.autoNext = 'correct'
  scheduleAutoNext()
}

/** 计时变红的最后秒数：L4/L5 为 3s，其余 5s（R30） */
const warnThreshold = computed(() => (quiz.current && quiz.current.tier >= 4 ? 3 : 5))

/** 中途退出测试：已作答部分按"截至成绩"落库（错题本/统计同步），未答题目不计 */
function quitRound() {
  const n = quiz.answeredCount
  const msg =
    n > 0
      ? t('quiz.quitConfirmDetail', { n, total: quiz.total })
      : t('quiz.quitConfirmEmpty')
  if (!confirm(msg)) {
    // 隐藏徽章"浪子回头"：点了取消留下来继续答（R28）
    quiz.escapedQuit = true
    return
  }
  stopTimer()
  clearAutoNext()
  interferencePlayer.stop()
  if (n === 0) {
    quiz.reset()
    router.push('/')
    return
  }
  quiz.truncateTo(n)
  router.push('/result') // ResultView 落库：截断后的轮次 + 错题本 + 徽章
}

async function begin() {
  started.value = true
  // 环境鸟鸣是全局功能，但测试开始后不播放（选难度阶段不算开始，见 R23）
  ambiencePlayer.stop()
  await quiz.start(props.type, { tier: tier.value })
  preloadQuestions(quiz.questions, 0, 4) // 当前题 + 后 3 题
  beginQuestionTiming()
  updateInterference()
}

/** 每题计时/干扰的启动点：看图=切题即开始；听音=考题音频开播后（R24） */
function beginQuestionTiming() {
  timerBegun.value = false
  if (props.type === 'image') {
    timerBegun.value = true
    startTimer()
  } else {
    resetTimer() // 冻结在满值，等 MediaCard 的 audio-play
  }
}

/** 听音版考题音频开播：计时开始；L5 地狱此时才启动干扰音 */
function onQuestionAudioPlay() {
  if (quiz.answered || timerBegun.value) return
  timerBegun.value = true
  startTimer()
  updateInterference()
}

/** L5 地狱干扰：看图 2 条切题即启；听音 1 条等考题音频开播；作答即停 */
function updateInterference() {
  const q = quiz.current
  if (quiz.tier !== 5 || !q || quiz.answered || !timerBegun.value) {
    interferencePlayer.stop()
    return
  }
  void interferencePlayer.start(q.type === 'image' ? 2 : 1, q.type === 'image' ? 0.35 : 0.25)
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
    // 从结果页续轮也是"测试开始"：环境鸟鸣停播
    ambiencePlayer.stop()
    preloadQuestions(quiz.questions, 0, 4)
    beginQuestionTiming()
    updateInterference()
  } else {
    // 清掉上一轮残留（结果页/切模式后再进入时），让介绍页回到"非答题中"状态
    quiz.questions = []
    quiz.chosen = []
    quiz.index = 0
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  stopTimer()
  clearAutoNext()
  interferencePlayer.stop()
})

watch(
  () => quiz.index,
  (i) => {
    clearAutoNext()
    cancelledThisQuestion.value = false
    preloadQuestions(quiz.questions, i + 1, 3) // 之后 3 题
    beginQuestionTiming() // 计时起点：看图立即 / 听音等音频开播（R24）
    updateInterference()
  },
)
watch(
  () => quiz.answered,
  (a) => {
    if (a) {
      stopTimer()
      scheduleAutoNext()
    } else {
      clearAutoNext()
      cancelledThisQuestion.value = false
    }
    updateInterference() // 作答后停止干扰；进入下一题（未作答）再开启
  },
)
watch(
  () => quiz.finished,
  (f) => {
    if (f) router.push('/result')
  },
)

function onKey(e: KeyboardEvent) {
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

  if (optionsHidden.value) return
  const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 }
  const idx = map[e.key.toLowerCase()]
  if (idx !== undefined) {
    const opt = q.options[idx]
    if (opt) quiz.answer(opt)
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
</script>

<template>
  <!-- 介绍页 -->
  <section v-if="!started" class="card intro">
    <div class="intro-head">
      <div class="intro-icon">
        <AudioLines v-if="type === 'audio'" :size="30" />
        <ImageIcon v-else :size="30" />
      </div>
      <h2>{{ intro.title }}</h2>
    </div>
    <p class="lead muted">{{ intro.lead }}</p>

    <p v-if="quiz.wrongPoolOnly" class="wrong-hint">
      <CircleX class="ic" :size="15" /> {{ t('quiz.wrongPoolHint') }}
    </p>

    <div class="tiers">
      <button
        v-for="cfg in TIER_LIST"
        :key="cfg.tier"
        class="tier"
        :class="{ on: tier === cfg.tier }"
        @click="tier = cfg.tier"
      >
        <strong>{{ t(cfg.labelKey) }}</strong>
        <span>{{ t(cfg.descKey) }}</span>
      </button>
    </div>

    <button class="btn btn-primary" @click="begin">{{ t('quiz.start') }}</button>
  </section>

  <!-- 加载中 -->
  <section v-else-if="quiz.loading" class="card center placeholder">
    <div class="spinner"></div>
    <h2>{{ t('quiz.preparing') }}</h2>
    <p class="muted">{{ t('quiz.preparingSub') }}</p>
  </section>

  <!-- 出错 -->
  <section v-else-if="quiz.error" class="card center placeholder">
    <div class="emoji">🗂️</div>
    <h2>{{ t('quiz.cannotStart') }}</h2>
    <p class="muted">{{ t(`errors.${quiz.error}`) }}</p>
    <p style="margin-top: 18px">
      <RouterLink class="btn btn-secondary" to="/">{{ t('quiz.backHome') }}</RouterLink>
    </p>
  </section>

  <!-- 答题 -->
  <template v-else-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <!-- 状态行：左=难度 · 中=题号 · 右=计时/正确率（R24 三栏紧凑布局） -->
    <div class="status-bar">
      <span class="sb-left">
        <span class="tier-tag">{{ t(TIERS[quiz.current.tier].labelKey) }}</span>
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
      <MediaCard
        :key="quiz.current.id"
        :type="displayType"
        :media="displayMedia ?? quiz.current.media"
        :autoplay="quiz.current.type === 'audio' && quiz.index >= 1 && settings.autoplayAudio"
        :autoplay-delay="settings.autoplayDelayMs"
        :show-attribution="false"
        @audio-play="onQuestionAudioPlay"
      >
        <template #media-corner>
          <button class="quit-corner" type="button" @click="quitRound">
            <LogOut class="ic" :size="13" /> {{ t('quiz.quit') }}
          </button>
        </template>
      </MediaCard>

      <!-- C3 同种多素材（R8）：查看并切换该鸟的其它图/音（含跨类型；L1 也展示全部） -->
      <SpeciesGallery
        :images="galleryImages"
        :audios="galleryAudios"
        :active-url="displayMedia?.url"
        mode="select"
        :label="t('gallery.title')"
        @select="selected = $event"
      />

      <OptionList
        :options="quiz.current.options"
        :answer="quiz.current.answer"
        :chosen="quiz.currentChoice"
        :hidden="optionsHidden"
        :reveal-in-sec="revealInSec"
        :mode="quiz.current.type"
        @select="quiz.answer($event)"
      />

      <!-- 自动切换中：浮窗（答对 3s / 都自动的错题 4s），可「取消切换」（R43） -->
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
            <span class="ct-count">
              <Hourglass class="ic" :size="13" />
              {{ t('quiz.autoAdvancing', { sec: (autoNextRemaining ?? 0).toFixed(1) }) }}
            </span>
            <button class="btn-mini" type="button" @click="cancelAutoOnce">{{ t('quiz.cancelAuto') }}</button>
            <button class="btn-mini ct-next" type="button" @click="goNext">{{ nextLabel }}</button>
          </div>
        </div>
      </Transition>

      <!-- 下方常驻反馈：手动 / 不触发自动 / 取消了本次自动 时显示 -->
      <div v-if="showInline" class="feedback" :class="isCorrect ? 'ok' : 'no'">
        <strong v-if="timedOut"><AlarmClock class="ic" :size="16" /> {{ t('quiz.timeout') }}</strong>
        <strong v-else-if="isCorrect"><CircleCheck class="ic" :size="16" /> {{ t('quiz.correct') }}</strong>
        <strong v-else><CircleX class="ic" :size="16" /> {{ t('quiz.wrong') }}</strong>
        {{ t('quiz.correctAnswer') }}<b>{{ quiz.current.answer }}</b>{{
          t('quiz.answerSci', { sci: quiz.current.sci })
        }}
        <span class="muted"> · {{ familyOf(quiz.current.family) }}</span>
      </div>

      <!-- 「不再自动切换」仅在取消本次后出现；彻底手动时出现「自动切换」 -->
      <div v-if="showDisableBtn || showEnableBtn" class="auto-ctrl">
        <button v-if="showDisableBtn" class="btn-mini" type="button" @click="disableAuto">
          <X class="ic" :size="12" /> {{ t('quiz.disableAuto') }}
        </button>
        <button v-else-if="showEnableBtn" class="btn-mini" type="button" @click="enableAuto">
          <Play class="ic" :size="12" /> {{ t('quiz.enableAuto') }}
        </button>
      </div>

      <!-- 自动切换浮窗期间隐藏主按钮（避免重复）；取消/手动时恢复显示 -->
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

      <!-- 署名信息移到卡片最底部，避免干扰（R41）；切换素材后跟随当前素材 -->
      <AttributionLine class="quiz-attr" :media="displayMedia ?? quiz.current.media" />
    </div>
  </template>
</template>

<style scoped>
.intro {
  text-align: center;
}
/* 图标与标题同行，压缩介绍页高度（R26） */
.intro-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 8px;
}
.intro-head h2 {
  margin: 0;
  font-size: 1.25rem;
}
.intro-icon {
  display: flex;
  color: var(--primary);
  animation: float 3s ease-in-out infinite;
}
.intro .lead {
  margin-bottom: 18px;
}
.wrong-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  margin-bottom: 14px;
  border-radius: 20px;
  background: #fdecee;
  color: var(--wrong);
  font-size: 0.82rem;
  font-weight: 600;
}
.tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  max-width: 520px;
  margin: 0 auto 22px;
}
@media (max-width: 520px) {
  .tiers {
    grid-template-columns: 1fr;
  }
}
.tier {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: all 0.18s ease;
}
/* 5 个档位时最后一个奇数位横跨两列，避免孤行 */
.tier:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
.tier:hover {
  border-color: var(--primary-light);
}
.tier.on {
  border-color: var(--primary);
  background: #f3fbf7;
}
.tier strong {
  font-size: 0.9rem;
}
.tier span {
  font-size: 0.74rem;
  color: var(--text-light);
}
.intro .btn {
  min-width: 180px;
}
/* 状态行：左=难度 · 中=题号 · 右=计时/正确率（R24 三栏紧凑布局） */
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
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 8px;
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
}
.timer {
  font-variant-numeric: tabular-nums;
  background: #eaf4ef;
  padding: 3px 10px;
  border-radius: 10px;
}
.timer.warn {
  color: var(--wrong);
  background: #fdecee;
  font-size: 1rem; /* R30：警告期字号变大（比正常大 2 号），更醒目 */
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
.feedback {
  margin-top: 16px;
  padding: 15px 18px;
  border-radius: 14px;
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
/* 署名移到卡片最底部（R41） */
.quiz-attr {
  margin-top: 14px;
}
/* 自动切换浮窗（R43）：可点击「取消切换」，取消后回落到下方常驻 */
.correct-toast {
  position: fixed;
  left: 50%;
  bottom: 21vh;
  z-index: 80;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: min(92vw, 560px);
  padding: 12px 18px;
  border-radius: 14px;
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
  line-height: 1.35;
  text-align: left;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ct-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.74rem;
  color: var(--primary);
  white-space: nowrap;
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
  transform: translateX(-50%) translateY(10px);
}
/* 自动切换控制行（R43） */
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
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
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
/* 浮窗内的「下一题/查看结果」：宽度贴合文字（不撑满），更醒目 */
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
.quit-corner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
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
.spinner {
  width: 46px;
  height: 46px;
  border: 5px solid #dceee4;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  margin: 0 auto 16px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
</style>
