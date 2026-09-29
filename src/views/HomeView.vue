<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, AudioLines, Image as ImageIcon, Library } from 'lucide-vue-next'
import { loadBank, BankError } from '@/core/bank'

const { t } = useI18n()
const stats = ref<{ total: number; image: number; audio: number } | null>(null)
/** 题库错误码（errors.* 渲染，015 §6.5） */
const bankErrorCode = ref<{ code: string; status?: number; url?: string } | null>(null)

onMounted(async () => {
  try {
    const bank = await loadBank()
    stats.value = {
      total: bank.total,
      image: bank.stats.withImage,
      audio: bank.stats.withAudio,
    }
  } catch (e) {
    bankErrorCode.value =
      e instanceof BankError ? { code: e.code, status: e.status, url: e.url } : { code: 'unknown' }
  }
})
</script>

<template>
  <section class="card center">
    <h2 class="pick-title">{{ t('home.title') }}</h2>
    <p class="muted lead">{{ t('home.lead') }}</p>

    <p v-if="stats" class="bank-stats">
      <Library class="ic" :size="14" />
      {{ t('home.bankStats', { total: stats.total, image: stats.image, audio: stats.audio }) }}
    </p>
    <p v-else-if="bankErrorCode" class="bank-error">
      <AlertTriangle class="ic" :size="14" />
      {{ t(`errors.${bankErrorCode.code}`, { status: bankErrorCode.status, url: bankErrorCode.url }) }}
    </p>

    <div class="modes">
      <RouterLink to="/quiz/image" class="mode-card">
        <ImageIcon class="mode-icon" :size="30" />
        <span class="mode-title">{{ t('nav.imageQuiz') }}</span>
        <span class="mode-sub">{{ t('home.modeImageSub') }}</span>
      </RouterLink>
      <RouterLink to="/quiz/audio" class="mode-card">
        <AudioLines class="mode-icon" :size="30" />
        <span class="mode-title">{{ t('nav.audioQuiz') }}</span>
        <span class="mode-sub">{{ t('home.modeAudioSub') }}</span>
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
