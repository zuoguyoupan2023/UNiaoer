<script setup lang="ts">
import { Leaf } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'

defineProps<{ media: MediaAsset }>()
</script>

<template>
  <p class="attribution">
    <Leaf class="dot ic" :size="13" />
    {{ media.source }} · {{ media.author }} · {{ media.license }}
    <a v-if="media.sourceUrl" :href="media.sourceUrl" target="_blank" rel="noopener noreferrer">
      原始页面
    </a>
  </p>
</template>

<style scoped>
.attribution {
  font-size: 0.72rem;
  color: var(--text-light);
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  line-height: 1.6;
}
.attribution .dot {
  margin-right: 4px;
  color: var(--primary);
}
</style>
