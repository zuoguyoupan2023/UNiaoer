<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, AudioLines, Globe2, Image as ImageIcon, Library } from 'lucide-vue-next'
import { loadBank, BankError } from '@/core/bank'

const { t } = useI18n()
const stats = ref<{
  total: number
  image: number
  audio: number
  core?: number
  global?: number
} | null>(null)
/** 题库错误码（errors.* 渲染，015 §6.5） */
const bankErrorCode = ref<{ code: string; status?: number; url?: string } | null>(null)

onMounted(async () => {
  try {
    const bank = await loadBank()
    // 029 M2：优先展示「全量可玩口径」（核心 + 全球,构建期烘焙进 core）；
    // 旧部署（无 universe）回退本层统计。
    const u = bank.universe
    stats.value = u
      ? {
          total: u.total,
          image: u.withImage,
          audio: u.withAudio,
          core: u.coreTotal,
          global: u.globalTotal,
        }
      : { total: bank.total, image: bank.stats.withImage, audio: bank.stats.withAudio }
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

    <!-- 072-b：统计行是异步插入的，之前会把下方模式卡片整体下移 41px
         （手指按下/抬起之间被挪走 → click 丢失 = "第一次点了没反应"）。
         这里固定槽位高度，插不插入都不改变下方位置。 -->
    <div class="stats-slot">
      <p v-if="stats" class="bank-stats">
        <Library class="ic" :size="14" />
        <template v-if="stats.core && stats.global">
          {{ t('home.bankStatsFull', { total: stats.total, core: stats.core, global: stats.global, image: stats.image, audio: stats.audio }) }}
        </template>
        <template v-else>
          {{ t('home.bankStats', { total: stats.total, image: stats.image, audio: stats.audio }) }}
        </template>
      </p>
      <p v-else-if="bankErrorCode" class="bank-error">
        <AlertTriangle class="ic" :size="14" />
        {{ t(`errors.${bankErrorCode.code}`, { status: bankErrorCode.status, url: bankErrorCode.url }) }}
      </p>
    </div>

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

    <!-- 观鸟入口：宽度与上方模式卡一致（半宽居中），标题下两行说明（预习在前，2026-10-29 用户定） -->
    <div class="region-wrap">
      <RouterLink to="/birding" class="region-link">
        <span class="region-head">
          <Globe2 class="ic" :size="18" />
          <span class="region-title">{{ t('nav.birding') }}</span>
        </span>
        <span class="region-sub">{{ t('home.regionPreviewSub') }}</span>
        <span class="region-sub">{{ t('home.regionSub') }}</span>
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
  border-radius: var(--radius-sm);
  padding: 5px 12px;
  margin-bottom: 12px;
  display: inline-block;
}
/* 072-b：固定槽位高度，避免异步插入统计行把下方卡片下移（曾导致 tap 丢失） */
.stats-slot {
  min-height: 34px;
  display: flex;
  justify-content: center;
}
.bank-error {
  font-size: 0.78rem;
  color: #8a6d00;
  background: #fdf3d8;
  border-radius: var(--radius-sm);
  padding: 5px 12px;
  margin-bottom: 12px;
}
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  /* 宽屏限宽居中（2026-10-29 用户反馈）：入口卡太大不美观，与观鸟卡共用同一宽度 */
  max-width: 760px;
  margin: 0 auto;
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
/* 观鸟入口：宽度与上方模式卡一致（半宽居中），纵向布局，标题下两行说明 */
.region-wrap {
  display: flex;
  justify-content: center;
  margin: 10px auto 0;
  max-width: 760px; /* 与 .modes 同宽：三张卡左右边缘对齐 */
}
.region-link {
  width: calc(50% - 5px); /* 与 .modes 的 1fr 1fr + gap 10px 对齐 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 20px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  text-align: center;
  transition: all 0.18s ease;
}
.region-link:hover {
  border-color: var(--primary-light);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
}
.region-head {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.region-link .ic {
  color: var(--primary);
  flex-shrink: 0;
}
.region-title {
  font-weight: 800;
  font-size: 0.9rem;
}
.region-sub {
  font-size: 0.75rem;
  color: var(--text-light);
}
@media (max-width: 520px) {
  .region-link {
    width: 100%; /* 窄屏与 .modes 单列一致 */
  }
}
</style>
