<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearAll, getBadges, getStats, type EarnedBadge, type Stats } from '@/core/historyDb'
import { BADGES } from '@/core/badges'

const stats = ref<Stats | null>(null)
const earned = ref<Set<string>>(new Set())
const loading = ref(true)

async function refresh() {
  loading.value = true
  const [s, b] = await Promise.all([getStats(), getBadges()])
  stats.value = s
  earned.value = new Set((b as EarnedBadge[]).map((x) => x.id))
  loading.value = false
}

onMounted(refresh)

async function reset() {
  if (!confirm('确定清空全部本地数据（记录 / 错题本 / 徽章）吗？此操作不可恢复。')) return
  await clearAll()
  await refresh()
}
</script>

<template>
  <section class="card">
    <h2 class="sec">👤 我的</h2>
    <p v-if="loading" class="muted">加载中…</p>

    <template v-else-if="stats">
      <div class="stat-grid">
        <div class="stat"><span class="n">{{ stats.rounds }}</span><span class="l">轮次</span></div>
        <div class="stat"><span class="n">{{ stats.totalQuestions }}</span><span class="l">累计题数</span></div>
        <div class="stat"><span class="n">{{ stats.bestAccuracy }}%</span><span class="l">最佳正确率</span></div>
        <div class="stat"><span class="n">{{ stats.perfectRounds }}</span><span class="l">满分轮次</span></div>
        <div class="stat"><span class="n">{{ stats.distinctSpecies }}</span><span class="l">认识物种</span></div>
        <div class="stat"><span class="n">{{ stats.bestStreak }}</span><span class="l">最长连对</span></div>
      </div>

      <h3 class="sec" style="margin-top: 22px">🎖️ 徽章（{{ earned.size }} / {{ BADGES.length }}）</h3>
      <div class="badge-grid">
        <div v-for="b in BADGES" :key="b.id" class="badge" :class="{ locked: !earned.has(b.id) }">
          <span class="emoji">{{ b.emoji }}</span>
          <span class="label">{{ b.label }}</span>
          <span class="desc">{{ b.desc }}</span>
        </div>
      </div>

      <div class="actions">
        <RouterLink class="btn btn-secondary" to="/wrong">查看错题本</RouterLink>
        <button class="btn btn-secondary" @click="reset">清空我的数据</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
@media (max-width: 480px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.stat {
  background: #f3fbf7;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px 10px;
  text-align: center;
}
.stat .n {
  display: block;
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--primary);
}
.stat .l {
  font-size: 0.74rem;
  color: var(--text-light);
}
.badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  text-align: center;
  padding: 14px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.badge .emoji {
  font-size: 1.8rem;
}
.badge .label {
  font-size: 0.85rem;
  font-weight: 700;
}
.badge .desc {
  font-size: 0.7rem;
  color: var(--text-light);
}
.badge.locked {
  opacity: 0.45;
  filter: grayscale(0.7);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
}
</style>
