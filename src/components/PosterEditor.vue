<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import {
  downloadPoster,
  drawPoster,
  loadImage,
  type PosterData,
  type PosterOptions,
} from '@/core/poster'
import { POSTER_BACKGROUNDS } from '@/core/posterScenes'

const props = defineProps<{ open: boolean; data: PosterData; images: string[] }>()
const emit = defineEmits<{ close: [] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const themeId = ref('forest')
const bgUrl = ref<string | null>(null)
const bgImage = ref<ImageBitmap | null>(null)
const offset = ref({ x: 0, y: 0 })
const locked = ref(false)
const error = ref('')
const loadingBg = ref(false)
/** N6-B：移动端隐藏锁定按钮，背景自由平移，不做干涉 */
const isMobile = ref(false)

const W = 1080
const H = 1440

onMounted(() => {
  isMobile.value =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
})

function options(): PosterOptions {
  return { themeId: themeId.value, bgImage: bgImage.value, bgOffset: offset.value }
}

function redraw() {
  const c = canvasRef.value
  if (c) drawPoster(c, props.data, options())
}

watch(
  () => props.open,
  (o) => {
    if (o) nextTick(redraw)
  },
)
watch([themeId, bgImage, offset], redraw, { deep: true })

function clampOffset(next: { x: number; y: number }) {
  const img = bgImage.value
  if (!img) return next
  const scale = Math.max(W / img.width, H / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  const baseX = (W - dw) / 2
  const baseY = (H - dh) / 2
  const x = Math.min(0, Math.max(W - dw, baseX + next.x)) - baseX
  const y = Math.min(0, Math.max(H - dh, baseY + next.y)) - baseY
  return { x, y }
}

async function selectImage(url: string | null) {
  if (locked.value) return
  error.value = ''
  if (!url) {
    bgUrl.value = null
    bgImage.value = null
    offset.value = { x: 0, y: 0 }
    return
  }
  loadingBg.value = true
  try {
    const img = await loadImage(url)
    bgUrl.value = url
    bgImage.value = img
    offset.value = { x: 0, y: 0 }
  } catch {
    error.value = '背景图加载失败（跨域受限），已保持纯配色'
  } finally {
    loadingBg.value = false
  }
}

function selectTheme(id: string) {
  if (locked.value) return
  themeId.value = id
}

// ---- 拖拽平移背景 ----
let dragging = false
let last = { x: 0, y: 0 }

function toCanvasScale(): number {
  const c = canvasRef.value
  if (!c) return 1
  return W / (c.clientWidth || W)
}

function onPointerDown(e: PointerEvent) {
  if (!bgImage.value) return
  dragging = true
  last = { x: e.clientX, y: e.clientY }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging || !bgImage.value) return
  const s = toCanvasScale()
  const dx = (e.clientX - last.x) * s
  const dy = (e.clientY - last.y) * s
  last = { x: e.clientX, y: e.clientY }
  offset.value = clampOffset({ x: offset.value.x + dx, y: offset.value.y + dy })
}
function onPointerUp() {
  dragging = false
}
function resetOffset() {
  offset.value = { x: 0, y: 0 }
}

function download() {
  downloadPoster(props.data, options())
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="panel">
      <div class="head">
        <h3>生成海报</h3>
        <button class="x" @click="emit('close')">✕</button>
      </div>

      <div class="body">
        <div class="preview-wrap">
          <canvas
            ref="canvasRef"
            class="preview"
            :class="{ grab: !!bgImage }"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointerleave="onPointerUp"
          ></canvas>
          <p v-if="bgImage" class="drag-hint">拖拽画面平移背景</p>
        </div>

        <div class="controls">
          <!-- 背景 -->
          <div class="group">
            <div class="group-title">
              背景
              <span v-if="locked" class="lock-tag">已锁定</span>
            </div>
            <div class="swatches">
              <button
                v-for="t in POSTER_BACKGROUNDS"
                :key="t.id"
                class="swatch"
                :class="{ on: themeId === t.id, disabled: locked }"
                :style="{ background: t.swatch }"
                :title="t.label"
                @click="selectTheme(t.id)"
              >
                <span class="swatch-label">{{ t.label }}</span>
              </button>
            </div>
          </div>

          <!-- 背景照片（仅鸟图版有图） -->
          <div v-if="images.length" class="group">
            <div class="group-title">背景照片</div>
            <div class="thumbs">
              <button
                class="thumb none"
                :class="{ on: !bgUrl, disabled: locked }"
                @click="selectImage(null)"
              >
                纯场景
              </button>
              <button
                v-for="url in images"
                :key="url"
                class="thumb"
                :class="{ on: bgUrl === url, disabled: locked }"
                @click="selectImage(url)"
              >
                <img :src="url" alt="背景候选" loading="lazy" />
              </button>
            </div>
            <p v-if="loadingBg" class="muted small">背景图加载中…</p>
            <p v-if="error" class="err small">{{ error }}</p>
          </div>

          <!-- 锁定 / 平移（仅鸟图版有背景照片时才需要；移动端隐藏锁定，自由平移） -->
          <div v-if="images.length && (!isMobile || bgImage)" class="group">
            <button
              v-if="!isMobile"
              class="btn btn-secondary"
              style="width: 100%"
              @click="locked = !locked"
            >
              {{ locked ? '🔓 已锁定（点击解锁）' : '🔒 锁定其他修改' }}
            </button>
            <button
              v-if="bgImage"
              class="btn btn-secondary"
              style="width: 100%"
              :style="{ marginTop: isMobile ? '0' : '8px' }"
              @click="resetOffset"
            >
              重置背景位置
            </button>
            <p v-if="!isMobile" class="muted small" style="margin-top: 8px">
              锁定后只能上下左右平移背景，背景与照片不可再改。
            </p>
          </div>

          <button class="btn btn-primary" style="width: 100%" @click="download">下载海报 PNG</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 30, 22, 0.55);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.panel {
  background: #fff;
  border-radius: 20px;
  width: min(960px, 100%);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.6);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.head h3 {
  font-size: 1rem;
}
.x {
  border: none;
  background: #f0f4f2;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 0.9rem;
}
.body {
  display: flex;
  gap: 18px;
  padding: 18px 20px 20px;
  overflow: auto;
}
.preview-wrap {
  flex: 0 0 auto;
  width: 340px;
  max-width: 45vw;
}
.preview {
  width: 100%;
  height: auto;
  border-radius: 14px;
  border: 1px solid var(--border);
  display: block;
  touch-action: none;
}
.preview.grab {
  cursor: grab;
}
.preview.grab:active {
  cursor: grabbing;
}
.drag-hint {
  font-size: 0.72rem;
  color: var(--text-light);
  text-align: center;
  margin-top: 6px;
}
.controls {
  flex: 1;
  min-width: 220px;
}
.group {
  margin-bottom: 18px;
}
.group-title {
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.lock-tag {
  font-size: 0.68rem;
  background: #fdf3d8;
  color: #8a6d00;
  padding: 2px 8px;
  border-radius: 8px;
}
.swatches {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.swatch {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 3px solid #fff;
  box-shadow: 0 0 0 1.5px var(--border);
  cursor: pointer;
  transition: transform 0.15s;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 3px;
}
.swatch-label {
  font-size: 0.58rem;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  white-space: nowrap;
}
.swatch:hover:not(.disabled) {
  transform: scale(1.08);
}
.swatch.on {
  box-shadow: 0 0 0 3px var(--primary);
}
.swatch.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.thumbs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.thumb {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid var(--border);
  background: #f5f5f5;
  cursor: pointer;
  padding: 0;
  position: relative;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb.on {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary);
}
.thumb.none {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  color: var(--text-light);
  background: #fff;
}
.thumb.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.small {
  font-size: 0.76rem;
}
.err {
  color: var(--wrong);
}
@media (max-width: 720px) {
  .body {
    flex-direction: column;
  }
  .preview-wrap {
    width: 100%;
    max-width: none;
  }
}
</style>
