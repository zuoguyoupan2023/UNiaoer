<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bird, BookX, Eye, Headphones } from 'lucide-vue-next'
import { useQuizStore } from '@/stores/quiz'
import {
  clearWrong,
  getWrongBook,
  listWrongHistory,
  removeWrong,
  type WrongEntry,
  type WrongHistoryItem,
} from '@/core/historyDb'
import { loadBank, speciesById, speciesNameById, speciesNameByStoredName } from '@/core/bank'
import { assetsOf } from '@/core/questionEngine'
import type { MediaAsset, MediaType } from '@/types'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import AttributionLine from '@/components/AttributionLine.vue'
import SpeciesGallery from '@/components/SpeciesGallery.vue'

const router = useRouter()
const quiz = useQuizStore()
const { t } = useI18n()

/**
 * 记录里的鸟名按当前语言解析（015 #1）：
 * speciesId 查题库 → 旧记录无 id 时按存储名反查 → 都失败回退存储名。
 */
const nameOf = (id: string | undefined, fallback: string) =>
  speciesNameById(id, currentLocale()) ??
  speciesNameByStoredName(fallback, currentLocale()) ??
  fallback
/** 错选名：id → 存储名反查 → 原字符串；超时/未答显示占位 */
const choiceOf = (id: string | undefined, stored: string | null, noneKey: string) =>
  speciesNameById(id, currentLocale()) ??
  speciesNameByStoredName(stored, currentLocale()) ??
  stored ??
  t(noneKey)
/** 科名「拉丁名+本地名」组合，随 locale 切换（015 #2） */
const familyOf = (zhFamily: string) => familyDisplay(zhFamily, currentLocale())

/** 记录只存 mediaUrl/署名——构造最小 MediaAsset 供署名行/画廊渲染 */
function toAsset(
  speciesId: string,
  type: MediaType,
  url: string,
  source: string,
  author: string,
  license: string,
): MediaAsset {
  return { speciesId, type, url, source, author, license, sourceUrl: '' }
}

/**
 * 同种五图五音（对齐结果页/轮次历史）：资产按 speciesId 回查题库；
 * 查不到（旧记录/题库未加载）时回退本题的单素材。
 */
function galleryOf(
  speciesId: string,
  media: { type: MediaType; mediaUrl: string; source: string; author: string; license: string },
  want: MediaType,
): MediaAsset[] {
  const sp = speciesById(speciesId)
  if (sp) return assetsOf(sp, want)
  return media.type === want && media.mediaUrl
    ? [toAsset(speciesId, media.type, media.mediaUrl, media.source, media.author, media.license)]
    : []
}

type Tab = 'current' | 'history'
const tab = ref<Tab>('current')

const current = ref<WrongEntry[]>([])
const history = ref<WrongHistoryItem[]>([])
const loading = ref(true)

async function refresh() {
  loading.value = true
  const [c, h] = await Promise.all([getWrongBook(), listWrongHistory()])
  current.value = c.sort((a, b) => b.wrongCount - a.wrongCount || b.lastAt - a.lastAt)
  history.value = h
  loading.value = false
}

onMounted(async () => {
  // 错题本的鸟名按 speciesId 回查题库解析当前语言（015 #1）；失败时回退存储名
  try {
    await loadBank()
  } catch {
    /* 题库加载失败不阻塞错题本展示（用存储名回退） */
  }
  await refresh()
})

async function remove(speciesId: string) {
  await removeWrong(speciesId)
  await refresh()
}

async function clearAll() {
  if (!confirm(t('wrongBook.clearConfirm'))) return
  await clearWrong()
  await refresh()
}

/** E1 错题重练：只用错题本里的物种出一轮 */
function practice(type: MediaType) {
  if (!current.value.length) return
  quiz.startWrongBook(type)
  router.push(type === 'audio' ? '/quiz/audio' : '/quiz/image')
}

/** 日期随 locale（015 i18n-4：统一 Intl，禁止 toLocaleString('zh-CN')） */
function fmt(at: number) {
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(at)
}
</script>

<template>
  <section class="card">
    <h2 class="sec"><BookX class="ic" :size="20" /> {{ t('wrongBook.title') }}</h2>

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'current' }" @click="tab = 'current'">
        {{ t('wrongBook.currentTab', { n: current.length }) }}
      </button>
      <button class="tab" :class="{ on: tab === 'history' }" @click="tab = 'history'">
        {{ t('wrongBook.historyTab', { n: history.length }) }}
      </button>
    </div>

    <p class="muted hint">
      <template v-if="tab === 'current'">
        {{ t('wrongBook.currentHint') }}
      </template>
      <template v-else> {{ t('wrongBook.historyHint') }} </template>
    </p>

    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>

    <!-- 当前错题本 -->
    <template v-else-if="tab === 'current'">
      <p v-if="current.length === 0" class="muted">
        {{ t('wrongBook.empty') }} <Bird class="ic" :size="14" />
      </p>
      <ul v-else class="list">
        <li v-for="e in current" :key="e.speciesId" class="item">
          <img
            v-if="e.type === 'image' && e.mediaUrl"
            class="thumb"
            :src="e.mediaUrl"
            :alt="nameOf(e.speciesId, e.answer)"
            loading="lazy"
            decoding="async"
          />
          <audio
            v-else-if="e.type === 'audio' && e.mediaUrl"
            class="audio"
            :src="e.mediaUrl"
            controls
            preload="none"
          ></audio>
          <div class="info">
            <div class="name">
              {{ nameOf(e.speciesId, e.answer) }}
              <span class="muted small">（{{ e.sci }} · {{ familyOf(e.family) }}）</span>
            </div>
            <div class="muted small">
              {{ t('wrongBook.wrongTimes', e.wrongCount) }} ·
              {{
                t('wrongBook.lastWrongChoice', {
                  choice: choiceOf(e.lastChosenId, e.lastChosen, 'wrongBook.timedOutOrNone'),
                })
              }}
            </div>
            <AttributionLine
              :media="toAsset(e.speciesId, e.type, e.mediaUrl, e.source, e.author, e.license)"
            />
          </div>
          <button class="btn btn-secondary btn-sm" @click="remove(e.speciesId)">
            {{ t('common.remove') }}
          </button>
          <!-- 同种其它图/音（对齐结果页/轮次历史） -->
          <SpeciesGallery
            class="item-gallery"
            :images="galleryOf(e.speciesId, e, 'image')"
            :audios="galleryOf(e.speciesId, e, 'audio')"
            mode="browse"
            :label="t('result.viewSpeciesMedia')"
          />
        </li>
      </ul>
      <div v-if="current.length" class="actions">
        <button class="btn btn-primary" @click="practice('image')">
          <Eye class="ic" :size="16" /> {{ t('wrongBook.practiceImage') }}
        </button>
        <button class="btn btn-primary" @click="practice('audio')">
          <Headphones class="ic" :size="16" /> {{ t('wrongBook.practiceAudio') }}
        </button>
        <button class="btn btn-secondary" @click="clearAll">{{ t('wrongBook.clearCurrent') }}</button>
      </div>
    </template>

    <!-- 历史记录 -->
    <template v-else>
      <p v-if="history.length === 0" class="muted">{{ t('wrongBook.emptyHistory') }}</p>
      <ul v-else class="list">
        <li v-for="(e, i) in history" :key="`${e.speciesId}-${e.at}-${i}`" class="item">
          <img
            v-if="e.type === 'image' && e.mediaUrl"
            class="thumb"
            :src="e.mediaUrl"
            :alt="nameOf(e.speciesId, e.answer)"
            loading="lazy"
            decoding="async"
          />
          <audio
            v-else-if="e.type === 'audio' && e.mediaUrl"
            class="audio"
            :src="e.mediaUrl"
            controls
            preload="none"
          ></audio>
          <div class="info">
            <div class="name">
              {{ nameOf(e.speciesId, e.answer) }}
              <span class="muted small">（{{ e.sci }} · {{ familyOf(e.family) }}）</span>
            </div>
            <div class="muted small">
              {{ fmt(e.at) }} ·
              {{ e.mode === 'audio' ? t('mode.audioRound') : t('mode.imageRound') }} · L{{ e.tier }} ·
              {{
                t('wrongBook.wrongChoice', {
                  choice: e.timedOut
                    ? t('wrongBook.timedOut')
                    : choiceOf(e.chosenId, e.chosen, 'wrongBook.notAnswered'),
                })
              }}
            </div>
            <AttributionLine
              :media="toAsset(e.speciesId, e.type, e.mediaUrl, e.source, e.author, e.license)"
            />
          </div>
          <!-- 同种其它图/音（对齐结果页/轮次历史） -->
          <SpeciesGallery
            class="item-gallery"
            :images="galleryOf(e.speciesId, e, 'image')"
            :audios="galleryOf(e.speciesId, e, 'audio')"
            mode="browse"
            :label="t('result.viewSpeciesMedia')"
          />
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-wrap: wrap; /* 窄屏两个 tab 放不下时折行，不右溢 */
  gap: 8px;
  margin-bottom: 12px;
}
.tab {
  padding: 8px 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-light);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
.tab.on {
  background: var(--grad);
  color: #fff;
  border-color: transparent;
}
.hint {
  margin-bottom: 14px;
}
.list {
  list-style: none;
}
.item {
  display: flex;
  flex-wrap: wrap; /* 画廊在下方整行展开，信息区不被压缩 */
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.item:last-child {
  border-bottom: none;
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
.audio {
  width: 180px;
  max-width: 100%;
  height: 34px;
  flex-shrink: 0;
}
.info {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}
.item-gallery {
  flex-basis: 100%;
  min-width: 0;
}
.name {
  font-weight: 700;
}
.small {
  font-size: 0.78rem;
}
.actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
