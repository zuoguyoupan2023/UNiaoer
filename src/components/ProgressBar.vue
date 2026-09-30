<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ current: number; total: number }>()

const { t } = useI18n()
</script>

<template>
  <div
    class="progress-wrap"
    role="progressbar"
    :aria-valuenow="current"
    :aria-valuemin="0"
    :aria-valuemax="total"
    :aria-label="t('quiz.progress', { n: current, total })"
  >
    <div
      class="progress-bar"
      :style="{ width: (total ? (current / total) * 100 : 0) + '%' }"
    ></div>
  </div>
</template>

<style scoped>
.progress-wrap {
  width: 100%;
  height: 8px;
  background: #dceee4;
  border-radius: 8px;
  margin-bottom: 18px;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--grad);
  border-radius: 8px;
  transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 0 12px rgba(64, 145, 108, 0.6);
}
</style>
