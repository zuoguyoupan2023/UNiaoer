<script setup lang="ts">
import type { MediaAsset, MediaType } from '@/types'
import AttributionLine from './AttributionLine.vue'

defineProps<{ type: MediaType; media: MediaAsset }>()
</script>

<template>
  <div class="media">
    <img
      v-if="type === 'image'"
      :src="media.url"
      alt="待识别的鸟类"
      loading="lazy"
      decoding="async"
    />
    <audio v-else :src="media.url" controls preload="metadata" />
    <AttributionLine :media="media" />
  </div>
</template>

<style scoped>
.media {
  text-align: center;
  margin-bottom: 18px;
}
.media img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 16px;
  object-fit: contain;
  background: #f5f5f5;
  border: 1px solid var(--border);
  box-shadow: 0 16px 34px -18px rgba(20, 52, 42, 0.5);
}
.media audio {
  width: 100%;
  max-width: 440px;
  margin: 12px 0;
}
</style>
