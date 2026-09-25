<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadBank } from '@/core/bank'

const stats = ref<{ total: number; image: number; audio: number } | null>(null)
const bankError = ref('')

onMounted(async () => {
  try {
    const bank = await loadBank()
    stats.value = {
      total: bank.total,
      image: bank.stats.withImage,
      audio: bank.stats.withAudio,
    }
  } catch (e) {
    bankError.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <section class="card center">
    <h2 style="font-size: 1.2rem; margin-bottom: 8px">选择玩法</h2>
    <p class="muted" style="margin-bottom: 20px">
      用真实的鸟类照片与鸟鸣，练习辨识能力。每轮 10 题。
    </p>

    <p v-if="stats" class="bank-stats">
      📚 题库：{{ stats.total }} 种 · 图片 {{ stats.image }} · 音频 {{ stats.audio }}
    </p>
    <p v-else-if="bankError" class="bank-error">⚠️ {{ bankError }}</p>

    <div class="modes">
      <RouterLink to="/quiz/image" class="mode-card">
        <span class="mode-emoji">🖼️</span>
        <span class="mode-title">看图认鸟</span>
        <span class="mode-sub">来自 iNaturalist 的开放许可照片</span>
      </RouterLink>
      <RouterLink to="/quiz/audio" class="mode-card">
        <span class="mode-emoji">🔊</span>
        <span class="mode-title">听音认鸟</span>
        <span class="mode-sub">来自 Xeno-canto 的真实鸟鸣</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.bank-stats {
  font-size: 0.8rem;
  color: var(--primary);
  background: #eaf4ef;
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 16px;
  display: inline-block;
}
.bank-error {
  font-size: 0.8rem;
  color: #8a6d00;
  background: #fdf3d8;
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 16px;
}
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 520px) {
  .modes {
    grid-template-columns: 1fr;
  }
}
.mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}
.mode-card:hover {
  transform: translateY(-3px);
  border-color: var(--primary-light);
  box-shadow: var(--shadow);
  text-decoration: none;
}
.mode-emoji {
  font-size: 2.4rem;
}
.mode-title {
  font-size: 1.05rem;
  font-weight: 800;
}
.mode-sub {
  font-size: 0.76rem;
  color: var(--text-light);
}
</style>
