<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ImageOff, VolumeX } from 'lucide-vue-next'
import type { MediaAsset, MediaType } from '@/types'
import AttributionLine from './AttributionLine.vue'

const props = defineProps<{
  type: MediaType
  media: MediaAsset
  autoplay?: boolean
  autoplayDelay?: number
}>()

const audioEl = ref<HTMLAudioElement | null>(null)
const imageLoaded = ref(false)
const imageFailed = ref(false)
const playBlocked = ref(false)
let timer: number | undefined

onMounted(() => {
  if (props.type !== 'audio' || !props.autoplay) return
  timer = window.setTimeout(() => {
    const el = audioEl.value
    if (!el) return
    el.play().catch(() => {
      playBlocked.value = true
    })
  }, props.autoplayDelay ?? 2000)
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
  audioEl.value?.pause()
})
</script>

<template>
  <div class="media">
    <div v-if="type === 'image'" class="img-wrap">
      <img
        :src="media.url"
        alt="待识别的鸟类"
        decoding="async"
        :class="{ loaded: imageLoaded }"
        @load="imageLoaded = true"
        @error="imageFailed = true"
      />
      <div v-if="!imageLoaded && !imageFailed" class="skeleton">
        <span class="spin"></span> 图片加载中…
      </div>
      <div v-else-if="imageFailed" class="failed">
        <ImageOff class="ic" :size="18" /> 图片加载失败
      </div>
    </div>

    <template v-else>
      <audio ref="audioEl" :src="media.url" controls preload="auto"></audio>
      <p v-if="playBlocked" class="hint">
        <VolumeX class="ic" :size="15" /> 浏览器拦截了自动播放，请点击播放按钮
      </p>
    </template>

    <AttributionLine :media="media" />
  </div>
</template>

<style scoped>
.media {
  text-align: center;
  margin-bottom: 18px;
}
.img-wrap {
  position: relative;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.img-wrap img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 16px;
  object-fit: contain;
  background: #f5f5f5;
  border: 1px solid var(--border);
  box-shadow: 0 16px 34px -18px rgba(20, 52, 42, 0.5);
  opacity: 0;
  transition: opacity 0.25s ease;
}
.img-wrap img.loaded {
  opacity: 1;
}
.skeleton,
.failed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-light);
  font-size: 0.85rem;
  background: #f5f8f6;
  border-radius: 16px;
  border: 1px dashed var(--border);
}
.spin {
  width: 16px;
  height: 16px;
  border: 3px solid #dceee4;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
.media audio {
  width: 100%;
  max-width: 440px;
  margin: 12px 0;
}
.hint {
  font-size: 0.78rem;
  color: #8a6d00;
  margin-top: 6px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
