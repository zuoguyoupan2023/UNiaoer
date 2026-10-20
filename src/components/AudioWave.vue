<script setup lang="ts">
/**
 * 音频波形 + 播放器（识别页并排对比用）
 *
 * - 有 `samples`（用户刚录/刚上传的音频已经解码过）就直接画；
 * - 否则按 `src` 取回音频自行解码（物种素材走这条路）；
 * - 波形可点击定位，播放进度用高亮显示已播部分；
 * - 原生 `<audio controls>` 兜底（无障碍、移动端都可靠）。
 *
 * 跨域素材必须 `crossorigin` 且**写在 src 之前**：Safari 在设置 src 的那一刻
 * 就决定了这条媒体的 CORS 模式（docs/033，2026-10-08 iPhone 音频全挂的根因）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { decodeAudio } from '@/core/birdId'
import { computePeaks, WAVE_BUCKETS } from '@/core/birdId/waveform'

const { t } = useI18n()

const props = defineProps<{
  src?: string
  /** 已解码的 48kHz 单声道样本；有则不重复解码 */
  samples?: Float32Array | null
  /** 无障碍描述（如「你的录音波形」） */
  label?: string
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)
const peaks = ref<Float32Array | null>(null)
const loading = ref(false)
const failed = ref(false)
const played = ref(0)

/** 同一 URL 只解码一次（切换候选再切回来时不重复开销） */
const peakCache = new Map<string, Float32Array>()

async function loadPeaks() {
  const src = props.src
  if (props.samples?.length) {
    peaks.value = computePeaks(props.samples, WAVE_BUCKETS)
    failed.value = false
    return
  }
  if (!src) {
    peaks.value = null
    return
  }
  const hit = peakCache.get(src)
  if (hit) {
    peaks.value = hit
    failed.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const res = await fetch(src, { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const samples = await decodeAudio(new Blob([await res.arrayBuffer()]))
    const p = computePeaks(samples, WAVE_BUCKETS)
    peakCache.set(src, p)
    peaks.value = p
  } catch {
    // 拿不到波形不影响播放：画一条中线，播放器照旧可用
    peaks.value = null
    failed.value = true
  } finally {
    loading.value = false
  }
}

function cssVar(c: HTMLCanvasElement, name: string, fallback: string) {
  const v = getComputedStyle(c).getPropertyValue(name).trim()
  return v || fallback
}

function draw() {
  const c = canvas.value
  if (!c) return
  const w = c.clientWidth || 280
  const h = c.clientHeight || 60
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const mid = h / 2
  const color = cssVar(c, '--primary', '#2563eb')
  const p = peaks.value
  if (!p) {
    ctx.strokeStyle = cssVar(c, '--border', '#e5e7eb')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(w, mid)
    ctx.stroke()
    return
  }

  const n = p.length
  const bw = w / n
  const barW = Math.max(bw - 0.6, 1)
  const amp = (v: number) => Math.max(v * (mid - 2), 0.7)

  // 未播放：半透明；已播放：实色（覆盖在左侧）
  ctx.fillStyle = color
  ctx.globalAlpha = 0.32
  for (let i = 0; i < n; i++) {
    const a = amp(p[i]!)
    ctx.fillRect(i * bw, mid - a, barW, a * 2)
  }
  const cut = Math.max(0, Math.min(1, played.value)) * w
  if (cut > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, cut, h)
    ctx.clip()
    ctx.globalAlpha = 1
    for (let i = 0; i < n; i++) {
      const a = amp(p[i]!)
      ctx.fillRect(i * bw, mid - a, barW, a * 2)
    }
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

function syncProgress() {
  const el = audioEl.value
  if (!el || !Number.isFinite(el.duration) || el.duration <= 0) {
    played.value = 0
    return
  }
  played.value = el.currentTime / el.duration
  draw()
}

function seek(ev: MouseEvent) {
  const el = audioEl.value
  const c = canvas.value
  if (!el || !c || !Number.isFinite(el.duration) || el.duration <= 0) return
  const rect = c.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  el.currentTime = ratio * el.duration
  played.value = ratio
  draw()
}

let ro: ResizeObserver | null = null

onMounted(() => {
  void loadPeaks().then(draw)
  if (typeof ResizeObserver !== 'undefined' && canvas.value) {
    ro = new ResizeObserver(draw)
    ro.observe(canvas.value)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

watch(
  () => [props.src, props.samples] as const,
  () => {
    played.value = 0
    peaks.value = null
    void loadPeaks().then(draw)
  },
)
</script>

<template>
  <div class="aw">
    <div class="awCanvasWrap">
      <canvas
        ref="canvas"
        class="awCanvas"
        :class="{ loading }"
        role="img"
        :aria-label="label"
        @click="seek"
      />
      <span v-if="failed" class="awNote">{{ t('birdId.waveFailed') }}</span>
    </div>
    <!-- crossorigin 必须在 src 之前：Safari 只读设置 src 那一刻的值（docs/033） -->
    <audio
      ref="audioEl"
      crossorigin="anonymous"
      :src="src"
      controls
      preload="metadata"
      @timeupdate="syncProgress"
      @seeked="syncProgress"
      @play="syncProgress"
      @pause="syncProgress"
      @ended="syncProgress"
    />
  </div>
</template>

<style scoped>
.aw {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.awCanvasWrap {
  position: relative;
}
.awCanvas {
  display: block;
  width: 100%;
  height: 60px;
  cursor: pointer;
  background: var(--surface-2, #f9fafb);
  border-radius: 6px;
}
.awCanvas.loading {
  opacity: 0.5;
}
.awNote {
  position: absolute;
  right: 8px;
  top: 6px;
  font-size: 11px;
  color: var(--text-3, #6b7280);
}
audio {
  width: 100%;
  height: 32px;
}
</style>
