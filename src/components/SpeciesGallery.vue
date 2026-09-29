<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Images, Music, X } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'

const { t } = useI18n()

const props = defineProps<{
  images?: MediaAsset[]
  audios?: MediaAsset[]
  /** 当前展示的素材 URL（select 模式下高亮） */
  activeUrl?: string
  /** select=点击发射 select 交由父级展示；browse=自带预览（缩略图放大 / 内联试听） */
  mode?: 'select' | 'browse'
  label?: string
}>()

const emit = defineEmits<{ select: [MediaAsset] }>()

const open = ref(false)
const zoom = ref<MediaAsset | null>(null)
const images = computed(() => props.images ?? [])
const audios = computed(() => props.audios ?? [])
const total = computed(() => images.value.length + audios.value.length)

function openZoom(m: MediaAsset) {
  zoom.value = m
  document.addEventListener('keydown', onKey)
}
function closeZoom() {
  zoom.value = null
  document.removeEventListener('keydown', onKey)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeZoom()
}
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="total > 1" class="sg">
    <button
      class="sg-toggle"
      type="button"
      :class="{ on: open }"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Images class="ic" :size="13" /> {{ label || t('gallery.title') }}（{{ total }}）
    </button>

    <div v-if="open" class="sg-body">
      <div v-if="images.length" class="sg-group">
        <span class="sg-cap"><Images class="ic" :size="12" /> {{ t('gallery.photos') }}</span>
        <div class="sg-row">
          <button
            v-for="(m, i) in images"
            :key="m.url"
            type="button"
            class="sg-thumb"
            :class="{ on: m.url === activeUrl }"
            :title="`${t('gallery.photos')} ${i + 1}`"
            @click="mode === 'browse' ? openZoom(m) : emit('select', m)"
          >
            <img :src="m.thumbUrl || m.url" alt="" loading="lazy" decoding="async" />
          </button>
        </div>
      </div>

      <div v-if="audios.length" class="sg-group">
        <span class="sg-cap"><Music class="ic" :size="12" /> {{ t('gallery.audios') }}</span>
        <div v-if="mode === 'browse'" class="sg-audios">
          <div v-for="(m, i) in audios" :key="m.url" class="sg-audio-row">
            <span class="sg-num">{{ i + 1 }}</span>
            <audio :src="m.url" controls preload="none"></audio>
          </div>
        </div>
        <div v-else class="sg-row">
          <button
            v-for="(m, i) in audios"
            :key="m.url"
            type="button"
            class="sg-audio"
            :class="{ on: m.url === activeUrl }"
            :title="`${t('gallery.audios')} ${i + 1}`"
            @click="emit('select', m)"
          >
            <Music class="ic" :size="14" /> {{ i + 1 }}
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="zoom"
        class="sg-lightbox"
        role="dialog"
        :aria-label="t('gallery.viewPhoto')"
        @click="closeZoom"
      >
        <img :src="zoom.xlUrl || zoom.url" alt="" @click.stop />
        <button class="sg-close" type="button" :aria-label="t('gallery.close')" @click="closeZoom">
          <X :size="20" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sg {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.sg-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f0f4f2;
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
.sg-toggle:hover,
.sg-toggle.on {
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
}
.sg-body {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  background: #f7faf8;
  border: 1px dashed var(--border);
  animation: pop 0.2s ease;
}
.sg-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.sg-cap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-light);
}
.sg-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.sg-thumb {
  width: 56px;
  height: 46px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  cursor: zoom-in;
  transition: all 0.15s ease;
}
.sg-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sg-thumb:hover {
  border-color: var(--primary-light);
}
.sg-thumb.on {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px #d8f3dc;
}
.sg-audio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: #fff;
  color: var(--text-light);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sg-audio:hover {
  border-color: var(--primary-light);
  color: var(--primary);
}
.sg-audio.on {
  border-color: var(--primary);
  color: var(--primary);
  box-shadow: 0 0 0 2px #d8f3dc;
}
.sg-audios {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.sg-audio-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sg-num {
  min-width: 18px;
  text-align: center;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
}
.sg-audio-row audio {
  flex: 1;
  height: 34px;
}
.sg-lightbox {
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
.sg-lightbox img {
  max-width: 94vw;
  max-height: 92vh;
  border-radius: 12px;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8);
  cursor: default;
}
.sg-close {
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
.sg-close:hover {
  background: rgba(255, 255, 255, 0.26);
}
@keyframes pop {
  0% {
    transform: scale(0.96);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
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
