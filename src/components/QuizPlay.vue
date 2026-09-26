<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { preloadQuestions } from '@/core/mediaLoader'
import { ambiencePlayer, interferencePlayer } from '@/core/ambience'
import { AUTO_NEXT_DELAY_MS, secondsUntilReveal } from '@/core/pacing'
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
  Smartphone,
  Timer,
} from 'lucide-vue-next'
import type { MediaType, Tier } from '@/types'
import MediaCard from './MediaCard.vue'
import OptionList from './OptionList.vue'
import ProgressBar from './ProgressBar.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()

// 从结果页「再来一轮」进入时，跳过介绍页直接续答（D4）
const started = ref(quiz.pendingContinue && quiz.questions.length > 0)
const tier = ref<Tier>(quiz.tier)

const intro = computed(() =>
  props.type === 'audio'
    ? {
        title: '听音认鸟',
        lead: '聆听一段真实鸟鸣，判断是哪一种鸟。',
      }
    : {
        title: '看图认鸟',
        lead: '观察一张真实鸟类照片，判断是哪一种鸟。',
      },
)

const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

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

// ---- D2 自动下一题 ----
const autoPending = ref(false)
let autoNextTimer: number | undefined

function clearAutoNext() {
  if (autoNextTimer !== undefined) {
    clearTimeout(autoNextTimer)
    autoNextTimer = undefined
  }
  autoPending.value = false
}

function scheduleAutoNext() {
  clearAutoNext()
  const mode = settings.autoNext
  if (mode === 'manual') return
  if (mode === 'correct' && !isCorrect.value) return
  autoPending.value = true
  autoNextTimer = window.setTimeout(() => {
    autoNextTimer = undefined
    autoPending.value = false
    quiz.next()
  }, AUTO_NEXT_DELAY_MS)
}

function goNext() {
  clearAutoNext()
  quiz.next()
}

/** 中途退出测试：已作答部分按"截至成绩"落库（错题本/统计同步），未答题目不计 */
function quitRound() {
  const n = quiz.answeredCount
  const msg =
    n > 0
      ? `确定退出测试吗？已完成 ${n}/${quiz.total} 题，已答部分将按当前成绩记录（计入错题本与统计），未答题目不计入。`
      : '确定退出测试吗？本轮尚未作答，不会留下任何记录。'
  if (!confirm(msg)) return
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
      <CircleX class="ic" :size="15" /> 错题重练：本轮只出你答错过的鸟
    </p>

    <div class="tiers">
      <button
        v-for="t in TIER_LIST"
        :key="t.tier"
        class="tier"
        :class="{ on: tier === t.tier }"
        @click="tier = t.tier"
      >
        <strong>{{ t.label }}</strong>
        <span>{{ t.desc }}</span>
      </button>
    </div>

    <button class="btn btn-primary" @click="begin">开始答题</button>
  </section>

  <!-- 加载中 -->
  <section v-else-if="quiz.loading" class="card center placeholder">
    <div class="spinner"></div>
    <h2>正在准备题目…</h2>
    <p class="muted">正在加载第 1 题，并预取接下来 3 题</p>
  </section>

  <!-- 出错 -->
  <section v-else-if="quiz.error" class="card center placeholder">
    <div class="emoji">🗂️</div>
    <h2>无法开始</h2>
    <p class="muted">{{ quiz.error }}</p>
    <p style="margin-top: 18px">
      <RouterLink class="btn btn-secondary" to="/">返回首页</RouterLink>
    </p>
  </section>

  <!-- 答题 -->
  <template v-else-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <!-- 状态行：左=难度 · 中=题号 · 右=计时/正确率（R24 三栏紧凑布局） -->
    <div class="status-bar">
      <span class="sb-left">
        <span class="tier-tag">{{ TIERS[quiz.current.tier].label }}</span>
      </span>
      <span class="sb-mid">第 {{ quiz.index + 1 }} / {{ quiz.total }} 题</span>
      <span class="sb-right">
        <span v-if="timeLeft !== null && !quiz.answered" class="timer" :class="{ warn: timeLeft <= 3 }">
          <Timer class="ic" :size="14" /> {{ timeLeft }}s
        </span>
        <span v-else>正确率 {{ quiz.answered || quiz.index > 0 ? quiz.accuracy + '%' : '--' }}</span>
      </span>
    </div>

    <div class="card" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
      <MediaCard
        :key="quiz.current.id"
        :type="quiz.current.type"
        :media="quiz.current.media"
        :autoplay="quiz.current.type === 'audio' && quiz.index >= 1 && settings.autoplayAudio"
        :autoplay-delay="settings.autoplayDelayMs"
        @audio-play="onQuestionAudioPlay"
      >
        <template #media-corner>
          <button class="quit-corner" type="button" @click="quitRound">
            <LogOut class="ic" :size="13" /> 退出测试
          </button>
        </template>
      </MediaCard>

      <OptionList
        :options="quiz.current.options"
        :answer="quiz.current.answer"
        :chosen="quiz.currentChoice"
        :hidden="optionsHidden"
        :reveal-in-sec="revealInSec"
        :mode="quiz.current.type"
        @select="quiz.answer($event)"
      />

      <div v-if="quiz.answered" class="feedback" :class="isCorrect ? 'ok' : 'no'">
        <strong v-if="timedOut"><AlarmClock class="ic" :size="16" /> 时间到！</strong>
        <strong v-else-if="isCorrect"><CircleCheck class="ic" :size="16" /> 回答正确！</strong>
        <strong v-else><CircleX class="ic" :size="16" /> 回答错误</strong>
        正确答案：<b>{{ quiz.current.answer }}</b>（{{ quiz.current.sci }}）
        <span class="muted"> · {{ quiz.current.family }}</span>
      </div>

      <div v-if="quiz.answered" class="actions">
        <button class="btn btn-primary" @click="goNext">
          {{ quiz.index + 1 >= quiz.total ? '查看结果' : '下一题' }}
          <ArrowRight class="ic" :size="16" />
        </button>
      </div>
      <!-- 底部提示（退出测试已移至媒体左下角，R24） -->
      <div v-if="quiz.answered" class="quiz-foot">
        <span v-if="!autoPending" class="foot-hint">
          <Keyboard class="ic" :size="13" /> 按 <ArrowRight class="ic" :size="12" /> 或空格 ·
          <Smartphone class="ic" :size="13" /> 左滑进下一题
        </span>
        <span v-else class="foot-hint">
          <Hourglass class="ic" :size="13" /> 即将自动进入下一题…
        </span>
      </div>
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
