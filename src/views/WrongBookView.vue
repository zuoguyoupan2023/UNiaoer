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
import type { MediaType } from '@/types'
import { currentLocale } from '@/i18n'

const router = useRouter()
const quiz = useQuizStore()
const { t } = useI18n()

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

onMounted(refresh)

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
          <div class="info">
            <div class="name">
              {{ e.answer }}
              <span class="muted small">（{{ e.sci }} · {{ e.family }}）</span>
            </div>
            <div class="muted small">
              {{ t('wrongBook.wrongTimes', e.wrongCount) }} ·
              {{ t('wrongBook.lastWrongChoice', { choice: e.lastChosen || t('wrongBook.timedOutOrNone') }) }}
            </div>
            <div class="muted tiny">{{ e.source }} · {{ e.author }} · {{ e.license }}</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="remove(e.speciesId)">
            {{ t('common.remove') }}
          </button>
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
          <div class="info">
            <div class="name">
              {{ e.answer }}
              <span class="muted small">（{{ e.sci }} · {{ e.family }}）</span>
            </div>
            <div class="muted small">
              {{ fmt(e.at) }} ·
              {{ e.mode === 'audio' ? t('mode.audioRound') : t('mode.imageRound') }} · L{{ e.tier }} ·
              {{
                t('wrongBook.wrongChoice', {
                  choice: e.timedOut
                    ? t('wrongBook.timedOut')
                    : (e.chosen || t('wrongBook.notAnswered')),
                })
              }}
            </div>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.tabs {
  display: flex;
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
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.item:last-child {
  border-bottom: none;
}
.info {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 700;
}
.small {
  font-size: 0.78rem;
}
.tiny {
  font-size: 0.7rem;
  opacity: 0.8;
}
.actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
