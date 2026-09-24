<script setup lang="ts">
defineProps<{ current: number; total: number }>()
</script>

<template>
  <div class="progress-wrap">
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
