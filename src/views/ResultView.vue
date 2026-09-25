<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  Award,
  BookOpen,
  CircleCheck,
  CircleX,
  Flame,
  PartyPopper,
  Star,
  ThumbsUp,
  Trophy,
} from 'lucide-vue-next'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { TIERS } from '@/core/difficulty'
import { persistRound } from '@/core/roundRecorder'
import type { PosterData, PosterImage, PosterWrong } from '@/core/poster'
import type { BadgeDef } from '@/core/badges'
import AttributionLine from '@/components/AttributionLine.vue'
import BadgeIcon from '@/components/BadgeIcon.vue'
import PosterEditor from '@/components/PosterEditor.vue'

const router = useRouter()
const quiz = useQuizStore()

const hasResult = computed(() => quiz.total > 0)
const modeLabel = computed(() => (quiz.mode === 'audio' ? '听音认鸟' : '看图认鸟'))
const tierLabel = computed(() => TIERS[quiz.tier]?.label ?? '')
const newBadges = ref<BadgeDef[]>([])
const showPoster = ref(false)

const message = computed<{ icon: Component; text: string }>(() => {
  const p = quiz.accuracy
  if (p === 100) return { icon: Trophy, text: '完美！你就是鸟语达人！' }
  if (p >= 80) return { icon: Star, text: '非常棒！辨识能力很强！' }
  if (p >= 60) return { icon: ThumbsUp, text: '不错，继续练习会更好。' }
  if (p >= 40) return { icon: Flame, text: '加油，多听多看。' }
  return { icon: BookOpen, text: '别灰心，从常见鸟开始慢慢学。' }
})

const posterData = computed<PosterData>(() => {
  const wrong: PosterWrong[] = quiz.questions
    .map((q, i) => ({ q, chosen: quiz.chosen[i] ?? null }))
    .filter(({ q, chosen }) => chosen !== q.answer)
    .map(({ q, chosen }) => ({
      answer: q.answer,
      chosen: chosen === TIMEOUT ? null : chosen,
      timedOut: chosen === TIMEOUT,
    }))
  return {
    modeLabel: quiz.mode === 'audio' ? '鸟声版' : '鸟图版',
    tierLabel: tierLabel.value,
    correct: quiz.correctCount,
    total: quiz.total,
    accuracy: quiz.accuracy,
    date: new Date().toLocaleDateString('zh-CN'),
    round: quiz.sessionRound,
    overallAccuracy: quiz.overallAccuracy,
    wrong,
  }
})

const posterImages = computed<PosterImage[]>(() => {
  const seen = new Set<string>()
  const out: PosterImage[] = []
  quiz.questions.forEach((q, i) => {
    if (q.type !== 'image' || !q.media.url || seen.has(q.media.url)) return
    seen.add(q.media.url)
    // F6：答错题所用的图打标记，引导用户优先选它做背景
    out.push({ url: q.media.url, answer: q.answer, sci: q.sci, wrong: quiz.chosen[i] !== q.answer })
  })
  return out
})

onMounted(async () => {
  if (!hasResult.value) {
    router.replace('/')
    return
  }
  newBadges.value = await persistRound(quiz)
})

async function again() {
  await quiz.nextRound()
  router.push(quiz.mode === 'audio' ? '/quiz/audio' : '/quiz/image')
}
</script>

<template>
  <section v-if="hasResult" class="card result">
    <h2><PartyPopper class="ic" :size="22" /> 答题完成</h2>
    <p class="muted">{{ modeLabel }} · {{ tierLabel }}</p>
    <div class="score">
      <span class="num">{{ quiz.correctCount }}</span>
      <span class="den">/ {{ quiz.total }}</span>
    </div>
    <p class="muted">正确率 {{ quiz.accuracy }}%</p>
    <p class="msg"><component :is="message.icon" class="ic" :size="18" /> {{ message.text }}</p>

    <div v-if="newBadges.length" class="badges-new">
      <span class="muted"><Award class="ic" :size="15" /> 获得新徽章：</span>
      <span v-for="b in newBadges" :key="b.id" class="badge-chip">
        <BadgeIcon :name="b.icon" :size="15" /> {{ b.label }}
      </span>
    </div>

    <div class="actions">
      <button class="btn btn-primary" @click="again">再来一轮</button>
      <button class="btn btn-secondary" @click="showPoster = true">生成海报</button>
      <RouterLink class="btn btn-secondary" to="/">返回首页</RouterLink>
    </div>
  </section>

  <PosterEditor
    :open="showPoster"
    :data="posterData"
    :images="posterImages"
    @close="showPoster = false"
  />

  <section v-if="hasResult" class="card review">
    <h3>逐题回顾</h3>
    <ol>
      <li v-for="(q, i) in quiz.questions" :key="q.id" :class="{ ok: quiz.chosen[i] === q.answer }">
        <div class="line">
          <CircleCheck v-if="quiz.chosen[i] === q.answer" class="mark ok" :size="16" />
          <CircleX v-else class="mark no" :size="16" />
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--grad-gold);
  color: #4a3200;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: 20px;
}
.mark.ok {
  color: var(--correct);
}
.mark.no {
  color: var(--wrong);
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
  align-items: center;
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
