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
function startTimer() {
  stopTimer()
  const q = quiz.current
  if (!q?.timeLimitSec || quiz.answered) {
    timeLeft.value = null
    return
  }
  timeLeft.value = q.timeLimitSec
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

/** 中途退出本轮：已作答部分按"截至成绩"落库（错题本/统计同步），未答题目不计 */
function quitRound() {
  const n = quiz.answeredCount
  const msg =
    n > 0
      ? `确定退出本轮吗？已完成 ${n}/${quiz.total} 题，已答部分将按当前成绩记录（计入错题本与统计），未答题目不计入。`
      : '确定退出本轮吗？本轮尚未作答，不会留下任何记录。'
  if (!confirm(msg)) return
  stopTimer()
  clearAutoNext()
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
  startTimer()
  updateInterference()
}

/** L5 地狱：每题随机鸟鸣干扰（看图 2 条 / 听音 1 条）；作答或非地狱难度即停止 */
function updateInterference() {
  const q = quiz.current
  if (quiz.tier === 5 && q && !quiz.answered) {
    void interferencePlayer.start(q.type === 'image' ? 2 : 1, q.type === 'image' ? 0.35 : 0.25)
  } else {
    interferencePlayer.stop()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
    // 从结果页续轮也是"测试开始"：环境鸟鸣停播
    ambiencePlayer.stop()
    preloadQuestions(quiz.questions, 0, 4)
    startTimer()
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
    startTimer()
    updateInterference() // 地狱难度：新题换一批随机干扰
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
    <div class="intro-icon">
      <AudioLines v-if="type === 'audio'" :size="46" />
      <ImageIcon v-else :size="46" />
    </div>
    <h2>{{ intro.title }}</h2>
    <p class="lead muted">{{ intro.lead }}</p>

    <p v-if="quiz.wrongPoolOnly" class="wrong-hint">
      <CircleX class="ic" :size="15" /> 错题重练：本轮只出你答错过的鸟
    </p>

    <h3 class="tier-title">选择难度</h3>
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
    <div class="status-bar">
      <span>
        第 {{ quiz.index + 1 }} / {{ quiz.total }} 题
        <span class="tier-tag">{{ TIERS[quiz.current.tier].label }}</span>
      </span>
      <span v-if="timeLeft !== null && !quiz.answered" class="timer" :class="{ warn: timeLeft <= 3 }">
        <Timer class="ic" :size="14" /> {{ timeLeft }}s
      </span>
      <span v-else>正确率 {{ quiz.answered || quiz.index > 0 ? quiz.accuracy + '%' : '--' }}</span>
    </div>

    <div class="card" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
      <MediaCard
        :key="quiz.current.id"
        :type="quiz.current.type"
        :media="quiz.current.media"
        :autoplay="quiz.current.type === 'audio' && quiz.index >= 1 && settings.autoplayAudio"
        :autoplay-delay="settings.autoplayDelayMs"
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
      <!-- 底部提示与退出合并为一行，避免占高（R20） -->
      <div class="quiz-foot">
        <span v-if="quiz.answered && !autoPending" class="foot-hint">
          <Keyboard class="ic" :size="13" /> 按 <ArrowRight class="ic" :size="12" /> 或空格 ·
          <Smartphone class="ic" :size="13" /> 左滑进下一题
        </span>
        <span v-else-if="autoPending" class="foot-hint">
          <Hourglass class="ic" :size="13" /> 即将自动进入下一题…
        </span>
        <button class="quit-link" type="button" @click="quitRound">
          <LogOut class="ic" :size="13" /> 退出本轮
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.intro {
  text-align: center;
}
.intro-icon {
  display: flex;
  justify-content: center;
  color: var(--primary);
  animation: float 3s ease-in-out infinite;
}
.intro h2 {
  font-size: 1.25rem;
  margin: 14px 0 8px;
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
.tier-title {
  font-size: 0.9rem;
  color: var(--primary);
  margin-bottom: 10px;
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
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  font-size: 0.86rem;
  color: var(--text-light);
}
.status-bar > span {
  font-weight: 700;
  color: var(--text);
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
.quit-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-light);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.18s ease;
}
.quit-link:hover {
  color: var(--wrong);
  background: #fdecee;
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
