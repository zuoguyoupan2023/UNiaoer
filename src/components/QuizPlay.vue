<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

const started = ref(false)

const intro = computed(() =>
  props.type === 'audio'
    ? {
        emoji: '🔊',
        title: '听音找鸟',
        lead: '聆听一段真实鸟鸣，判断是哪一种鸟。',
        rules: [
          '每轮 10 题，从 Xeno-canto / iNaturalist 加载真实鸟鸣',
          '从多个选项中选出正确的鸟名',
          '可用键盘 1/2/3/4 或 A/B/C/D 作答',
          '答完可在结果页逐题回顾（含素材署名）',
        ],
      }
    : {
        emoji: '🖼️',
        title: '看图找鸟',
        lead: '观察一张真实鸟类照片，判断是哪一种鸟。',
        rules: [
          '每轮 10 题，从 iNaturalist 加载开放许可照片',
          '从多个选项中选出正确的鸟名',
          '可用键盘 1/2/3/4 或 A/B/C/D 作答',
          '答完可在结果页逐题回顾（含素材署名）',
        ],
      },
)

const isCorrect = computed(() => quiz.answered && quiz.currentChoice === quiz.current?.answer)

async function begin() {
  started.value = true
  await quiz.start(props.type)
  // 起手：当前题 + 后面 3 题
  preloadQuestions(quiz.questions, 0, 4)
}

onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))

// 每切一题，确保后面 3 题已加载
watch(
  () => quiz.index,
  (i) => preloadQuestions(quiz.questions, i + 1, 3),
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
    <ul class="rules muted">
      <li v-for="r in intro.rules" :key="r">{{ r }}</li>
    </ul>
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
      <span>第 {{ quiz.index + 1 }} / {{ quiz.total }} 题</span>
      <span>正确率 {{ quiz.answered || quiz.index > 0 ? quiz.accuracy + '%' : '--' }}</span>
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
  margin-bottom: 16px;
}
.rules {
  text-align: left;
  max-width: 460px;
  margin: 0 auto 22px;
  padding-left: 20px;
  line-height: 2;
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
