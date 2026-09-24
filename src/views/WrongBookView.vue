<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearWrong, getWrongBook, removeWrong, type WrongEntry } from '@/core/historyDb'

const entries = ref<WrongEntry[]>([])
const loading = ref(true)

async function refresh() {
  loading.value = true
  entries.value = (await getWrongBook()).sort((a, b) => b.lastAt - a.lastAt)
  loading.value = false
}

onMounted(refresh)

async function remove(speciesId: string) {
  await removeWrong(speciesId)
  await refresh()
}

async function clearAll() {
  if (!confirm('确定清空错题本吗？')) return
  await clearWrong()
  await refresh()
}
</script>

<template>
  <section class="card">
    <h2 class="sec">📕 错题本</h2>
    <p class="muted" style="margin-bottom: 16px">
      答错的鸟会自动记录；下次答对则视为掌握并移除。共 {{ entries.length }} 条。
    </p>

    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="entries.length === 0" class="muted">还没有错题，去答题吧 🐦</p>

    <ul v-else class="wrong-list">
      <li v-for="e in entries" :key="e.speciesId" class="wrong-item">
        <div class="thumb">
          <img v-if="e.type === 'image'" :src="e.mediaUrl" :alt="e.answer" loading="lazy" />
          <audio v-else :src="e.mediaUrl" controls preload="none"></audio>
        </div>
        <div class="info">
          <div class="name">
            {{ e.answer }}
            <span class="muted small">（{{ e.sci }} · {{ e.family }}）</span>
          </div>
          <div class="muted small">
            错 {{ e.wrongCount }} 次 · 最近错选「{{ e.lastChosen || '超时/未答' }}」
          </div>
          <div class="muted tiny">
            {{ e.source }} · {{ e.author }} · {{ e.license }}
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" @click="remove(e.speciesId)">移除</button>
      </li>
    </ul>

    <div v-if="entries.length" class="actions">
      <button class="btn btn-secondary" @click="clearAll">清空错题本</button>
    </div>
  </section>
</template>

<style scoped>
.wrong-list {
  list-style: none;
}
.wrong-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.wrong-item:last-child {
  border-bottom: none;
}
.thumb {
  width: 96px;
  flex-shrink: 0;
}
.thumb img {
  width: 96px;
  height: 72px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.thumb audio {
  width: 96px;
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
