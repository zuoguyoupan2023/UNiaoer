<script setup lang="ts">
import { computed } from 'vue'
import { Leaf } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'

const props = defineProps<{ media: MediaAsset }>()

/** 许可证超链接：优先许可证页，退原始页面（R42，替代单独「原始页面」链接） */
const licenseHref = computed(() => props.media.licenseUrl || props.media.sourceUrl || '')
</script>

<template>
  <p class="attribution">
    <Leaf class="dot ic" :size="13" />
    <a
      v-if="media.sourceUrl"
      :href="media.sourceUrl"
      target="_blank"
      rel="noopener noreferrer"
      >{{ media.source }}</a
    >
    <span v-else>{{ media.source }}</span>
    · {{ media.author }} ·
    <a v-if="licenseHref" :href="licenseHref" target="_blank" rel="noopener noreferrer">{{
      media.license
    }}</a>
    <span v-else>{{ media.license }}</span>
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
  text-align: center;
}
.attribution .dot {
  margin-right: 4px;
  color: var(--primary);
}
.attribution a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
}
.attribution a:hover {
  color: var(--primary);
  text-decoration-color: var(--primary);
}
</style>
