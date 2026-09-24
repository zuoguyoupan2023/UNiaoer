<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { TIERS } from '@/core/difficulty'
import { persistRound } from '@/core/roundRecorder'
import { downloadPoster, type PosterWrong } from '@/core/poster'
import type { BadgeDef } from '@/core/badges'
import AttributionLine from '@/components/AttributionLine.vue'

const router = useRouter()
const quiz = useQuizStore()

const hasResult = computed(() => quiz.total > 0)
const modeLabel = computed(() => (quiz.mode === 'audio' ? '听音找鸟' : '看图找鸟'))
const tierLabel = computed(() => TIERS[quiz.tier]?.label ?? '')
const newBadges = ref<BadgeDef[]>([])

const message = computed(() => {
  const p = quiz.accuracy
  if (p === 100) return '🏆 完美！你就是鸟语达人！'
  if (p >= 80) return '🌟 非常棒！辨识能力很强！'
  if (p >= 60) return '👍 不错，继续练习会更好。'
  if (p >= 40) return '💪 加油，多听多看。'
  return '📚 别灰心，从常见鸟开始慢慢学。'
})

onMounted(async () => {
  if (!hasResult.value) {
    router.replace('/')
    return
  }
  newBadges.value = await persistRound(quiz)
})

function again() {
  router.push(quiz.mode === 'audio' ? '/quiz/audio' : '/quiz/image')
}

async function poster() {
  const wrong: PosterWrong[] = quiz.questions
    .map((q, i) => ({ q, chosen: quiz.chosen[i] ?? null }))
    .filter(({ q, chosen }) => chosen !== q.answer)
    .map(({ q, chosen }) => ({
      answer: q.answer,
      chosen: chosen === TIMEOUT ? null : chosen,
      timedOut: chosen === TIMEOUT,
    }))
  await downloadPoster({
    modeLabel: quiz.mode === 'audio' ? '鸟声版' : '鸟图版',
    tierLabel: tierLabel.value,
    correct: quiz.correctCount,
    total: quiz.total,
    accuracy: quiz.accuracy,
    date: new Date().toLocaleDateString('zh-CN'),
    wrong,
  })
}
</script>

<template>
  <section v-if="hasResult" class="card result">
    <h2>🎉 答题完成</h2>
    <p class="muted">{{ modeLabel }} · {{ tierLabel }}</p>
    <div class="score">
      <span class="num">{{ quiz.correctCount }}</span>
      <span class="den">/ {{ quiz.total }}</span>
    </div>
    <p class="muted">正确率 {{ quiz.accuracy }}%</p>
    <p class="msg">{{ message }}</p>

    <div v-if="newBadges.length" class="badges-new">
      <span class="muted">🎖️ 获得新徽章：</span>
      <span v-for="b in newBadges" :key="b.id" class="badge-chip">{{ b.emoji }} {{ b.label }}</span>
    </div>

    <div class="actions">
      <button class="btn btn-primary" @click="again">再来一轮</button>
      <button class="btn btn-secondary" @click="poster">生成海报</button>
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
          你的选择：{{ quiz.chosen[i] === TIMEOUT ? '超时未作答' : quiz.chosen[i] || '未作答' }}
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
  margin: 14px 0 12px;
}
.badges-new {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  align-items: center;
  margin-bottom: 18px;
}
.badge-chip {
  background: var(--grad-gold);
  color: #4a3200;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: 20px;
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
