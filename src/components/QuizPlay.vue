<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { preloadQuestions } from '@/core/mediaLoader'
import type { MediaType } from '@/types'
import MediaCard from './MediaCard.vue'
import OptionList from './OptionList.vue'
import ProgressBar from './ProgressBar.vue'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()

const isCorrect = computed(
  () => quiz.answered && quiz.currentChoice === quiz.current?.answer,
)

onMounted(async () => {
  document.addEventListener('keydown', onKey)
  await quiz.start(props.type)
  // 起手预加载前 3 题，Q2 起切题无等待
  preloadQuestions(quiz.questions, 0, 3)
})
onUnmounted(() => document.removeEventListener('keydown', onKey))

// 每答完/切题后，提前加载后面两题
watch(
  () => quiz.index,
  (i) => preloadQuestions(quiz.questions, i + 1, 2),
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
  <section v-if="quiz.loading" class="card center placeholder">
    <div class="spinner"></div>
    <h2>正在准备题目…</h2>
    <p class="muted">首次加载题库与素材需要一点时间</p>
  </section>

  <section v-else-if="quiz.error" class="card center placeholder">
    <div class="emoji">🗂️</div>
    <h2>无法开始</h2>
    <p class="muted">{{ quiz.error }}</p>
    <p style="margin-top: 18px">
      <RouterLink class="btn btn-secondary" to="/">返回首页</RouterLink>
    </p>
  </section>

  <template v-else-if="quiz.current">
    <ProgressBar :current="quiz.index + (quiz.answered ? 1 : 0)" :total="quiz.total" />
    <div class="status-bar">
      <span>第 {{ quiz.index + 1 }} / {{ quiz.total }} 题</span>
      <span>正确率 {{ quiz.answered || quiz.index > 0 ? quiz.accuracy + '%' : '--' }}</span>
    </div>

    <div class="card">
      <MediaCard
        :key="quiz.current.id"
        :type="quiz.current.type"
        :media="quiz.current.media"
        :autoplay="
          quiz.current.type === 'audio' && quiz.index >= 1 && settings.autoplayAudio
        "
        :autoplay-delay="settings.autoplayDelayMs"
      />

      <OptionList
        :options="quiz.current.options"
        :answer="quiz.current.answer"
        :chosen="quiz.currentChoice"
        @select="quiz.answer($event)"
      />

      <div v-if="quiz.answered" class="feedback" :class="isCorrect ? 'ok' : 'no'">
        <strong>{{ isCorrect ? '✅ 回答正确！' : '❌ 回答错误' }}</strong>
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
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  font-size: 0.86rem;
  color: var(--text-light);
}
.status-bar span {
  font-weight: 700;
  color: var(--text);
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
</style>
