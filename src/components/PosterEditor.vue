<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, Lock, Unlock, X } from 'lucide-vue-next'
import {
  downloadBlob,
  drawPoster,
  loadImage,
  renderPosterBlob,
  type PosterData,
  type PosterImage,
  type PosterOptions,
  type PosterStrings,
} from '@/core/poster'
import { POSTER_BACKGROUNDS } from '@/core/posterScenes'

const props = defineProps<{ open: boolean; data: PosterData; images: PosterImage[] }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

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

// ---- F7 导出：弹层内预览 + 保存（不自动关闭，保留继续编辑） ----
const blobUrl = ref<string | null>(null)
const resultBlob = ref<Blob | null>(null)
const generating = ref(false)
/** 生成后又改了配置 → 预览过期，需重新生成 */
const stale = ref(false)
const resultMsg = ref('')

const W = 1080
const H = 1440

onMounted(() => {
  isMobile.value =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
})
onUnmounted(revokeResult)

function options(): PosterOptions {
  return { themeId: themeId.value, bgImage: bgImage.value, bgOffset: offset.value }
}

/** 海报文案（015 i18n-4）：core/poster 不 import i18n，由这里按 locale 注入 */
const strings = computed<PosterStrings>(() => {
  const d = props.data
  const accuracyLine =
    d.round && d.round > 1 && d.overallAccuracy !== undefined
      ? t('poster.canvas.accuracyOverall', {
          acc: d.accuracy,
          tier: d.tierLabel,
          overall: d.overallAccuracy,
        })
      : t('poster.canvas.accuracy', { acc: d.accuracy, tier: d.tierLabel })
  return {
    roundLabel: t('poster.canvas.roundN', { n: d.round ?? 1 }),
    intro: t('poster.canvas.intro'),
    perfectTitle: t('poster.canvas.perfect'),
    answeredTitle: t('poster.canvas.answered'),
    accuracyLine,
    wrongHeading: t('poster.canvas.wrongHeading'),
    allCorrect: t('poster.canvas.allCorrect'),
    overflow: t('poster.canvas.overflow'),
    timedOut: t('result.timedOut'),
    mistakenAs: t('poster.canvas.mistakenAs'),
    sourceLine: t('poster.canvas.sourceLine'),
    scanCta: t('poster.canvas.scanCta'),
  }
})

function redraw() {
  const c = canvasRef.value
  if (c) drawPoster(c, props.data, options(), strings.value)
}

watch(
  () => props.open,
  (o) => {
    if (o) nextTick(redraw)
    else {
      revokeResult()
      stale.value = false
    }
  },
)
watch(
  [themeId, bgImage, offset],
  () => {
    redraw()
    if (blobUrl.value) stale.value = true
  },
  { deep: true },
)

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

async function selectImage(url: string | null, loadUrl: string | null = url) {
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
    // url 是候选项身份（full）；loadUrl 实际加载（xl 原图，成图更清晰，C2）
    const img = await loadImage(loadUrl ?? url)
    bgUrl.value = url
    bgImage.value = img
    offset.value = { x: 0, y: 0 }
  } catch {
    error.value = t('poster.bgLoadFailed')
  } finally {
    loadingBg.value = false
  }
}

/** 选系统背景：同时清除照片背景，使"上方系统背景"与"下方照片"可直接互切（R45） */
function selectTheme(id: string) {
  if (locked.value) return
  themeId.value = id
  if (bgImage.value || bgUrl.value) {
    bgUrl.value = null
    bgImage.value = null
    offset.value = { x: 0, y: 0 }
  }
}

/** F6：缩略图标题（带"答错"提示） */
function thumbTitle(img: PosterImage): string {
  const base = img.sci ? `${img.answer} · ${img.sci}` : img.answer
  return img.wrong ? t('poster.wrongThumbTitle', { base }) : base
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

function revokeResult() {
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
  blobUrl.value = null
  resultBlob.value = null
}

/** 最终预览区：生成后滚动到可见，避免用户不知道下方已出结果（R44） */
const resultRef = ref<HTMLElement | null>(null)

async function generate() {
  if (generating.value) return
  generating.value = true
  resultMsg.value = ''
  try {
    const blob = await renderPosterBlob(props.data, options(), strings.value)
    if (!blob) {
      resultMsg.value = t('poster.genFailed')
      return
    }
    revokeResult()
    resultBlob.value = blob
    blobUrl.value = URL.createObjectURL(blob)
    stale.value = false
    await nextTick()
    resultRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } finally {
    generating.value = false
  }
}

function download() {
  if (resultBlob.value && !stale.value) downloadBlob(resultBlob.value)
}

function openImage() {
  if (blobUrl.value && !stale.value) window.open(blobUrl.value, '_blank', 'noopener')
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="panel">
      <div class="head">
        <h3>{{ t('poster.title') }}</h3>
        <button class="x" :aria-label="t('common.close')" @click="emit('close')">
          <X :size="16" />
        </button>
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
          <p v-if="bgImage" class="drag-hint">{{ t('poster.dragHint') }}</p>
          <div v-if="loadingBg" class="loading-overlay">
            <span class="spin"></span>
            <span>{{ t('poster.loadingOriginal') }}</span>
          </div>
        </div>

        <div class="controls">
          <!-- 背景 -->
          <div class="group">
            <div class="group-title">
              {{ t('poster.background') }}
              <span v-if="locked" class="lock-tag">{{ t('poster.lockedTag') }}</span>
            </div>
            <div class="swatches">
              <button
                v-for="b in POSTER_BACKGROUNDS"
                :key="b.id"
                class="swatch"
                :class="{ on: themeId === b.id && !bgImage, disabled: locked, light: b.light }"
                :style="{ background: b.swatch }"
                :title="t(b.labelKey)"
                @click="selectTheme(b.id)"
              >
                <span class="swatch-label">{{ t(b.labelKey) }}</span>
              </button>
            </div>
          </div>

          <!-- 背景照片（仅鸟图版有图） -->
          <div v-if="images.length" class="group">
            <div class="group-title">{{ t('poster.bgPhotos') }}</div>
            <div class="thumbs">
              <div v-for="img in images" :key="img.url" class="thumb-cell">
                <div class="thumb-wrap">
                  <button
                    class="thumb"
                    :class="{ on: bgUrl === img.url, disabled: locked, wrong: img.wrong }"
                    :title="thumbTitle(img)"
                    @click="selectImage(img.url, img.xlUrl ?? img.url)"
                  >
                    <img :src="img.thumbUrl ?? img.url" :alt="t('poster.bgCandidateAlt')" loading="lazy" />
                  </button>
                  <span
                    v-if="img.wrong"
                    class="wrong-badge"
                    :title="t('poster.wrongBadgeTitle')"
                    :aria-label="t('poster.wrongBadgeAria')"
                  >
                    <X :size="12" :stroke-width="3" />
                  </span>
                </div>
                <span class="thumb-name">{{ img.answer }}</span>
                <span v-if="img.sci" class="thumb-sci">{{ img.sci }}</span>
              </div>
            </div>
            <p v-if="loadingBg" class="loading-hint">
              <span class="spin-sm"></span> {{ t('poster.downloadingOriginal') }}
            </p>
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
              <Unlock v-if="locked" :size="15" />
              <Lock v-else :size="15" />
              {{ locked ? t('poster.unlockToggle') : t('poster.lockToggle') }}
            </button>
            <button
              v-if="bgImage"
              class="btn btn-secondary"
              style="width: 100%"
              :style="{ marginTop: isMobile ? '0' : '8px' }"
              @click="resetOffset"
            >
              {{ t('poster.resetBg') }}
            </button>
            <p v-if="!isMobile" class="muted small" style="margin-top: 8px">
              {{ t('poster.lockHint') }}
            </p>
          </div>

          <!-- 导出：先生成预览，可在弹层内保存/继续修改（F7） -->
          <div class="group export">
            <button
              class="btn btn-primary"
              style="width: 100%"
              :disabled="generating"
              @click="generate"
            >
              {{
                generating
                  ? t('poster.generating')
                  : blobUrl
                    ? t('poster.regenerate')
                    : t('poster.generate')
              }}
            </button>

            <div v-if="blobUrl" ref="resultRef" class="result" aria-live="polite">
              <img class="result-img" :src="blobUrl" :alt="t('poster.previewAlt')" />
              <p v-if="stale" class="result-status stale">{{ t('poster.staleHint') }}</p>
              <p v-else class="result-status">
                <CircleCheck class="ic" :size="14" /> {{ t('poster.generatedHint') }}
              </p>
              <div class="result-actions">
                <button class="btn btn-secondary" :disabled="stale" @click="download">
                  {{ t('poster.downloadPng') }}
                </button>
                <button class="btn btn-secondary" :disabled="stale" @click="openImage">
                  {{ t('poster.openNewTab') }}
                </button>
              </div>
            </div>
            <p v-if="resultMsg" class="err small" style="margin-top: 8px">{{ resultMsg }}</p>
          </div>
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
  position: relative;
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
/* 加载原图提示（R45）：预览区遮罩 + 列表下文字，避免"无任何提示" */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(245, 248, 246, 0.82);
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--text);
  font-size: 0.84rem;
}
.loading-overlay .spin {
  width: 26px;
  height: 26px;
  border: 3px solid #dceee4;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
.loading-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.78rem;
  color: var(--primary);
}
.loading-hint .spin-sm {
  width: 13px;
  height: 13px;
  border: 2px solid #dceee4;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
.swatch.light .swatch-label {
  color: #333;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
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
  align-items: flex-start;
}
.thumb-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 72px;
}
.thumb-name {
  margin-top: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text);
  text-align: center;
  line-height: 1.25;
  word-break: break-word;
}
.thumb-sci {
  font-size: 0.6rem;
  color: var(--text-light);
  font-style: italic;
  text-align: center;
  line-height: 1.2;
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
.thumb-wrap {
  position: relative;
  line-height: 0;
}
/* F6：答错题所用图 —— 暖色描边 + 右上角小角标（不遮主体） */
.thumb.wrong {
  border-color: #e0a800;
}
.wrong-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #c1121f;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  pointer-events: none;
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
.export {
  border-top: 1px solid var(--border);
  padding-top: 18px;
}
.result {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: #f7faf8;
  text-align: center;
}
.result-img {
  width: 100%;
  max-width: 220px;
  height: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
  display: block;
  margin: 0 auto 10px;
  -webkit-touch-callout: default;
}
.result-status {
  font-size: 0.78rem;
  color: var(--text-light);
  line-height: 1.6;
  margin-bottom: 10px;
}
.result-status.stale {
  color: #8a6d00;
}
.result-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.result-actions .btn {
  padding: 9px 16px;
  font-size: 0.84rem;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
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
