<script setup lang="ts">
/**
 * 本机识鸟（docs/055 P1 / docs/056 / docs/066）
 *
 * 定位：**两个互相独立的小工具**——听音识别 / 看图识别。各用各的模型、各出各的
 * 候选，谁也不为另一个背书；用户想用哪个用哪个，也可以两个都用。
 *
 * 结果旁边把「你输入的素材」和「模型认为的那个种的素材」并排摆出来（音频配波形），
 * 让用户自己比对——我们给的是参考，不是标准答案。
 *
 * 全程本机：录音与照片不上传任何服务器（docs/055 §5.3 红线）。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Bird, Camera, Loader2, Mic, Square, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import {
  identifyAudio,
  identifyImage,
  loadLabelMap,
  cachedModel,
  modelSize,
  clearModelCache,
  decodeAudio,
  MODELS,
  ensureModel,
} from '@/core/birdId'
import type { Presented } from '@/core/birdId/confidence'
import type { Candidate } from '@/core/birdId/types'
import AttributionLine from '@/components/AttributionLine.vue'
import AudioWave from '@/components/AudioWave.vue'
import {
  loadSpeciesAssets,
  loadBank,
  speciesById,
  speciesName,
  speciesProfileText,
} from '@/core/bank'
import type { MediaAsset } from '@/types'
import { track } from '@/core/metrics'
import { regionLabel } from '@/core/region'
import { useSettingsStore } from '@/stores/settings'
import { loadProvincesIndex, provinceSecondLevelEnabled, provincesOf, type ProvinceIndex } from '@/core/provinces'

const { t, locale } = useI18n()
const router = useRouter()

/**
 * 图像识别：2026-10-20 从 SpeciesNet 换成 OSEA（ResNet34 / 11,000 类）。
 *
 * SpeciesNet 的 fp16 ONNX 输出饱和、排序不可信（docs/059），已弃用；
 * OSEA 在本地 79 张真实素材上 top-1 78.5% / top-3 88.6%（中心裁剪 81.0% / 91.1%），
 * 且 26MB QDQ 已在 ORT-web WASM 跑通。模型与标签对表见 docs/000-recoginize-bird.md。
 */
const ENABLE_IMAGE = true

type Modality = 'audio' | 'image'
type Phase = 'idle' | 'capturing' | 'decoding' | 'loading-model' | 'thinking' | 'error'

const phase = ref<Phase>('idle')
/** 当前正在跑的那一路：状态提示只出现在对应面板里 */
const activeMod = ref<Modality | null>(null)
/** 出错的是哪一路：错误提示放在对应面板里 */
const errMod = ref<Modality | null>(null)
const errMsg = ref('')

/** 用户输入的原始素材（录音 / 照片）。只要输入过就显示，识别失败也一样 */
interface AudioInput {
  url: string
  samples: Float32Array | null
}
interface ImageInput {
  url: string
}
const inputs = reactive<{ audio: AudioInput | null; image: ImageInput | null }>({
  audio: null,
  image: null,
})

/** 两路结果各自独立并存，互不影响 */
const runs = reactive<Record<Modality, Presented | null>>({ audio: null, image: null })
const mediaById = ref<Record<string, { images?: MediaAsset[]; audios?: MediaAsset[] }>>({})

/** 素材切换：每个候选默认用第一张图 / 第一段音，点小图/小按钮可换 */
const heroImg = reactive<Record<string, number>>({})
const heroAudio = reactive<Record<string, number>>({})
const origin = ref<MediaAsset | null>(null)
const heroIdx = (id: string, kind: 'img' | 'audio') =>
  (kind === 'img' ? heroImg[id] : heroAudio[id]) ?? 0
const setHero = (id: string, kind: 'img' | 'audio', i: number) => {
  if (kind === 'img') heroImg[id] = i
  else heroAudio[id] = i
}
/** 该候选的物种档案文本（生境/习性）；**只有人工写过的那 7 个种有**，其余为空 */
const profileOf = (speciesId: string | null) => {
  const sp = speciesId ? speciesById(speciesId) : undefined
  return sp ? speciesProfileText(sp.profile, String(locale.value)) : {}
}
const mediaLoading = ref(new Set<string>())

const modelState = reactive<Record<Modality, { ready: boolean; bytes: number }>>({
  audio: { ready: false, bytes: 0 },
  image: { ready: false, bytes: 0 },
})
const dl = reactive({ received: 0, total: 0 })
const elapsed = ref(0)

const busy = computed(
  () => phase.value === 'decoding' || phase.value === 'loading-model' || phase.value === 'thinking',
)
const dlPct = computed(() => (dl.total ? Math.round((dl.received / dl.total) * 100) : 0))
/** 下载提示按模态说清楚是哪个模型 */
const dlKey = computed(() => `birdId.model.downloading.${activeMod.value ?? 'audio'}`)
const modelKinds = computed<Modality[]>(() => (ENABLE_IMAGE ? ['audio', 'image'] : ['audio']))

/** 参与并排对比的候选下标（最多两个：A / B），按候选排序稳定展示 */
const picks = reactive<Record<Modality, number[]>>({ audio: [0, 1], image: [0, 1] })
/** 只用来画 A/B 角标 */
const SLOTS = ['A', 'B'] as const

function compareCands(m: Modality): Candidate[] {
  const r = runs[m]
  if (!r?.shown.length) return []
  const idx = picks[m]
    .filter((i) => i >= 0 && i < r.shown.length)
    .sort((a, b) => a - b)
  return (idx.length ? idx : [0]).map((i) => r.shown[i]!).filter(Boolean)
}
const cmpAudio = computed(() => compareCands('audio'))
const cmpImage = computed(() => compareCands('image'))

/** 点候选：加入/移出对比。已满两个时挤掉最早的那个 */
function togglePick(m: Modality, i: number) {
  const list = picks[m]
  const at = list.indexOf(i)
  if (at >= 0) {
    if (list.length > 1) list.splice(at, 1)
    return
  }
  if (list.length >= 2) list.shift()
  list.push(i)
}
const slotOf = (m: Modality, i: number) => {
  const at = picks[m].indexOf(i)
  return at >= 0 && picks[m].length > 1 ? SLOTS[at] : ''
}

/** 某个候选的全部素材（可能还没加载完） */
function candAudios(c: Candidate): MediaAsset[] {
  return c.speciesId ? mediaById.value[c.speciesId]?.audios ?? [] : []
}
function candImages(c: Candidate): MediaAsset[] {
  return c.speciesId ? mediaById.value[c.speciesId]?.images ?? [] : []
}
const candAudio = (c: Candidate) =>
  c.speciesId ? candAudios(c)[heroIdx(c.speciesId, 'audio')] ?? null : null
const candImage = (c: Candidate) =>
  c.speciesId ? candImages(c)[heroIdx(c.speciesId, 'img')] ?? null : null
const candLoading = (c: Candidate) => !!c.speciesId && mediaLoading.value.has(c.speciesId)

/** 展示名：优先项目里的本地化名（中/英），回退标签里的中文名 → 标签英文名 */
function nameOf(c: Candidate | null): string {
  if (!c) return ''
  const sp = c.speciesId ? speciesById(c.speciesId) : undefined
  if (sp) return speciesName(sp, String(locale.value))
  return c.entry?.z || c.label.split('_')[1] || c.label
}

/**
 * 当地常见度标签（097 十档制 → 5 档文案）：档位表 1-10，文案只有 5 档语义
 * （很常见/常见/一般/少见/罕见），按每两档一组映射（1-2→1、3-4→2 … 9-10→5）。
 */
function tierLabel(tier: number | null): string {
  if (!tier) return ''
  const band = Math.min(5, Math.max(1, Math.ceil(tier / 2)))
  return t(`birdId.region.tier.${band}`)
}

async function loadMedia(cands: Candidate[]) {
  for (const c of cands) {
    const id = c.speciesId
    if (!id || mediaById.value[id] || mediaLoading.value.has(id)) continue
    mediaLoading.value.add(id)
    try {
      mediaById.value = { ...mediaById.value, [id]: (await loadSpeciesAssets(id)) ?? {} }
    } catch {
      mediaById.value = { ...mediaById.value, [id]: {} }
    } finally {
      const n = new Set(mediaLoading.value)
      n.delete(id)
      mediaLoading.value = n
    }
  }
}

async function ensureReady(kind: Modality) {
  if (modelState[kind].ready) return
  phase.value = 'loading-model'
  dl.total = (await modelSize(MODELS[kind])) || MODELS[kind].sizeMB * 1024 * 1024
  dl.received = 0
  await ensureModel(MODELS[kind], (received, total) => {
    dl.received = received
    dl.total = total
  })
  modelState[kind].ready = true
  modelState[kind].bytes = dl.total
}

/** 换输入前先释放旧的 blob URL，避免整页会话里一直占着内存 */
function clearInput(kind: Modality) {
  const cur = inputs[kind]
  if (cur) URL.revokeObjectURL(cur.url)
  inputs[kind] = null
}

// ---------- 录音 ----------
let mediaRec: MediaRecorder | null = null
let chunks: BlobPart[] = []
let recTimer: number | undefined
let startedAt = 0

async function startRecording() {
  if (busy.value) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    mediaRec = new MediaRecorder(stream)
    mediaRec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    mediaRec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop())
      void handleAudio(new Blob(chunks, { type: mediaRec?.mimeType || 'audio/webm' }))
    }
    startedAt = Date.now()
    mediaRec.start()
    phase.value = 'capturing'
    activeMod.value = 'audio'
    recTimer = window.setInterval(() => (elapsed.value = (Date.now() - startedAt) / 1000), 200)
    track('birdid_record_start')
  } catch {
    phase.value = 'error'
    activeMod.value = null
    errMod.value = 'audio'
    errMsg.value = t('birdId.err.mic')
  }
}

function stopRecording() {
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop()
  if (recTimer) clearInterval(recTimer)
}

async function onAudioFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) await handleAudio(f)
  ;(e.target as HTMLInputElement).value = ''
}

async function onImageFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) await handleImage(f)
  ;(e.target as HTMLInputElement).value = ''
}

/** 每次新识别 +1：迟到的旧结果直接丢弃（用户中途换文件/点重做时不串结果） */
let runSeq = 0

async function handleAudio(blob: Blob) {
  const seq = ++runSeq
  phase.value = 'decoding'
  activeMod.value = 'audio'
  errMsg.value = ''
  errMod.value = null
  runs.audio = null
  picks.audio = [0, 1]
  clearInput('audio')
  inputs.audio = { url: URL.createObjectURL(blob), samples: null }
  try {
    const samples = await decodeAudio(blob)
    if (seq !== runSeq) return
    if (inputs.audio) inputs.audio.samples = samples
    if (samples.length < 12000) throw new Error('too-short')
    await ensureReady('audio')
    if (seq !== runSeq) return
    phase.value = 'thinking'
    track('birdid_infer', { modality: 'audio', seconds: Math.round(samples.length / 48000) })
    const r = await identifyAudio(blob, undefined, regionKey.value)
    if (seq !== runSeq) return
    runs.audio = r.view
    phase.value = 'idle'
    await loadMedia(r.view.all)
  } catch (e) {
    if (seq !== runSeq) return
    phase.value = 'error'
    errMod.value = 'audio'
    console.error('[birdId] audio identify failed:', e)
    const m = e instanceof Error ? e.message : String(e)
    errMsg.value = m === 'too-short' ? t('birdId.err.tooShort') : t('birdId.err.generic')
    track('birdid_error', { modality: 'audio', reason: m.slice(0, 40) })
  } finally {
    if (seq === runSeq) activeMod.value = null
  }
}

async function handleImage(blob: Blob) {
  const seq = ++runSeq
  phase.value = 'decoding'
  activeMod.value = 'image'
  errMsg.value = ''
  errMod.value = null
  runs.image = null
  picks.image = [0, 1]
  clearInput('image')
  inputs.image = { url: URL.createObjectURL(blob) }
  try {
    await ensureReady('image')
    if (seq !== runSeq) return
    phase.value = 'thinking'
    track('birdid_infer', { modality: 'image' })
    const r = await identifyImage(blob, undefined, regionKey.value)
    if (seq !== runSeq) return
    runs.image = r.view
    phase.value = 'idle'
    await loadMedia(r.view.all)
  } catch (e) {
    if (seq !== runSeq) return
    phase.value = 'error'
    errMod.value = 'image'
    console.error('[birdId] image identify failed:', e)
    errMsg.value = t('birdId.err.genericImage')
    track('birdid_error', { modality: 'image' })
  } finally {
    if (seq === runSeq) activeMod.value = null
  }
}

/** 清空一路（或全部）：输入 + 结果 + 选中项一起清 */
function reset(kind?: Modality) {
  runSeq++
  const kinds: Modality[] = kind ? [kind] : ['audio', 'image']
  for (const k of kinds) {
    clearInput(k)
    runs[k] = null
    picks[k] = [0, 1]
    if (errMod.value === k) {
      errMsg.value = ''
      errMod.value = null
    }
  }
  phase.value = 'idle'
  activeMod.value = null
}

async function dropModel(kind: Modality) {
  await clearModelCache(MODELS[kind])
  modelState[kind].ready = false
  modelState[kind].bytes = 0
}

onMounted(async () => {
  // 物种档案（生境/习性）与素材分片都依赖题库已加载
  await loadBank().catch(() => null)
  try {
    await loadLabelMap('audio')
    await loadLabelMap('image')
  } catch {
    /* 标签表缺失时用户点开始才会报错 */
  }
  for (const k of ['audio', 'image'] as Modality[]) {
    const hit = await cachedModel(MODELS[k])
    modelState[k].ready = !!hit
    if (hit) modelState[k].bytes = (await hit.clone().arrayBuffer()).byteLength
  }
})

onBeforeUnmount(() => {
  clearInput('audio')
  clearInput('image')
})

const fmtMB = (b: number) => (b / 1048576).toFixed(1)

/* ═══ 地域先验 ═══
 * 模型的概率饱和在 99%+，单靠分数排序等于按噪声排。真实的强约束是
 * 「你拍到的鸟大概率就在当地」——Merlin 认得准主要就靠这个。
 * 这里让用户选地点，识别后按当地常见度档位重排候选（src/core/birdId/regionPrior.ts）。
 * 默认跟随全局设置里的地区，不额外打断用户；可临时改，不写回设置。
 */
const settings = useSettingsStore()
const regionCountry = ref(String(settings.region ?? 'ALL').split('-')[0] || 'ALL')
const regionCode = ref<string>(settings.region?.includes('-') ? settings.region : '')
const provinceData = ref<ProvinceIndex | null>(null)
const REGION_COUNTRIES = ['CN', 'US', 'CA', 'AU', 'NZ', 'GB', 'IE', 'JP', 'DE', 'FR', 'ES', 'IT', 'NL', 'IN', 'VN']

const regionKey = computed(() =>
  regionCountry.value === 'ALL' ? 'ALL' : regionCode.value ? `${regionCountry.value}-${regionCode.value.replace(`${regionCountry.value}-`, '')}` : regionCountry.value,
)
// 083：镇级/微型国（SI/LV/MK/MT/SG/NR/TV/KI/MH）收起省级选择（数据仍在，仅不提供 UI 入口）
const provinceOptions = computed(() =>
  regionCountry.value === 'ALL' || !provinceSecondLevelEnabled(provinceData.value, regionCountry.value)
    ? []
    : provincesOf(provinceData.value, regionCountry.value, String(locale.value)),
)
const countryName = (cc: string) => (cc === 'ALL' ? t('birdId.region.all') : regionLabel(cc, t, String(locale.value)))

loadProvincesIndex().then((d) => {
  provinceData.value = d
})

function onCountryChange() {
  regionCode.value = ''
}
</script>

<template>
  <div class="wrap">
    <h1><Bird :size="22" /> {{ t('birdId.title') }}</h1>

    <!-- 隐私说明保留一行：识别在本机、录音与照片不上传（055 §5.3 的红线） -->
    <p class="privacy">{{ t('birdId.privacyShort') }}</p>
    <p class="credit">{{ t('birdId.credit') }}</p>

    <!-- 地域先验：模型概率饱和到 99%+ 分不出高下，用「你拍到的鸟就在当地」来排 -->
    <section class="panel regionPick">
      <div class="row between">
        <h2>{{ t('birdId.region.title') }}</h2>
        <span v-if="regionKey !== 'ALL'" class="applied">{{ t('birdId.region.applied') }}</span>
      </div>
      <div class="picks">
        <label>
          <span class="pLabel">{{ t('birdId.region.country') }}</span>
          <select v-model="regionCountry" @change="onCountryChange">
            <option value="ALL">{{ t('birdId.region.all') }}</option>
            <option v-for="cc in REGION_COUNTRIES" :key="cc" :value="cc">{{ countryName(cc) }}</option>
          </select>
        </label>
        <label v-if="provinceOptions.length">
          <span class="pLabel">{{ t('birdId.region.province') }}</span>
          <select v-model="regionCode">
            <option value="">{{ countryName(regionCountry) }}</option>
            <option v-for="p in provinceOptions" :key="p.code" :value="p.code">{{ p.name }}</option>
          </select>
        </label>
      </div>
    </section>

    <!-- ═══ 工具一：听音识别 ═══ -->
    <section class="panel">
      <div class="row between">
        <h2><Mic :size="16" /> {{ t('birdId.mod.audio') }}</h2>
        <button v-if="inputs.audio" class="link sm" @click="reset('audio')">
          <Trash2 :size="13" /> {{ t('birdId.redo') }}
        </button>
      </div>

      <!-- 还没输入：两个入口 -->
      <template v-if="!inputs.audio">
        <p class="hint">{{ t('birdId.hint.audio') }}</p>
        <div class="row">
          <button class="btn primary" :disabled="busy" @click="startRecording">
            <Mic :size="16" /> {{ t('birdId.record') }}
          </button>
          <label class="btn">
            {{ t('birdId.upload') }}
            <input type="file" accept="audio/*" hidden @change="onAudioFile" />
          </label>
        </div>
      </template>

      <template v-else>
        <p v-if="runs.audio?.messageKey" class="bandNote">
          {{ t(runs.audio.messageKey) }}
          <template v-if="runs.audio.messageKey === 'birdId.band.low'">
            {{ t('birdId.band.lowHint.audio') }}
          </template>
        </p>

        <!-- 原始录音 + 最多两个候选：波形并排对比 -->
        <div class="pair" :class="{ two: cmpAudio.length < 2 }">
          <div class="side">
            <h3>{{ t('birdId.yourAudio') }}</h3>
            <AudioWave
              :src="inputs.audio.url"
              :samples="inputs.audio.samples"
              :label="t('birdId.waveYours')"
            />
          </div>
          <div v-for="(c, k) in cmpAudio" :key="c.label" class="side">
            <h3>
              <span v-if="cmpAudio.length > 1" class="slot">{{ SLOTS[k] }}</span>
              {{ t('birdId.matchAudio', { name: nameOf(c) }) }}
            </h3>
            <template v-if="candAudio(c)">
              <AudioWave :src="candAudio(c)!.url" :label="t('birdId.waveMatch')" />
              <div v-if="candAudios(c).length > 1" class="clips">
                <button
                  v-for="(clip, j) in candAudios(c)"
                  :key="clip.url"
                  type="button"
                  class="clip"
                  :class="{ on: j === heroIdx(c.speciesId!, 'audio') }"
                  :aria-pressed="j === heroIdx(c.speciesId!, 'audio')"
                  @click="setHero(c.speciesId!, 'audio', j)"
                >
                  {{ j + 1 }}
                </button>
              </div>
              <AttributionLine :media="candAudio(c)!" />
            </template>
            <p v-else-if="candLoading(c)" class="spinWrap"><Loader2 :size="16" class="spin" /></p>
            <p v-else class="noAsset">{{ t('birdId.noSpeciesAudio') }}</p>
            <p v-if="c.entry?.t === 4" class="cNote">
              {{ t('birdId.genusOnly', { genus: c.entry.g }) }}
            </p>
            <!-- 只有名录明确说「没有素材」时才这么讲（p===false）；speciesId 缺失不再作为判据——
                 产物原来只从采集台账取 id，会把核心库的种误判成没素材（2026-10-17 白头鹎） -->
            <p v-else-if="c.entry && c.entry.p === false" class="cNote">
              {{ t('birdId.noMedia') }}
            </p>
            <div
              v-if="profileOf(c.speciesId).habitat || profileOf(c.speciesId).habit"
              class="facts"
            >
              <p v-if="profileOf(c.speciesId).habitat">
                <span class="fKey">{{ t('birdId.factHabitat') }}</span
                >{{ profileOf(c.speciesId).habitat }}
              </p>
              <p v-if="profileOf(c.speciesId).habit">
                <span class="fKey">{{ t('birdId.factHabit') }}</span
                >{{ profileOf(c.speciesId).habit }}
              </p>
            </div>
            <button v-if="c.speciesId" class="link" @click="router.push(`/species/${c.speciesId}`)">
              {{ t('birdId.viewSpecies') }}
            </button>
          </div>
        </div>

        <!-- 候选：点一下加入/移出对比（最多两个） -->
        <template v-if="runs.audio">
          <h3 class="candHead">{{ t('birdId.candidates') }}</h3>
          <div class="cands">
            <button
              v-for="(c, i) in runs.audio.shown"
              :key="c.label"
              type="button"
              class="cand"
              :class="{ on: picks.audio.includes(i) }"
              :aria-pressed="picks.audio.includes(i)"
              @click="togglePick('audio', i)"
            >
              <span class="candTop">
                <span v-if="slotOf('audio', i)" class="slot sm">{{ slotOf('audio', i) }}</span>
                <span class="cName">{{ nameOf(c) }}</span>
                <span v-if="c.regionTier" class="cTier">{{
                  tierLabel(c.regionTier)
                }}</span>
              </span>
              <span class="cSci">{{ c.label }}</span>
            </button>
          </div>
          <p class="candHint">{{ t('birdId.compareHint') }}</p>
        </template>
      </template>

      <div v-if="phase === 'capturing'" class="status">
        <button class="btn danger" @click="stopRecording">
          <Square :size="16" /> {{ t('birdId.stop') }} {{ elapsed.toFixed(1) }}s
        </button>
      </div>
      <div v-if="activeMod === 'audio' && phase === 'loading-model'" class="status">
        <Loader2 :size="16" class="spin" />
        <span>{{ t(dlKey, { pct: dlPct }) }}</span>
        <div class="bar"><i :style="{ width: dlPct + '%' }" /></div>
      </div>
      <div v-if="activeMod === 'audio' && (phase === 'decoding' || phase === 'thinking')" class="status">
        <Loader2 :size="16" class="spin" /> {{ t('birdId.thinking') }}
      </div>
      <p v-if="phase === 'error' && errMod === 'audio'" class="err">✗ {{ errMsg }}</p>
    </section>

    <!-- ═══ 工具二：看图识别 ═══ -->
    <section v-if="ENABLE_IMAGE" class="panel">
      <div class="row between">
        <h2><Camera :size="16" /> {{ t('birdId.mod.image') }}</h2>
        <button v-if="inputs.image" class="link sm" @click="reset('image')">
          <Trash2 :size="13" /> {{ t('birdId.redo') }}
        </button>
      </div>

      <template v-if="!inputs.image">
        <p class="hint">{{ t('birdId.hint.image') }}</p>
        <label class="btn">
          {{ t('birdId.chooseImage') }}
          <input id="birdid-image-input" type="file" accept="image/*" hidden @change="onImageFile" />
        </label>
      </template>

      <template v-else>
        <p v-if="runs.image?.messageKey" class="bandNote">
          {{ t(runs.image.messageKey) }}
          <template v-if="runs.image.messageKey === 'birdId.band.low'">
            {{ t('birdId.band.lowHint.image') }}
          </template>
        </p>

        <!-- 原始照片 + 最多两个候选：并排对比 -->
        <div class="pair" :class="{ two: cmpImage.length < 2 }">
          <div class="side">
            <h3>{{ t('birdId.yourImage') }}</h3>
            <img class="shot" :src="inputs.image.url" :alt="t('birdId.yourImage')" />
          </div>
          <div v-for="(c, k) in cmpImage" :key="c.label" class="side">
            <h3>
              <span v-if="cmpImage.length > 1" class="slot">{{ SLOTS[k] }}</span>
              {{ t('birdId.matchImage', { name: nameOf(c) }) }}
            </h3>
            <template v-if="candImage(c)">
              <img
                class="shot"
                :src="candImage(c)!.url"
                :alt="nameOf(c)"
                @click="origin = candImage(c)"
              />
              <div v-if="candImages(c).length > 1" class="thumbs">
                <button
                  v-for="(shot, j) in candImages(c)"
                  :key="shot.url"
                  type="button"
                  class="thumb"
                  :class="{ on: j === heroIdx(c.speciesId!, 'img') }"
                  :aria-pressed="j === heroIdx(c.speciesId!, 'img')"
                  @click="setHero(c.speciesId!, 'img', j)"
                >
                  <img :src="shot.thumbUrl || shot.url" alt="" loading="lazy" />
                </button>
              </div>
              <AttributionLine :media="candImage(c)!" />
            </template>
            <p v-else-if="candLoading(c)" class="spinWrap"><Loader2 :size="16" class="spin" /></p>
            <p v-else class="noAsset">{{ t('birdId.noSpeciesImage') }}</p>
            <p v-if="c.entry?.t === 4" class="cNote">
              {{ t('birdId.genusOnly', { genus: c.entry.g }) }}
            </p>
            <p v-else-if="c.entry && c.entry.p === false" class="cNote">
              {{ t('birdId.noMedia') }}
            </p>
            <button v-if="c.speciesId" class="link" @click="router.push(`/species/${c.speciesId}`)">
              {{ t('birdId.viewSpecies') }}
            </button>
          </div>
        </div>

        <template v-if="runs.image">
          <h3 class="candHead">{{ t('birdId.candidates') }}</h3>
          <div class="cands">
            <button
              v-for="(c, i) in runs.image.shown"
              :key="c.label"
              type="button"
              class="cand"
              :class="{ on: picks.image.includes(i) }"
              :aria-pressed="picks.image.includes(i)"
              @click="togglePick('image', i)"
            >
              <span class="candTop">
                <span v-if="slotOf('image', i)" class="slot sm">{{ slotOf('image', i) }}</span>
                <span class="cName">{{ nameOf(c) }}</span>
                <span v-if="c.regionTier" class="cTier">{{
                  tierLabel(c.regionTier)
                }}</span>
              </span>
              <span class="cSci">{{ c.label }}</span>
            </button>
          </div>
          <p class="candHint">{{ t('birdId.compareHint') }}</p>
        </template>
      </template>

      <div v-if="activeMod === 'image' && phase === 'loading-model'" class="status">
        <Loader2 :size="16" class="spin" />
        <span>{{ t(dlKey, { pct: dlPct }) }}</span>
        <div class="bar"><i :style="{ width: dlPct + '%' }" /></div>
      </div>
      <div
        v-if="activeMod === 'image' && (phase === 'decoding' || phase === 'thinking')"
        class="status"
      >
        <Loader2 :size="16" class="spin" /> {{ t('birdId.thinking') }}
      </div>
      <p v-if="phase === 'error' && errMod === 'image'" class="err">✗ {{ errMsg }}</p>
    </section>

    <!-- ═══ 模型缓存状态 ═══ -->
    <section class="panel">
      <div class="modelRow">
        <div v-for="m in modelKinds" :key="m" class="modelItem">
          <span v-if="modelState[m].ready" class="ok">✓</span>
          <TriangleAlert v-else :size="14" />
          <span class="modelTxt">{{
            modelState[m].ready
              ? t(`birdId.model.ready.${m}`, { mb: fmtMB(modelState[m].bytes) })
              : t(`birdId.model.need.${m}`, {
                  mb: fmtMB(modelState[m].bytes || MODELS[m].sizeMB * 1024 * 1024),
                })
          }}</span>
          <button v-if="modelState[m].ready" class="link sm" @click="dropModel(m)">
            {{ t('birdId.model.drop') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 两路都是工具，没有先后、也不互相背书：结果只作参考 -->
    <p class="note">{{ t('birdId.resultsNote') }}</p>
  </div>

  <!-- 看原图：点开大图。xlUrl = 母版原分辨率；originalUrl = 源站原始文件 -->
  <Teleport to="body">
    <div v-if="origin" class="lb" role="dialog" aria-modal="true" @click="origin = null">
      <img :src="origin.xlUrl || origin.url" :alt="t('birdId.title')" @click.stop />
      <a
        v-if="origin.originalUrl"
        class="lbSrc"
        :href="origin.originalUrl"
        target="_blank"
        rel="noopener noreferrer"
        @click.stop
        >{{ t('birdId.viewOriginal') }}</a
      >
      <button class="lbClose" type="button" :aria-label="t('gallery.close')" @click="origin = null">
        <X :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.wrap {
  /* 2026-10-29 与 app-main 全局宽度同步（760 → 1000） */
  max-width: 1000px;
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
h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  margin: 0 0 6px;
}
.privacy {
  font-size: 12px;
  color: var(--muted, #6b7280);
  margin: 0 0 12px;
}
.credit {
  font-size: 11px;
  color: var(--muted, #6b7280);
  margin: -8px 0 12px;
  line-height: 1.5;
}
.panel {
  background: var(--surface-1, #fff);
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
}
.panel .row.between {
  margin-bottom: 8px;
}
/* 并排对比：宽屏「原图 + A + B」三列；窄屏上下堆叠（手机上并排太小，看不清） */
.pair {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-top: 4px;
  align-items: start;
}
@media (min-width: 620px) {
  .pair {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  /* 只有一个候选时不要空着第三列 */
  .pair.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.side {
  min-width: 0;
}
.shot {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--surface-2, #f9fafb);
  border-radius: 8px;
  cursor: zoom-in;
  display: block;
}
.facts {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
}
.facts .fKey {
  color: var(--muted, #6b7280);
  margin-right: 6px;
}
.thumbs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.thumb {
  padding: 0;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  background: none;
  cursor: pointer;
  line-height: 0;
}
.thumb.on {
  border-color: var(--primary, #2563eb);
}
.thumb img {
  width: 52px;
  height: 39px;
  object-fit: cover;
  display: block;
}
.clips {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.clip {
  min-width: 28px;
  height: 26px;
  border-radius: 13px;
  border: 1px solid var(--line, #e5e7eb);
  background: var(--surface-2, #f3f4f6);
  font-size: 12px;
  cursor: pointer;
}
.clip.on {
  border-color: var(--primary, #2563eb);
  color: var(--primary, #2563eb);
}
.regionPick .applied {
  font-size: 12px;
  color: var(--muted, #6b7280);
}
.regionPick .picks {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.regionPick label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.regionPick .pLabel {
  color: var(--muted, #6b7280);
}
.regionPick select {
  font: inherit;
  font-size: 14px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--line, #e5e7eb);
  background: var(--surface-1, #fff);
  color: inherit;
  min-width: 180px;
}
.cTier {
  display: inline-block;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-2, #f3f4f6);
  color: var(--muted, #6b7280);
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
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  margin: 6px 0 10px;
  line-height: 1.6;
}
.bandNote {
  font-size: 12px;
  color: var(--text-2, #4b5563);
  background: var(--surface-2, #f3f4f6);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 0 0 10px;
  line-height: 1.6;
}
.candHead {
  margin-top: 14px;
  font-size: 13px;
  color: var(--muted, #6b7280);
  font-weight: 600;
}
.cands {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  text-align: left;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--line, #e5e7eb);
  background: var(--surface-1, #fff);
  cursor: pointer;
  font: inherit;
}
.candTop {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
/** 并排对比里的 A / B 角标 */
.slot {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--primary, #2563eb);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  flex: 0 0 auto;
}
.slot.sm {
  width: 16px;
  height: 16px;
  font-size: 10px;
}
.candHint {
  font-size: 11px;
  color: var(--text-3, #6b7280);
  margin: 6px 0 0;
  line-height: 1.6;
}
.cand.on {
  border-color: var(--primary, #2563eb);
  background: var(--surface-2, #f9fafb);
}
.cName {
  font-size: 14px;
  font-weight: 600;
}
.cSci {
  font-size: 11px;
  color: var(--text-3, #6b7280);
}

.cNote {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  margin: 4px 0;
  line-height: 1.6;
}
.noAsset {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  line-height: 1.6;
  margin: 6px 0 0;
}
.note {
  font-size: 12px;
  color: var(--muted, #6b7280);
  text-align: center;
  margin: 0 0 14px;
}
.status {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 14px;
  margin-top: 10px;
  flex-wrap: wrap;
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
.err {
  color: #dc2626;
  font-size: 14px;
  margin: 10px 0 0;
}
.modelRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  font-size: 12px;
  color: var(--text-3, #6b7280);
}
.modelItem {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.modelTxt {
  margin-right: 4px;
}
.ok {
  color: #16a34a;
  font-weight: 700;
}
.link {
  background: none;
  border: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 0;
}
.link.sm {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.spinWrap {
  padding: 6px 0;
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
