<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock, Unlock, X } from 'lucide-vue-next'
import {
  downloadBlob,
  drawPoster,
  loadImage,
  posterFilename,
  renderPosterBlob,
  type PosterData,
  type PosterImage,
  type PosterOptions,
  type PosterStrings,
} from '@/core/poster'
import { POSTER_BACKGROUNDS } from '@/core/posterScenes'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { track } from '@/core/metrics'

const props = defineProps<{
  open: boolean
  data: PosterData
  images: PosterImage[]
  /** 035：二维码指向（分享链接；缺省 → 官网，见 core/poster 的 drawQrSlot） */
  qrUrl?: string
  /**
   * 勾选「包含测试内容」时，生成前要求结果页**确保存在**本轮分享链接并回传
   * （已存在则直接返回，不重复创建）。失败/未落库时返回 null → 二维码退回官网。
   */
  ensureShare?: () => Promise<string | null>
}>()
const emit = defineEmits<{ close: [] }>()

// 弹层无障碍：焦点移入/圈闭/ESC 关闭/还原/滚动锁（打开状态由 props.open 驱动）
const { panelRef } = useDialogA11y(() => props.open, { onClose: () => emit('close') })

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

// ---- 测试内容勾选（2026-10-09）----
/** 「海报包含本组测试内容」默认勾选；取消勾选 → 海报不含成绩/错题，二维码也不指向成绩页 */
const includeResults = ref(true)
/** 本次弹层会话内已确认过"分享含测试内容"提醒（避免反复生成时反复打扰） */
const noticeAcked = ref(false)
/** 提醒弹层可见 */
const showNotice = ref(false)
watch(includeResults, (on) => {
  if (!on) noticeAcked.value = false // 重新勾选视为新的同意
})

// ---- F7 导出：生成即下载（弹层顶部画布就是预览，不再另出预览块） ----
const generating = ref(false)
const resultMsg = ref('')
/** 渲染用二维码：优先用生成时确保的链接（props.qrUrl 的更新可能晚一拍） */
const qrForRender = ref<string | undefined>(props.qrUrl ?? undefined)
watch(
  () => props.qrUrl,
  (v) => {
    qrForRender.value = v ?? undefined
  },
)

const W = 1080
const H = 1440

onMounted(() => {
  isMobile.value =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
})

function options(): PosterOptions {
  return {
    themeId: themeId.value,
    bgImage: bgImage.value,
    bgOffset: offset.value,
    // 含测试内容 → 指向本轮成绩页（生成时确保链接）；不含 → 回退官网，不漏任何本轮信息
    qrUrl: includeResults.value ? qrForRender.value : undefined,
    includeResults: includeResults.value,
  }
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
    // 带参构造：{name} 由 i18n 插值（不带参调用会把占位符替换成空串——2026-10-08 空括号 bug，见 docs/034）
    mistakenAs: (name: string) => t('poster.canvas.mistakenAs', { name }),
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
      resultMsg.value = ''
      showNotice.value = false
    }
  },
)
watch(
  // 这些变化都要重绘：二维码/测试内容勾选变化后，画布必须与实际导出一致
  [themeId, bgImage, offset, () => props.qrUrl, includeResults, () => qrForRender.value],
  () => redraw(),
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

/**
 * 生成并**直接下载**（2026-10-09）：弹层顶部画布本身就是实时预览，
 * 另出一个"生成后预览块"是冗余（用户反馈）；文件名 UNiaoer-Test_Share_<时间>.png。
 */
async function generate() {
  if (generating.value) return
  generating.value = true
  resultMsg.value = ''
  try {
    // 含测试内容 → 生成前确保本轮分享链接（已存在则复用；失败不影响出图，二维码退回官网）
    if (includeResults.value && props.ensureShare) {
      const url = await props.ensureShare()
      qrForRender.value = url ?? undefined
    }
    const blob = await renderPosterBlob(props.data, options(), strings.value)
    if (!blob) {
      resultMsg.value = t('poster.genFailed')
      return
    }
    downloadBlob(blob, posterFilename())
    track('poster_create') // 028 计量：海报生成成功（无属性）
  } finally {
    generating.value = false
  }
}

/** 勾选/点生成：首次带测试内容时弹一次提醒（可取消勾选，避免把成绩发出去） */
function onGenerateClick() {
  if (includeResults.value && !noticeAcked.value) {
    showNotice.value = true
    return
  }
  void generate()
}
/** 提醒里点「继续生成」 */
function confirmNotice() {
  noticeAcked.value = true
  showNotice.value = false
  void generate()
}
/** 提醒里点「不含测试内容」 */
function dropResults() {
  includeResults.value = false
  showNotice.value = false
  void generate()
}
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div ref="panelRef" class="panel" role="dialog" aria-modal="true" :aria-label="t('poster.title')">
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
                    role="img"
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
            <p v-if="error" class="err small" role="alert">{{ error }}</p>
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

          <!-- 导出：生成即下载（顶部画布就是预览；2026-10-09 去掉冗余预览块） -->
          <div class="group export">
            <!-- 「海报包含本组测试内容」默认勾选；取消 → 海报与二维码都不含本轮成绩（隐私取向） -->
            <label class="inc-opt">
              <input v-model="includeResults" type="checkbox" />
              <span>{{ t('poster.includeResults') }}</span>
            </label>
            <p class="inc-note" :class="{ warn: includeResults }">
              {{
                includeResults
                  ? t('poster.includeResultsOn')
                  : t('poster.includeResultsOff')
              }}
            </p>

            <button
              class="btn btn-primary"
              style="width: 100%"
              :disabled="generating"
              @click="onGenerateClick"
            >
              {{ generating ? t('poster.generating') : t('poster.generateDownload') }}
            </button>

            <p v-if="resultMsg" class="err small" role="alert" style="margin-top: 8px">{{ resultMsg }}</p>
          </div>
        </div>
      </div>

      <!-- 生成前提醒：海报/分享会带上本轮具体信息（含错题），可改为不含 -->
      <div v-if="showNotice" class="notice" role="alertdialog" aria-modal="true">
        <div class="notice-panel">
          <h4>{{ t('poster.noticeTitle') }}</h4>
          <p>{{ t('poster.noticeBody') }}</p>
          <div class="notice-actions">
            <button class="btn btn-secondary" type="button" @click="dropResults">
              {{ t('poster.noticeDrop') }}
            </button>
            <button class="btn btn-primary" type="button" @click="confirmNotice">
              {{ t('poster.noticeContinue') }}
            </button>
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
  border-radius: var(--radius);
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius);
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
  border-radius: var(--radius);
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
  border-radius: var(--radius-xs);
}
.swatches {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.swatch {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
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
/* 「海报包含本组测试内容」勾选（2026-10-09）：默认勾选，取消则不带上成绩/错题 */
.inc-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
}
.inc-opt input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary);
  cursor: pointer;
}
.inc-note {
  margin: 6px 0 12px;
  font-size: 0.74rem;
  line-height: 1.5;
  color: var(--text-light);
}
.inc-note.warn {
  color: #8a6d00;
}
/* 生成前提醒弹层（可取消勾选，避免把成绩发出去） */
.notice {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(10, 30, 22, 0.5);
  backdrop-filter: blur(3px);
}
.notice-panel {
  width: min(420px, 100%);
  padding: 20px 22px;
  border-radius: var(--radius);
  background: #fff;
  box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.5);
}
.notice-panel h4 {
  margin: 0 0 8px;
  font-size: 1rem;
}
.notice-panel p {
  margin: 0 0 16px;
  font-size: 0.84rem;
  line-height: 1.65;
  color: var(--text-light);
}
.notice-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
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
