<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { CircleCheck, CircleX, Eye, Headphones, History, Swords } from 'lucide-vue-next'
import {
  listRounds,
  type RoundItem,
  type RoundRecord,
} from '@/core/historyDb'
import { loadBank, speciesById, speciesNameById, speciesNameByStoredName } from '@/core/bank'
import { assetsOf } from '@/core/questionEngine'
import type { MediaAsset } from '@/types'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import AttributionLine from '@/components/AttributionLine.vue'
import SpeciesGallery from '@/components/SpeciesGallery.vue'

const { t } = useI18n()

const rounds = ref<RoundRecord[]>([])
const loading = ref(true)
/** 手风琴：同时只展开一局 */
const openedId = ref<string | null>(null)
/** 长列表分页：首屏 20 轮，「显示更多」每次 +20 */
const visibleCount = ref(20)

onMounted(async () => {
  // 名字按 016 机制解析：先建题库索引（失败不阻塞，回退存储名）
  try {
    await loadBank()
  } catch {
    /* 题库加载失败时回退记录里的存储名 */
  }
  const all = await listRounds()
  rounds.value = [...all].sort((a, b) => b.at - a.at)
  loading.value = false
})

const visible = computed(() => rounds.value.slice(0, visibleCount.value))

function toggle(id: string) {
  openedId.value = openedId.value === id ? null : id
}

/** 记录里的答案名按当前语言解析（016：id → 存储名反查 → 原字符串） */
const nameOf = (it: RoundItem) =>
  speciesNameById(it.speciesId, currentLocale()) ??
  speciesNameByStoredName(it.answer, currentLocale()) ??
  it.answer

/** 错选名：超时/未答 → 占位；否则 id → 存储名反查 → 原字符串 */
const choiceOf = (it: RoundItem) => {
  if (it.timedOut) return t('result.timedOut')
  if (it.chosen === null) return t('result.notAnswered')
  return (
    speciesNameById(it.chosenId, currentLocale()) ??
    speciesNameByStoredName(it.chosen, currentLocale()) ??
    it.chosen
  )
}

/** 科名「拉丁名 | 本地名」组合（015 #2） */
const familyOf = (zhFamily: string) => familyDisplay(zhFamily, currentLocale())

const fmtWhen = (at: number) =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(at)

const fmtDuration = (ms: number) => {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 记录只存 mediaUrl/署名——构造最小 MediaAsset 供署名行渲染（无链接字段则显示纯文本） */
function toAsset(it: RoundItem): MediaAsset {
  return {
    speciesId: it.speciesId,
    type: it.type,
    url: it.mediaUrl,
    license: it.license,
    author: it.author,
    source: it.source,
    sourceUrl: '',
  }
}

/**
 * 逐题附同种五图五音画廊（对齐结果页回顾）：资产按 speciesId 回查题库（016 索引），
 * 记录本身不存资产列表；旧记录（speciesId 是 URL）查不到时回退本题 mediaUrl 单素材，
 * SpeciesGallery 在总数 ≤1 时自动隐藏。
 */
function galleryOf(it: RoundItem, type: 'image' | 'audio'): MediaAsset[] {
  const sp = speciesById(it.speciesId)
  if (sp) return assetsOf(sp, type)
  return it.type === type && it.mediaUrl ? [toAsset(it)] : []
}
</script>

<template>
  <section class="card">
    <h2 class="sec"><History class="ic" :size="20" /> {{ t('history.title') }}</h2>

    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>

    <template v-else-if="rounds.length">
      <p class="muted hint">{{ t('history.hint', { n: rounds.length }) }}</p>

      <ul class="rounds">
        <li v-for="r in visible" :key="r.id" class="round" :class="{ open: openedId === r.id }">
          <button class="round-head" type="button" :aria-expanded="openedId === r.id" @click="toggle(r.id)">
            <span class="when">{{ fmtWhen(r.at) }}</span>
            <span class="meta">
              <Eye v-if="r.mode === 'image'" class="ic" :size="14" />
              <Headphones v-else class="ic" :size="14" />
              {{ r.mode === 'audio' ? t('history.modeAudio') : t('history.modeImage') }} · L{{ r.tier }}
              <span v-if="r.source === 'wrong-practice'" class="tag">
                <Swords class="ic" :size="11" /> {{ t('history.wrongPracticeTag') }}
              </span>
            </span>
            <span class="score" :class="{ perfect: r.total > 0 && r.correct === r.total }">
              {{ r.correct }}/{{ r.total }} · {{ r.accuracy }}%
            </span>
            <span v-if="fmtDuration(r.durationMs)" class="dur muted">
              {{ t('history.duration', { time: fmtDuration(r.durationMs) }) }}
            </span>
          </button>

          <ol v-if="openedId === r.id" class="items">
            <li v-for="(it, i) in r.items" :key="i" class="item">
              <CircleCheck v-if="it.correct" class="mark ok" :size="16" />
              <CircleX v-else class="mark no" :size="16" />
              <img
                v-if="it.type === 'image' && it.mediaUrl"
                class="thumb"
                :src="it.mediaUrl"
                loading="lazy"
                decoding="async"
                :alt="nameOf(it)"
              />
              <div class="info">
                <div class="name">
                  {{ nameOf(it) }}
                  <span class="muted small">（{{ it.sci }} · {{ familyOf(it.family) }}）</span>
                </div>
                <div class="muted small">{{ t('result.yourChoice', { choice: choiceOf(it) }) }}</div>
                <AttributionLine :media="toAsset(it)" />
              </div>
              <!-- 同种五图五音（browse：缩略图放大 / 内联试听），对齐结果页回顾 -->
              <SpeciesGallery
                class="item-gallery"
                :images="galleryOf(it, 'image')"
                :audios="galleryOf(it, 'audio')"
                mode="browse"
                :label="t('result.viewSpeciesMedia')"
              />
            </li>
          </ol>
        </li>
      </ul>

      <div v-if="visibleCount < rounds.length" class="more">
        <button class="btn btn-secondary" @click="visibleCount += 20">
          {{ t('history.showMore') }}
        </button>
      </div>
    </template>

    <p v-else class="muted">
      {{ t('history.empty') }}
      <RouterLink to="/quiz/image" class="empty-link">
        <Eye class="ic" :size="14" /> {{ t('nav.imageQuiz') }}
      </RouterLink>
      <RouterLink to="/quiz/audio" class="empty-link">
        <Headphones class="ic" :size="14" /> {{ t('nav.audioQuiz') }}
      </RouterLink>
    </p>
  </section>
</template>

<style scoped>
.sec {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 1.1rem;
  margin-bottom: 14px;
}
.sec .ic {
  color: var(--primary);
}
.hint {
  font-size: 0.8rem;
  margin-bottom: 12px;
}
.rounds {
  list-style: none;
}
.round {
  border-bottom: 1px solid var(--border);
}
.round:last-child {
  border-bottom: none;
}
.round-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
  padding: 12px 4px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text);
  text-align: left;
  transition: background 0.15s ease;
}
.round-head:hover {
  background: #f3fbf7;
}
.when {
  font-weight: 700;
  min-width: 130px;
}
.meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-light);
}
.meta .ic {
  color: var(--primary);
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: 8px;
  background: #fdecee;
  color: var(--wrong);
  font-size: 0.68rem;
  font-weight: 600;
}
.score {
  margin-left: auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.score.perfect {
  color: var(--correct);
}
.dur {
  font-size: 0.72rem;
}
.items {
  list-style: none;
  padding: 4px 4px 12px 10px;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px dashed var(--border);
}
.item:first-child {
  border-top: none;
}
.mark {
  flex-shrink: 0;
  margin-top: 2px;
}
.mark.ok {
  color: var(--correct);
}
.mark.no {
  color: var(--wrong);
}
.thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
  flex-shrink: 0;
  background: #f5f5f5;
}
.info {
  flex: 1;
  min-width: 0;
}
.item-gallery {
  flex-basis: 100%;
}
.name {
  font-weight: 700;
  font-size: 0.9rem;
}
.small {
  font-size: 0.78rem;
}
.more {
  margin-top: 14px;
  text-align: center;
}
.empty-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 6px;
  color: var(--primary);
  font-weight: 600;
}
@media (max-width: 520px) {
  .when {
    min-width: 0;
  }
  .dur {
    flex-basis: 100%;
  }
}
</style>
