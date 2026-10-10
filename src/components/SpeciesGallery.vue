<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Images, Music, X } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'
import { useDialogA11y } from '@/composables/useDialogA11y'

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

/**
 * 去冗余（2026-10-09）：select 模式下**当前正展示的素材不再列出**——
 * 否则「更多素材」里第一项就是题面本身，点它等于什么都不做（图题重复图、音题重复音）。
 * 过滤后自然形成"看图的看它怎么叫 / 听音的看它长什么样"：
 *   1 图 1 音的长尾种 → 图题只列音频、音题只列图片；核心种（5+5）仍保留**其余**图/音可切换（C3）。
 * browse 模式（结果页/错题本/物种详情）不传 activeUrl → 一张不滤，语义不变。
 */
const images = computed(() => {
  const list = props.images ?? []
  return props.activeUrl ? list.filter((m) => m.url !== props.activeUrl) : list
})
const audios = computed(() => {
  const list = props.audios ?? []
  return props.activeUrl ? list.filter((m) => m.url !== props.activeUrl) : list
})
const total = computed(() => images.value.length + audios.value.length)
const allTotal = computed(() => (props.images?.length ?? 0) + (props.audios?.length ?? 0))
/** 有可展示的"非当前"素材才渲染：单个同类素材（browse 单人素材）仍隐藏 */
const visible = computed(() => total.value >= 1 && (total.value > 1 || allTotal.value > total.value))

// 焦点移入/圈闭/ESC/还原由 useDialogA11y 统一处理
const { panelRef: zoomPanelRef } = useDialogA11y(() => !!zoom.value, { onClose: closeZoom })

function openZoom(m: MediaAsset) {
  zoom.value = m
}
function closeZoom() {
  zoom.value = null
}
</script>

<template>
  <div v-if="visible" class="sg">
    <button
      class="sg-toggle"
      type="button"
      :class="{ on: open }"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Images class="ic" :size="13" />
      {{ label || t('gallery.title') }}{{ t('gallery.count', { n: total }) }}
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
            :aria-label="t('gallery.photoN', { n: i + 1 })"
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
            <!-- crossorigin 先于 src（Safari 只读取设置 src 前的值）；iOS 播放 SW 缓存音频的前提 -->
            <audio crossorigin="anonymous" :src="m.url" controls preload="none"></audio>
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
            :aria-label="t('gallery.audioN', { n: i + 1 })"
            :aria-pressed="m.url === activeUrl"
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
        ref="zoomPanelRef"
        class="sg-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="t('gallery.viewPhoto')"
        @click="closeZoom"
      >
        <img :src="zoom.xlUrl || zoom.url" :alt="t('gallery.photoLargeAlt')" @click.stop />
        <button class="sg-close" type="button" :aria-label="t('gallery.close')" @click="closeZoom">
          <X :size="20" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sg {
  min-width: 0; /* 作为 flex 子项允许收缩，防内部固定宽度撑破父容器 */
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-xs);
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
  border-radius: var(--radius-xs);
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
  min-width: 0; /* audio 有固有宽度，不置 0 会把整行撑出容器（移动端右溢） */
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
  border-radius: var(--radius-sm);
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
