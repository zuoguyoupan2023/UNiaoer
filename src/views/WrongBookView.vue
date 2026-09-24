<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  clearWrong,
  getWrongBook,
  listWrongHistory,
  removeWrong,
  type WrongEntry,
  type WrongHistoryItem,
} from '@/core/historyDb'

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
  if (!confirm('确定清空“当前错题本”吗？（历史记录会保留）')) return
  await clearWrong()
  await refresh()
}

function fmt(at: number) {
  return new Date(at).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <section class="card">
    <h2 class="sec">📕 错题本</h2>

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'current' }" @click="tab = 'current'">
        当前错题本（{{ current.length }}）
      </button>
      <button class="tab" :class="{ on: tab === 'history' }" @click="tab = 'history'">
        历史记录（{{ history.length }}）
      </button>
    </div>

    <p class="muted hint">
      <template v-if="tab === 'current'">
        动态变化：答错加入、答对（视为掌握）移除。历史记录永久保留。
      </template>
      <template v-else> 每一次答错的完整留痕（只增不减）。 </template>
    </p>

    <p v-if="loading" class="muted">加载中…</p>

    <!-- 当前错题本 -->
    <template v-else-if="tab === 'current'">
      <p v-if="current.length === 0" class="muted">当前没有错题，去答题吧 🐦</p>
      <ul v-else class="list">
        <li v-for="e in current" :key="e.speciesId" class="item">
          <div class="info">
            <div class="name">
              {{ e.answer }}
              <span class="muted small">（{{ e.sci }} · {{ e.family }}）</span>
            </div>
            <div class="muted small">
              错 {{ e.wrongCount }} 次 · 最近错选「{{ e.lastChosen || '超时/未答' }}」
            </div>
            <div class="muted tiny">{{ e.source }} · {{ e.author }} · {{ e.license }}</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="remove(e.speciesId)">移除</button>
        </li>
      </ul>
      <div v-if="current.length" class="actions">
        <button class="btn btn-secondary" @click="clearAll">清空当前错题本</button>
      </div>
    </template>

    <!-- 历史记录 -->
    <template v-else>
      <p v-if="history.length === 0" class="muted">暂无历史错题。</p>
      <ul v-else class="list">
        <li v-for="(e, i) in history" :key="`${e.speciesId}-${e.at}-${i}`" class="item">
          <div class="info">
            <div class="name">
              {{ e.answer }}
              <span class="muted small">（{{ e.sci }} · {{ e.family }}）</span>
            </div>
            <div class="muted small">
              {{ fmt(e.at) }} · {{ e.mode === 'audio' ? '鸟声版' : '鸟图版' }} · L{{ e.tier }} ·
              错选「{{ e.timedOut ? '超时未答' : e.chosen || '未作答' }}」
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
}
</style>
