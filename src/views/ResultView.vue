<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Award,
  BookOpen,
  CircleCheck,
  CircleX,
  Flame,
  PartyPopper,
  Sparkles,
  Star,
  ThumbsUp,
  Trophy,
} from 'lucide-vue-next'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { TIERS } from '@/core/difficulty'
import { persistRound } from '@/core/roundRecorder'
import { getStats, listRounds } from '@/core/historyDb'
import { evaluateTitles, TITLE_TRACKS, type TitleText } from '@/core/titles'
import { ALL_SPECIES_TOTAL, BADGES, type BadgeDef } from '@/core/badges'
import type { Question } from '@/types'
import type { PosterData, PosterImage, PosterWrong } from '@/core/poster'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import { speciesNameById, speciesNameByStoredName } from '@/core/bank'
import AttributionLine from '@/components/AttributionLine.vue'
import BadgeIcon from '@/components/BadgeIcon.vue'
import PosterEditor from '@/components/PosterEditor.vue'
import SpeciesGallery from '@/components/SpeciesGallery.vue'

const router = useRouter()
const quiz = useQuizStore()
const { t } = useI18n()

const hasResult = computed(() => quiz.total > 0)
const modeLabel = computed(() => (quiz.mode === 'audio' ? t('nav.audioQuiz') : t('nav.imageQuiz')))
const tierLabel = computed(() => t(TIERS[quiz.tier].labelKey))
/** 科名「拉丁名+本地名」组合（015 #2） */
const familyOf = (fam: string) => familyDisplay(fam, currentLocale())
/** 题目答案名按当前语言解析（015 #1）：speciesId 回查题库，回退作答时存储名 */
const nameOf = (q: { media: { speciesId?: string }; answer: string }) =>
  speciesNameById(q.media.speciesId, currentLocale()) ?? q.answer
/** 错选名按当前语言解析：optionIds → 存储名反查（旧数据兜底）→ 原字符串 */
const choiceOf = (q: Question, chosen: string | null) => {
  if (chosen === TIMEOUT || chosen === null) {
    return chosen === TIMEOUT ? t('result.timedOut') : t('result.notAnswered')
  }
  const idx = q.options.indexOf(chosen)
  const id = idx >= 0 ? q.optionIds[idx] : undefined
  return (
    speciesNameById(id, currentLocale()) ??
    speciesNameByStoredName(chosen, currentLocale()) ??
    chosen
  )
}
const newBadges = ref<BadgeDef[]>([])
/** 新解锁称号的文本（key+params，渲染处 t()） */
const newTitleTexts = ref<TitleText[]>([])
const wornTitleText = ref<TitleText | null>(null)
const wornBadgeLabel = ref('')
const wornTitleIcon = ref('')
const wornBadgeIcon = ref('')
const settings = useSettingsStore()
const showPoster = ref(false)

const message = computed<{ icon: Component; text: string }>(() => {
  const p = quiz.accuracy
  if (p === 100) return { icon: Trophy, text: t('result.msg100') }
  if (p >= 80) return { icon: Star, text: t('result.msg80') }
  if (p >= 60) return { icon: ThumbsUp, text: t('result.msg60') }
  if (p >= 40) return { icon: Flame, text: t('result.msg40') }
  return { icon: BookOpen, text: t('result.msg0') }
})

/** 称号文本 → 字符串（海报画布/徽章 chips 用） */
const textOf = (x: TitleText) => t(x.key, x.params ?? {})

const posterData = computed<PosterData>(() => {
  const wrong: PosterWrong[] = quiz.questions
    .map((q, i) => ({ q, chosen: quiz.chosen[i] ?? null }))
    .filter(({ q, chosen }) => chosen !== q.answer)
    .map(({ q, chosen }) => ({
      answer: nameOf(q),
      chosen: chosen === TIMEOUT || chosen === null ? null : choiceOf(q, chosen),
      timedOut: chosen === TIMEOUT,
    }))
  return {
    modeLabel: quiz.mode === 'audio' ? t('mode.audioRound') : t('mode.imageRound'),
    tierLabel: tierLabel.value,
    correct: quiz.correctCount,
    total: quiz.total,
    accuracy: quiz.accuracy,
    date: new Intl.DateTimeFormat(currentLocale()).format(new Date()),
    round: quiz.sessionRound,
    overallAccuracy: quiz.overallAccuracy,
    wornTitle: wornTitleText.value ? textOf(wornTitleText.value) : undefined,
    wornTitleIcon: wornTitleIcon.value || undefined,
    wornBadge: wornBadgeLabel.value || undefined,
    wornBadgeIcon: wornBadgeIcon.value || undefined,
    nickname: settings.nickname || undefined,
    wrong,
  }
})

const posterImages = computed<PosterImage[]>(() => {
  const seen = new Set<string>()
  const out: PosterImage[] = []
  quiz.questions.forEach((q, i) => {
    if (q.type !== 'image' || !q.media.url || seen.has(q.media.url)) return
    seen.add(q.media.url)
    // F6：答错题所用的图打标记，引导用户优先选它做背景；xl 供海报背景用原图（C2）
    out.push({
      url: q.media.url,
      thumbUrl: q.media.thumbUrl,
      xlUrl: q.media.xlUrl,
      answer: nameOf(q),
      sci: q.sci,
      wrong: quiz.chosen[i] !== q.answer,
    })
  })
  return out
})

onMounted(async () => {
  if (!hasResult.value) {
    router.replace('/')
    return
  }
  const res = await persistRound(quiz)
  newBadges.value = res.badges
  newTitleTexts.value = res.newTitles.map((x) => x.text)
  // 佩戴称号/徽章 → 海报（R30/R31/R38：含独特图标）
  const [stats, rounds] = await Promise.all([getStats(), listRounds()])
  const wornTitle = evaluateTitles(stats, rounds).find((x) => x.trackId === settings.wornTitle)
  wornTitleText.value = wornTitle?.text ?? null
  wornTitleIcon.value = wornTitle ? (TITLE_TRACKS.find((x) => x.id === wornTitle.trackId)?.icon ?? '') : ''
  const wornBadgeDef = settings.wornBadge ? BADGES.find((b) => b.id === settings.wornBadge) : undefined
  wornBadgeLabel.value = wornBadgeDef ? t(wornBadgeDef.labelKey) : ''
  wornBadgeIcon.value = wornBadgeDef?.icon ?? ''
})

async function again() {
  await quiz.nextRound()
  router.push(quiz.mode === 'audio' ? '/quiz/audio' : '/quiz/image')
}
</script>

<template>
  <section v-if="hasResult" class="card result">
    <h2><PartyPopper class="ic" :size="22" /> {{ t('result.doneTitle') }}</h2>
    <p class="muted">{{ modeLabel }} · {{ tierLabel }}</p>
    <div class="score">
      <span class="num">{{ quiz.correctCount }}</span>
      <span class="den">/ {{ quiz.total }}</span>
    </div>
    <p class="muted">{{ t('result.accuracyLabel', { acc: quiz.accuracy }) }}</p>
    <p class="msg"><component :is="message.icon" class="ic" :size="18" /> {{ message.text }}</p>

    <div v-if="newTitleTexts.length" class="badges-new">
      <span class="muted"><Sparkles class="ic" :size="15" /> {{ t('result.newTitles') }}</span>
      <span v-for="(x, i) in newTitleTexts" :key="i" class="badge-chip">{{ textOf(x) }}</span>
    </div>

    <div v-if="newBadges.length" class="badges-new">
      <span class="muted"><Award class="ic" :size="15" /> {{ t('result.newBadges') }}</span>
      <span v-for="b in newBadges" :key="b.id" class="badge-chip">
        <BadgeIcon :name="b.icon" :size="15" /> {{ t(b.labelKey, { n: ALL_SPECIES_TOTAL }) }}
      </span>
    </div>

    <div class="actions">
      <button class="btn btn-primary" @click="again">{{ t('result.again') }}</button>
      <button class="btn btn-secondary" @click="showPoster = true">{{ t('result.makePoster') }}</button>
      <RouterLink class="btn btn-secondary" to="/">{{ t('quiz.backHome') }}</RouterLink>
    </div>
  </section>

  <PosterEditor
    :open="showPoster"
    :data="posterData"
    :images="posterImages"
    @close="showPoster = false"
  />

  <section v-if="hasResult" class="card review">
    <h3>{{ t('result.review') }}</h3>
    <ol>
      <li v-for="(q, i) in quiz.questions" :key="q.id" :class="{ ok: quiz.chosen[i] === q.answer }">
        <div class="line">
          <CircleCheck v-if="quiz.chosen[i] === q.answer" class="mark ok" :size="16" />
          <CircleX v-else class="mark no" :size="16" />
          <span class="ans">{{ nameOf(q) }}</span>
          <span class="muted">{{ q.sci }} · {{ familyOf(q.family) }}</span>
        </div>
        <div class="muted small">
          {{ t('result.yourChoice', { choice: choiceOf(q, quiz.chosen[i] ?? null) }) }}
        </div>
        <AttributionLine :media="q.media" />
        <!-- C3：回顾该鸟的其它图/音（可放大、可试听） -->
        <SpeciesGallery
          :images="q.type === 'image' ? q.assets : q.crossAssets"
          :audios="q.type === 'audio' ? q.assets : q.crossAssets"
          mode="browse"
          :label="t('result.viewSpeciesMedia')"
        />
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
