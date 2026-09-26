<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AlertTriangle, AudioLines, Image as ImageIcon, Library } from 'lucide-vue-next'
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
    <h2 class="pick-title">是时候挑战一下自己了！</h2>
    <p class="muted lead">用真实的鸟类照片与鸟鸣，练习辨识能力。每轮 10 题。</p>

    <p v-if="stats" class="bank-stats">
      <Library class="ic" :size="14" /> 题库：{{ stats.total }} 种 · 图片 {{ stats.image }} ·
      音频 {{ stats.audio }}
    </p>
    <p v-else-if="bankError" class="bank-error">
      <AlertTriangle class="ic" :size="14" /> {{ bankError }}
    </p>

    <div class="modes">
      <RouterLink to="/quiz/image" class="mode-card">
        <ImageIcon class="mode-icon" :size="30" />
        <span class="mode-title">看图认鸟</span>
        <span class="mode-sub">来自 iNaturalist 的开放许可照片</span>
      </RouterLink>
      <RouterLink to="/quiz/audio" class="mode-card">
        <AudioLines class="mode-icon" :size="30" />
        <span class="mode-title">听音认鸟</span>
        <span class="mode-sub">来自 Xeno-canto 的真实鸟鸣</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.pick-title {
  font-size: 1.15rem;
  margin-bottom: 6px;
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 12px;
}
.bank-stats {
  font-size: 0.78rem;
  color: var(--primary);
  background: #eaf4ef;
  border-radius: 10px;
  padding: 5px 12px;
  margin-bottom: 12px;
  display: inline-block;
}
.bank-error {
  font-size: 0.78rem;
  color: #8a6d00;
  background: #fdf3d8;
  border-radius: 10px;
  padding: 5px 12px;
  margin-bottom: 12px;
}
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
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
  gap: 3px;
  padding: 16px 12px;
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
.mode-icon {
  color: var(--primary);
  margin-bottom: 2px;
}
.mode-title {
  font-size: 1rem;
  font-weight: 800;
}
.mode-sub {
  font-size: 0.73rem;
  color: var(--text-light);
}
</style>
