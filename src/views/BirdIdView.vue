<script setup lang="ts">
/**
 * 端上识鸟（docs/055 P1）
 *
 * 定位红线：这是「识鸟 → 看本项目素材」的独立探索工具，**不接答题链路**。
 * 全程端上，用户的录音不上传任何服务器。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Bird, Info, Loader2, Mic, Play, Square, Trash2, TriangleAlert } from 'lucide-vue-next'
import {
  identify,
  loadLabelMap,
  cachedModel,
  modelSize,
  clearModelCache,
  decodeAudio,
  ensureModel,
} from '@/core/birdId'
import { CONF_OK, type Presented } from '@/core/birdId/confidence'
import { loadSpeciesAssets } from '@/core/bank'
import type { Candidate } from '@/core/birdId/types'
import type { MediaAsset } from '@/types'
import { track } from '@/core/metrics'

const { t } = useI18n()
const router = useRouter()

type Phase = 'idle' | 'recording' | 'decoding' | 'loading-model' | 'thinking' | 'done' | 'error'
const phase = ref<Phase>('idle')
const errMsg = ref('')
const view = ref<Presented | null>(null)
const resultMeta = ref<{ durationSec: number; windows: number } | null>(null)
const modelReady = ref(false)
const modelBytes = ref(0)
const dlReceived = ref(0)
const dlTotal = ref(0)
const elapsed = ref(0)

/** 候选 → 该种素材（复用 bank 的按需分片加载） */
const mediaById = ref<Record<string, { images?: MediaAsset[]; audios?: MediaAsset[] }>>({})
const mediaLoading = ref<Set<string>>(new Set())

async function loadMedia(c: Candidate[]) {
  for (const cand of c) {
    const id = cand.speciesId
    if (!id || mediaById.value[id] || mediaLoading.value.has(id)) continue
    mediaLoading.value.add(id)
    try {
      const a = await loadSpeciesAssets(id)
      mediaById.value = { ...mediaById.value, [id]: a ?? {} }
    } catch {
      mediaById.value = { ...mediaById.value, [id]: {} }
    } finally {
      const n = new Set(mediaLoading.value)
      n.delete(id)
      mediaLoading.value = n
    }
  }
}

const hasAnyMedia = computed(() =>
  Object.values(mediaById.value).some((m) => (m.images?.length ?? 0) + (m.audios?.length ?? 0) > 0),
)

const dlPct = computed(() =>
  dlTotal.value ? Math.round((dlReceived.value / dlTotal.value) * 100) : 0,
)

// ---------- 录音 ----------
let mediaRec: MediaRecorder | null = null
let chunks: BlobPart[] = []
let recTimer: number | undefined
let startedAt = 0

async function startRecording() {
  if (phase.value === 'thinking' || phase.value === 'decoding') return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    mediaRec = new MediaRecorder(stream)
    mediaRec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    mediaRec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      void handleBlob(new Blob(chunks, { type: mediaRec?.mimeType || 'audio/webm' }))
    }
    startedAt = Date.now()
    mediaRec.start()
    phase.value = 'recording'
    recTimer = window.setInterval(() => (elapsed.value = (Date.now() - startedAt) / 1000), 200)
    track('birdid_record_start')
  } catch {
    phase.value = 'error'
    errMsg.value = t('birdId.err.mic')
  }
}

function stopRecording() {
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop()
  if (recTimer) clearInterval(recTimer)
}

async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) await handleBlob(f)
  ;(e.target as HTMLInputElement).value = ''
}

async function handleBlob(blob: Blob) {
  phase.value = 'decoding'
  view.value = null
  resultMeta.value = null
  try {
    const samples = await decodeAudio(blob)
    const seconds = samples.length / 48000
    if (seconds < 1) throw new Error('too-short')
    if (!modelReady.value) {
      phase.value = 'loading-model'
      dlTotal.value = (await modelSize()) || 25 * 1024 * 1024
      dlReceived.value = 0
      await ensureModel((r, t) => {
        dlReceived.value = r
        dlTotal.value = t
      })
      modelReady.value = true
    }
    phase.value = 'thinking'
    track('birdid_infer', { seconds: Math.round(seconds) })
    const r = await identify(blob)
    view.value = r.view
    resultMeta.value = { durationSec: r.result.durationSec, windows: r.result.windows }
    phase.value = 'done'
    await loadMedia(r.view.all)
  } catch (e) {
    phase.value = 'error'
    const msg = e instanceof Error ? e.message : String(e)
    // 真实原因只进 console：用户看到的是友好文案，但出问题时 console 里有据可查
    // （i18n 文案是通用兜底，单独看它无法定位是模型下载、Worker 还是解码挂了）
    console.error('[birdId] 识别失败:', e)
    errMsg.value = msg === 'too-short' ? t('birdId.err.tooShort') : t('birdId.err.generic')
    track('birdid_error', { reason: msg.slice(0, 40) })
  }
}

function reset() {
  phase.value = 'idle'
  view.value = null
  resultMeta.value = null
  errMsg.value = ''
  mediaById.value = {}
}

async function checkModel() {
  const hit = await cachedModel()
  modelReady.value = !!hit
  if (hit) modelBytes.value = (await hit.arrayBuffer()).byteLength
}

onMounted(async () => {
  try {
    await loadLabelMap('audio')
  } catch {
    /* 标签表缺失时用户点开始才会报错 */
  }
  await checkModel()
})

watch(modelReady, async (v) => {
  if (v && !modelBytes.value) {
    const hit = await cachedModel()
    if (hit) modelBytes.value = (await hit.arrayBuffer()).byteLength
  }
})

async function dropModel() {
  await clearModelCache()
  modelReady.value = false
  modelBytes.value = 0
  reset()
}

const fmtMB = (b: number) => (b / 1048576).toFixed(1)
const pct = (s: number) => `${(s * 100).toFixed(1)}%`

const busy = computed(
  () => phase.value === 'decoding' || phase.value === 'loading-model' || phase.value === 'thinking',
)

/** 播放该候选的音频：一次只放一个，避免多段叠音 */
function toggle(m: MediaAsset) {
  const el = document.querySelector<HTMLAudioElement>(`audio[src="${CSS.escape(m.url)}"]`)
  if (!el) return
  if (el.paused) {
    document.querySelectorAll<HTMLAudioElement>('audio').forEach((a) => {
      if (a !== el) a.pause()
    })
    void el.play()
  } else {
    el.pause()
  }
}
</script>

<template>
  <div class="wrap">
    <h1><Bird :size="22" /> {{ t('birdId.title') }}</h1>

    <!-- 红线声明：不是答案 -->
    <p class="disclaimer">
      <Info :size="15" />
      <span>{{ t('birdId.disclaimer') }}</span>
    </p>

    <!-- ── 输入区 ── -->
    <section class="panel">
      <div class="row">
        <button v-if="phase !== 'recording'" class="btn primary" :disabled="busy" @click="startRecording">
          <Mic :size="17" /> {{ t('birdId.record') }}
        </button>
        <button v-else class="btn danger" @click="stopRecording">
          <Square :size="17" /> {{ t('birdId.stop') }} {{ elapsed.toFixed(1) }}s
        </button>
        <label class="btn">
          {{ t('birdId.upload') }}
          <input type="file" accept="audio/*" hidden @change="onFile" />
        </label>
        <button v-if="phase !== 'idle'" class="btn ghost" @click="reset">
          <Trash2 :size="16" /> {{ t('birdId.reset') }}
        </button>
      </div>

      <p class="hint">{{ t('birdId.inputHint') }}</p>

      <!-- 模型状态：绝不自动预取 -->
      <div class="model">
        <template v-if="phase === 'loading-model'">
          <Loader2 :size="16" class="spin" />
          <span>{{ t('birdId.model.downloading', { pct: dlPct }) }}</span>
          <div class="bar"><i :style="{ width: dlPct + '%' }" /></div>
        </template>
        <template v-else-if="modelReady">
          <span class="ok">✓</span>
          <span>{{ t('birdId.model.ready', { mb: fmtMB(modelBytes) }) }}</span>
          <button class="link" @click="dropModel">{{ t('birdId.model.drop') }}</button>
        </template>
        <template v-else>
          <TriangleAlert :size="15" />
          <span>{{ t('birdId.model.need', { mb: fmtMB(modelBytes || 25 * 1024 * 1024) }) }}</span>
        </template>
      </div>

      <p v-if="phase === 'thinking'" class="thinking">
        <Loader2 :size="16" class="spin" /> {{ t('birdId.thinking') }}
      </p>
      <p v-if="phase === 'error'" class="err">✗ {{ errMsg }}</p>
    </section>

    <!-- ── 结果 ── -->
    <template v-if="view">
      <section class="panel">
        <div class="row between">
          <h2>{{ t('birdId.result') }}</h2>
          <span v-if="resultMeta" class="meta">
            {{ t('birdId.meta', { sec: resultMeta.durationSec.toFixed(1), n: resultMeta.windows }) }}
          </span>
        </div>

        <p v-if="view.band === 'low'" class="warn">
          <TriangleAlert :size="15" /> {{ t('birdId.band.low') }}
        </p>

        <!-- 没听出来：不硬给候选 -->
        <div v-if="view.band === 'none'" class="none">
          <p>{{ view.message || t('birdId.band.none') }}</p>
          <details v-if="view.all.length">
            <summary>{{ t('birdId.seeRaw') }}</summary>
            <ol class="raw">
              <li v-for="c in view.all" :key="c.label">
                {{ c.label }} — {{ pct(c.score) }}
              </li>
            </ol>
          </details>
        </div>

        <!-- 正常候选 -->
        <ol v-else class="cards">
          <li v-for="(c, i) in view.shown" :key="c.label" class="card" :class="{ top: i === 0 }">
            <div class="head">
              <span class="rank">{{ i + 1 }}</span>
              <span class="conf">
                <i :style="{ width: pct(c.score) }" :class="c.score >= CONF_OK ? 'good' : 'weak'" />
                {{ pct(c.score) }}
              </span>
            </div>

            <div class="name">
              <strong>{{ c.entry?.z || c.label.split('_')[1] || c.label }}</strong>
              <em>{{ c.label }}</em>
            </div>

            <!-- 只能确定到属 -->
            <p v-if="c.entry?.t === 4" class="note">
              {{ t('birdId.genusOnly', { genus: c.entry.g }) }}
            </p>

            <!-- 已对上但项目暂无素材 -->
            <p v-else-if="c.entry && !c.speciesId" class="note">
              {{ t('birdId.noMedia') }}
            </p>

            <!-- 本项目已有素材 -->
            <template v-else-if="c.speciesId">
              <div v-if="mediaLoading.has(c.speciesId)" class="media">
                <Loader2 :size="16" class="spin" />
              </div>
              <div v-else class="media">
                <div v-if="mediaById[c.speciesId]?.images?.length" class="thumbs">
                  <img
                    v-for="m in mediaById[c.speciesId]!.images!.slice(0, 4)"
                    :key="m.url"
                    :src="m.thumbUrl || m.url"
                    :alt="c.label"
                    loading="lazy"
                  />
                </div>
                <div v-if="mediaById[c.speciesId]?.audios?.length" class="audio">
                  <button
                    v-for="m in mediaById[c.speciesId]!.audios!.slice(0, 3)"
                    :key="m.url"
                    class="play"
                    :aria-label="t('birdId.playOne')"
                    @click="toggle(m)"
                  >
                    <Play :size="14" />
                    <!-- 跨域媒体必须 crossorigin 先于 src（AGENTS.md 铁律 5 / docs/033） -->
                    <audio crossorigin="anonymous" :src="m.url" preload="none" />
                  </button>
                </div>
                <button class="link" @click="router.push(`/species/${c.speciesId}`)">
                  {{ t('birdId.viewSpecies') }}
                </button>
              </div>
            </template>
          </li>
        </ol>

        <p v-if="view.hasMappedButNoMedia && view.band !== 'none'" class="note">
          {{ t('birdId.someNoMedia') }}
        </p>
        <p v-if="view.band !== 'none' && !hasAnyMedia" class="note">
          {{ t('birdId.noneHaveMedia') }}
        </p>
      </section>
    </template>
  </div>
</template>


<style scoped>
.wrap {
  max-width: 720px;
  margin: 0 auto;
  padding: 20px 16px 48px;
}
h1 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 20px;
  margin: 0 0 12px;
}
h2 {
  font-size: 16px;
  margin: 0;
}
.disclaimer {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  background: var(--surface-2, #f3f4f6);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 14px;
}
.panel {
  background: var(--surface-1, #fff);
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.row.between {
  justify-content: space-between;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--line, #e5e7eb);
  background: var(--surface-2, #f3f4f6);
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent, #2563eb);
  color: #fff;
  border-color: transparent;
}
.btn.danger {
  background: #dc2626;
  color: #fff;
  border-color: transparent;
}
.btn.ghost {
  background: transparent;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  margin: 10px 0;
}
.model {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-2, #f3f4f6);
  flex-wrap: wrap;
}
.model .ok {
  color: #16a34a;
  font-weight: 700;
}
.bar {
  flex: 1;
  height: 4px;
  background: var(--line, #e5e7eb);
  border-radius: 2px;
  overflow: hidden;
  min-width: 120px;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--accent, #2563eb);
}
.thinking {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  margin: 10px 0 0;
}
.err {
  color: #dc2626;
  font-size: 14px;
  margin: 10px 0 0;
}
.warn {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #b45309;
  font-size: 13px;
  margin: 10px 0;
}
.none p {
  font-size: 14px;
  line-height: 1.7;
  margin: 8px 0;
}
.raw {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  padding-left: 18px;
}
.cards {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 12px;
}
.card.top {
  border-color: var(--accent, #2563eb);
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.rank {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-2, #f3f4f6);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}
.conf {
  position: relative;
  flex: 1;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.conf i {
  display: block;
  height: 4px;
  border-radius: 2px;
  margin-bottom: 3px;
}
.conf i.good {
  background: #16a34a;
}
.conf i.weak {
  background: #f59e0b;
}
.name strong {
  display: block;
  font-size: 15px;
}
.name em {
  display: block;
  font-size: 12px;
  color: var(--text-3, #6b7280);
  font-style: normal;
  margin-top: 2px;
}
.note {
  font-size: 13px;
  color: var(--text-3, #6b7280);
  margin: 8px 0 0;
}
.media {
  margin-top: 10px;
}
.thumbs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.thumbs img {
  width: 72px;
  height: 54px;
  object-fit: cover;
  border-radius: 6px;
}
.audio {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.play {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--line, #e5e7eb);
  background: var(--surface-2, #f3f4f6);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.play audio {
  display: none;
}
.link {
  background: none;
  border: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 0;
  text-align: left;
}
.meta {
  font-size: 12px;
  color: var(--text-3, #6b7280);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
