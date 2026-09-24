<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { preloadQuestions } from '@/core/mediaLoader'
import { TIER_LIST, TIERS } from '@/core/difficulty'
import type { MediaType, Tier } from '@/types'
import MediaCard from './MediaCard.vue'
import OptionList from './OptionList.vue'
import ProgressBar from './ProgressBar.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()

const started = ref(false)
const tier = ref<Tier>(2)

const intro = computed(() =>
  props.type === 'audio'
    ? {
        emoji: '🔊',
        title: '听音找鸟',
        lead: '聆听一段真实鸟鸣，判断是哪一种鸟。',
      }
    : {
        emoji: '🖼️',
        title: '看图找鸟',
        lead: '观察一张真实鸟类照片，判断是哪一种鸟。',
      },
)

const timedOut = computed(() => quiz.currentChoice === TIMEOUT)
const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

// ---- 计时 ----
const timeLeft = ref<number | null>(null)
let tick: number | undefined

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

async function begin() {
  started.value = true
  await quiz.start(props.type, { tier: tier.value })
  preloadQuestions(quiz.questions, 0, 4) // 当前题 + 后 3 题
  startTimer()
}

onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  stopTimer()
})

watch(
  () => quiz.index,
  (i) => {
    preloadQuestions(quiz.questions, i + 1, 3) // 之后 3 题
    startTimer()
  },
)
watch(
  () => quiz.answered,
  (a) => {
    if (a) stopTimer()
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
  if (!q || quiz.answered) return
  const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 }
  const idx = map[e.key.toLowerCase()]
  if (idx !== undefined) {
    const opt = q.options[idx]
    if (opt) quiz.answer(opt)
  }
}
</script>

<template>
  <!-- 介绍页 -->
  <section v-if="!started" class="card intro">
    <div class="emoji">{{ intro.emoji }}</div>
    <h2>{{ intro.title }}</h2>
    <p class="lead muted">{{ intro.lead }}</p>

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
        ⏱ {{ timeLeft }}s
      </span>
      <span v-else>正确率 {{ quiz.answered || quiz.index > 0 ? quiz.accuracy + '%' : '--' }}</span>
    </div>

    <div class="card">
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
        @select="quiz.answer($event)"
      />

      <div v-if="quiz.answered" class="feedback" :class="isCorrect ? 'ok' : 'no'">
        <strong v-if="timedOut">⏰ 时间到！</strong>
        <strong v-else>{{ isCorrect ? '✅ 回答正确！' : '❌ 回答错误' }}</strong>
        正确答案：<b>{{ quiz.current.answer }}</b>（{{ quiz.current.sci }}）
        <span class="muted"> · {{ quiz.current.family }}</span>
      </div>

      <div v-if="quiz.answered" class="actions">
        <button class="btn btn-primary" @click="quiz.next()">
          {{ quiz.index + 1 >= quiz.total ? '查看结果 →' : '下一题 →' }}
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.intro {
  text-align: center;
}
.intro .emoji {
  font-size: 3rem;
  animation: float 3s ease-in-out infinite;
}
.intro h2 {
  font-size: 1.25rem;
  margin: 14px 0 8px;
}
.intro .lead {
  margin-bottom: 18px;
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
