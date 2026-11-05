<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, Camera } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'

const props = withDefaults(
  defineProps<{
    media?: MediaAsset
    /**
     * compact：不留上边距/虚线分隔，字号再小一号。
     * 用于「一张图/一段音旁边直接挂署名」的密集场景（预习浮窗的素材区），
     * 那里每条素材都要署名，撑开的分隔线会把版面切碎。
     */
    compact?: boolean
  }>(),
  { compact: false },
)

/** 许可证超链接：优先许可证页，退原始页面（R42，替代单独「原始页面」链接） */
const licenseHref = computed(() => props.media?.licenseUrl || props.media?.sourceUrl || '')

/**
 * 来源图标按**素材类型**取，不用统一的树叶（2026-11-04 用户反馈）。
 * 树叶本意是「自然观察」（此前只有 iNaturalist 一处署名），但 Xeno-canto 是录音库，
 * 挂树叶会让人误以为是同一类来源。音频用声波、图片用相机，一眼分得清。
 */
const SourceIcon = computed(() => (props.media?.type === 'audio' ? AudioLines : Camera))
</script>

<template>
  <p v-if="media" class="attribution" :class="{ compact }">
    <component :is="SourceIcon" class="dot ic" :size="13" aria-hidden="true" />
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
@media (hover: hover) {
.attribution a:hover{
  color: var(--primary);
  text-decoration-color: var(--primary);
}
}.attribution.compact {
  margin-top: 2px;
  padding-top: 0;
  border-top: none;
  font-size: 0.66rem;
  line-height: 1.45;
  text-align: left;
  word-break: break-word;
}
</style>
