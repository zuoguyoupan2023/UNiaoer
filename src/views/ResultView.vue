<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import AttributionLine from '@/components/AttributionLine.vue'

const router = useRouter()
const quiz = useQuizStore()

const hasResult = computed(() => quiz.total > 0)

const message = computed(() => {
  const p = quiz.accuracy
  if (p === 100) return '🏆 完美！你就是鸟语达人！'
  if (p >= 80) return '🌟 非常棒！辨识能力很强！'
  if (p >= 60) return '👍 不错，继续练习会更好。'
  if (p >= 40) return '💪 加油，多听多看。'
  return '📚 别灰心，从常见鸟开始慢慢学。'
})

onMounted(() => {
  if (!hasResult.value) router.replace('/')
})

function again() {
  router.push(quiz.mode === 'audio' ? '/quiz/audio' : '/quiz/image')
}
</script>

<template>
  <section v-if="hasResult" class="card result">
    <h2>🎉 答题完成</h2>
    <div class="score">
      <span class="num">{{ quiz.correctCount }}</span>
      <span class="den">/ {{ quiz.total }}</span>
    </div>
    <p class="muted">正确率 {{ quiz.accuracy }}%</p>
    <p class="msg">{{ message }}</p>

    <div class="actions">
      <button class="btn btn-primary" @click="again">再来一轮</button>
      <RouterLink class="btn btn-secondary" to="/">返回首页</RouterLink>
    </div>
  </section>

  <section v-if="hasResult" class="card review">
    <h3>逐题回顾</h3>
    <ol>
      <li v-for="(q, i) in quiz.questions" :key="q.id" :class="{ ok: quiz.chosen[i] === q.answer }">
        <div class="line">
          <span class="mark">{{ quiz.chosen[i] === q.answer ? '✅' : '❌' }}</span>
          <span class="ans">{{ q.answer }}</span>
          <span class="muted">{{ q.sci }} · {{ q.family }}</span>
        </div>
        <div class="muted small">
          你的选择：{{ quiz.chosen[i] || '未作答' }}
        </div>
        <AttributionLine :media="q.media" />
      </li>
    </ol>
  </section>
</template>

<style scoped>
.result {
  text-align: center;
}
.result h2 {
  font-size: 1.3rem;
}
.score {
  margin: 16px auto;
  width: 128px;
  height: 128px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 6px solid transparent;
  background:
    linear-gradient(#fff, #fff) padding-box,
    var(--grad) border-box;
  box-shadow: 0 18px 40px -20px rgba(45, 106, 79, 0.9);
}
.score .num {
  font-size: 2.2rem;
  font-weight: 800;
  color: var(--primary);
}
.score .den {
  font-size: 0.8rem;
  color: var(--text-light);
}
.msg {
  font-size: 1rem;
  font-weight: 700;
  margin: 14px 0 20px;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.actions .btn {
  flex: 0 0 auto;
}
.review h3 {
  margin-bottom: 12px;
}
.review ol {
  list-style: none;
}
.review li {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.review li:last-child {
  border-bottom: none;
}
.line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ans {
  font-weight: 700;
}
.small {
  font-size: 0.78rem;
}
</style>
