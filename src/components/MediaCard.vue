<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ImageOff, VolumeX, X, ZoomIn } from 'lucide-vue-next'
import { thumbHashToDataURL } from 'thumbhash'
import type { MediaAsset, MediaType } from '@/types'
import { preferredImageUrl } from '@/core/mediaLoader'
import { useDialogA11y } from '@/composables/useDialogA11y'
import AttributionLine from './AttributionLine.vue'

const { t } = useI18n()

const props = defineProps<{
  type: MediaType
  media: MediaAsset
  autoplay?: boolean
  autoplayDelay?: number
  /** 是否在媒体下方显示署名行；答题中移到卡片最底部时置 false（R41） */
  showAttribution?: boolean
}>()

/** audio-play：考题音频真正开始播放时触发（听音版计时/干扰以此为起点，R24） */
const emit = defineEmits<{ 'audio-play': [] }>()

const audioEl = ref<HTMLAudioElement | null>(null)
const imageLoaded = ref(false)
const imageFailed = ref(false)
const playBlocked = ref(false)
/** 该浏览器下优选的图片地址（AVIF 可用且素材提供时用 AVIF） */
const src = ref(props.media.url)
/** ThumbHash 解码出的模糊占位图（data URL） */
const placeholder = ref('')
/** 点击看原图（xl）弹层 */
const zoomed = ref(false)
// 焦点移入/圈闭/ESC/还原由 useDialogA11y 统一处理
const { panelRef: zoomPanelRef } = useDialogA11y(() => zoomed.value, { onClose: closeZoom })
let timer: number | undefined

function decodePlaceholder(hash: string) {
  try {
    const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    placeholder.value = thumbHashToDataURL(bytes)
  } catch {
    placeholder.value = '' // 解码失败就走骨架屏
  }
}

onMounted(() => {
  if (props.type === 'image') {
    if (props.media.thumbhash) decodePlaceholder(props.media.thumbhash)
    preferredImageUrl(props.media).then((u) => {
      src.value = u
    })
  }
  if (props.type === 'audio' && props.autoplay) {
    timer = window.setTimeout(() => {
      const el = audioEl.value
      if (!el) return
      el.play().catch(() => {
        playBlocked.value = true
      })
    }, props.autoplayDelay ?? 2000)
  }
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
  audioEl.value?.pause()
})

// 切题（key 重挂载）时会重建组件；同一素材字段变化也要跟随
watch(
  () => [props.media.url, props.media.avifUrl, props.media.thumbhash] as const,
  () => {
    imageLoaded.value = false
    imageFailed.value = false
    placeholder.value = ''
    if (props.media.thumbhash) decodePlaceholder(props.media.thumbhash)
    src.value = props.media.url
    if (props.type === 'image') preferredImageUrl(props.media).then((u) => (src.value = u))
  },
)

function openZoom() {
  if (!props.media.xlUrl) return
  zoomed.value = true
}

function closeZoom() {
  zoomed.value = false
}
</script>

<template>
  <div class="media">
    <div v-if="type === 'image'" class="img-wrap">
      <!-- ThumbHash 模糊占位：先于大图出现，消除等待感（C2） -->
      <img v-if="placeholder && !imageLoaded" :src="placeholder" alt="" aria-hidden="true" class="ph" />
      <img
        :key="src"
        :src="src"
        :alt="t('media.birdAlt')"
        decoding="async"
        fetchpriority="high"
        :class="{ loaded: imageLoaded }"
        @load="imageLoaded = true"
        @error="imageFailed = true"
      />
      <button
        v-if="media.xlUrl && imageLoaded && !imageFailed"
        class="zoom-btn"
        type="button"
        :title="t('media.viewOriginal')"
        :aria-label="t('media.viewOriginal')"
        @click="openZoom"
      >
        <ZoomIn class="ic" :size="16" />
      </button>
      <span class="corner-left"><slot name="media-corner" /></span>
      <div v-if="!imageLoaded && !imageFailed && !placeholder" class="skeleton">
        <span class="spin"></span> {{ t('media.loadingImage') }}
      </div>
      <div v-else-if="imageFailed" class="failed-msg">
        <ImageOff class="ic" :size="18" /> {{ t('media.imageFailed') }}
      </div>
    </div>

    <template v-else>
      <div class="audio-row">
        <!-- crossorigin 必须在 src 之前：Safari 只在设置 src 前读取它。
             CORS 模式（R2 已配 ACAO:*）是 iOS 能播放 SW 缓存音频的前提——见 docs/033 -->
        <audio
          ref="audioEl"
          crossorigin="anonymous"
          :src="media.url"
          controls
          preload="auto"
          @play="emit('audio-play')"
        ></audio>
      </div>
      <div class="audio-under">
        <slot name="media-corner" />
        <p v-if="playBlocked" class="hint" role="status">
          <VolumeX class="ic" :size="15" /> {{ t('media.autoplayBlocked') }}
        </p>
      </div>
    </template>

    <AttributionLine v-if="showAttribution !== false" :media="media" />
  </div>

  <!-- 原图弹层（xl） -->
  <Teleport to="body">
    <div
      v-if="zoomed"
      ref="zoomPanelRef"
      class="lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="t('media.originalView')"
      @click="closeZoom"
    >
      <img :src="media.xlUrl" :alt="t('media.originalImage')" @click.stop />
      <button class="close" type="button" :aria-label="t('common.close')" @click="closeZoom">
        <X :size="20" />
      </button>
    </div>
  </Teleport>
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
/* ThumbHash 模糊占位：铺满容器，轻微放大避免模糊边缘露白 */
.ph {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: 300px;
  border-radius: 16px;
  object-fit: contain;
  border: none;
  box-shadow: none;
  background: transparent;
  opacity: 1;
  filter: blur(10px) saturate(1.15);
  transform: scale(1.04);
}
.zoom-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--text);
  font-size: 0.75rem;
  cursor: zoom-in;
  backdrop-filter: blur(4px);
  transition: all 0.18s ease;
}
.zoom-btn:hover {
  background: #fff;
  border-color: var(--primary-light);
}
.skeleton,
.failed-msg {
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
/* 听音版媒体行 + 角标容器（media-corner 由父级填充，R24） */
.audio-row {
  display: flex;
  justify-content: center;
}
.audio-under {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 26px;
}
/* 图片模式：左下角标与 zoom-btn（右下）对称 */
.corner-left {
  position: absolute;
  left: 10px;
  bottom: 10px;
}
.hint {
  font-size: 0.78rem;
  color: #8a6d00;
  margin-top: 6px;
}
/* 原图弹层 */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 18, 14, 0.86);
  backdrop-filter: blur(6px);
  cursor: zoom-out;
  animation: fade 0.2s ease;
}
.lightbox img {
  max-width: 94vw;
  max-height: 92vh;
  border-radius: 12px;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8);
  cursor: default;
}
.lightbox .close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
}
.lightbox .close:hover {
  background: rgba(255, 255, 255, 0.26);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
