<script setup lang="ts">
/**
 * 本机识鸟（docs/055 P1 / docs/056）
 *
 * 定位红线：这是「识鸟 → 看本项目素材」的独立探索工具，**不接答题链路**。
 * 全程在本机完成，用户的录音与照片不上传任何服务器。
 *
 * 核心交互是**跨模态互证**：先任选一个模态识别 → 主动引导用另一个模态复核 →
 * 并排显示两路结果。理由见 src/core/birdId/crossModal.ts：两个模型的失效模式
 * 不相关（乌鸫会学别的鸟叫，声音会认错；照片在羽色体型上几乎不会犯这类错）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  Bird,
  Camera,
  Loader2,
  Mic,
  Play,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-vue-next'
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
import AttributionLine from '@/components/AttributionLine.vue'
import { compare, topResult, type CrossResult, type Modality } from '@/core/birdId/crossModal'
import type { Candidate } from '@/core/birdId/types'
import { loadSpeciesAssets, loadBank, speciesById, speciesProfileText } from '@/core/bank'
import type { MediaAsset } from '@/types'
import { track } from '@/core/metrics'
import { regionLabel } from '@/core/region'
import { useSettingsStore } from '@/stores/settings'
import { loadProvinces, provincesOf, type ProvinceData } from '@/core/provinces'

const { t, locale } = useI18n()
const router = useRouter()

/**
 * 图像识别（SpeciesNet）暂时下线（2026-10-17）
 *
 * 实测结论：这个 fp16 ONNX 导出的输出饱和在 99%+、排序基本不可信
 * （同一张渡鸦照片 → 灰噪钟鹊；角叫鸭 → 鸡鵟；拍什么都能排到啄木鸟）。
 * 已验证与以下因素无关：缩放算法、12 种预处理口径、5 种裁切比例、
 * 浏览器/Node 运行时（权重指纹一致）、权重文件本身。故判定为模型侧问题。
 *
 * 代码与产物全部保留（`identifyImage`、model-labels-image.json、overrides、门禁都在），
 * 换模型后把这里改回 true 即可恢复 —— 候选池 `IMAGE_TOP_K` 不宜超过 12（见 regionPrior 注释）。
 * 后续路线见 docs/059。
 */
const ENABLE_IMAGE = false

type Phase = 'idle' | 'capturing' | 'decoding' | 'loading-model' | 'thinking' | 'error'
const phase = ref<Phase>('idle')
const errMsg = ref('')

/** 两路结果并存，便于并排显示与互证 */
const runs = reactive<Record<Modality, Presented | null>>({ audio: null, image: null })
const metas = reactive<Record<Modality, { durationSec: number; windows: number } | null>>({
  audio: null,
  image: null,
})
const mediaById = ref<Record<string, { images?: MediaAsset[]; audios?: MediaAsset[] }>>({})

/* ── 素材展示（用户要求） ─────────────────────────────────────────────
 *  · 每个候选：**第一个素材大号显示**，其余小号；点小号 → 它变大、原来的变回常规大小
 *  · 图像点大号可看原图（灯箱用 xlUrl，另给「查看原图」指向 originalUrl）
 *  · 音频同理：第一个用播放器大号显示，点其余小号切换播放器
 */
const heroImg = reactive<Record<string, number>>({})
const heroAudio = reactive<Record<string, number>>({})
const origin = ref<MediaAsset | null>(null)
const heroIdx = (c: { speciesId: string | null }, kind: 'img' | 'audio') =>
  (kind === 'img' ? heroImg[c.speciesId!] : heroAudio[c.speciesId!]) ?? 0
const setHero = (c: { speciesId: string | null }, kind: 'img' | 'audio', i: number) => {
  if (!c.speciesId) return
  if (kind === 'img') heroImg[c.speciesId] = i
  else heroAudio[c.speciesId] = i
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
/** 当前启用的模态。图像侧下线期间只跑音频（见 ENABLE_IMAGE） */
const modalities = computed<Modality[]>(() => (ENABLE_IMAGE ? ['audio', 'image'] : ['audio']))
const dlPct = computed(() => (dl.total ? Math.round((dl.received / dl.total) * 100) : 0))

const firstModality = computed<Modality | null>(() => (runs.audio ? 'audio' : runs.image ? 'image' : null))
const firstResult = computed<CrossResult | null>(() =>
  firstModality.value ? topResult(firstModality.value, runs[firstModality.value]!.all) : null,
)
const secondResult = computed<CrossResult | null>(() => {
  const m = firstModality.value
  if (!m) return null
  const other: Modality = m === 'audio' ? 'image' : 'audio'
  return runs[other] ? topResult(other, runs[other]!.all) : null
})
/** 第一路识别出的种，项目里是否还有另一模态的素材可看 */
const hasOtherMedia = computed(() => {
  const r = firstResult.value
  if (!r?.speciesId) return false
  const m = mediaById.value[r.speciesId]
  if (!m) return false
  const other: Modality = r.modality === 'audio' ? 'image' : 'audio'
  const n = other === 'image' ? (m.images?.length ?? 0) : (m.audios?.length ?? 0)
  return n > 0
})
const verdict = computed(() => compare(firstResult.value, secondResult.value, hasOtherMedia.value))
/** 该提示用户用哪个模态复核 */
const suggest = computed<Modality | null>(() => verdict.value.suggest)
const suggestTask = computed(() => (suggest.value ? MODELS[suggest.value] : null))

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
  await ensureModel(MODELS[kind], (r, t) => {
    dl.received = r
    dl.total = t
  })
  modelState[kind].ready = true
  modelState[kind].bytes = dl.total
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

async function handleAudio(blob: Blob) {
  phase.value = 'decoding'
  errMsg.value = ''
  try {
    const samples = await decodeAudio(blob)
    if (samples.length < 12000) throw new Error('too-short')
    await ensureReady('audio')
    phase.value = 'thinking'
    track('birdid_infer', { modality: 'audio', seconds: Math.round(samples.length / 48000) })
    const r = await identifyAudio(blob, undefined, regionKey.value)
    runs.audio = r.view
    metas.audio = { durationSec: r.result.durationSec, windows: r.result.windows }
    phase.value = 'idle'
    await loadMedia(r.view.all)
  } catch (e) {
    phase.value = 'error'
    console.error('[birdId] audio identify failed:', e)
    const m = e instanceof Error ? e.message : String(e)
    errMsg.value = m === 'too-short' ? t('birdId.err.tooShort') : t('birdId.err.generic')
    track('birdid_error', { modality: 'audio', reason: m.slice(0, 40) })
  }
}

async function handleImage(blob: Blob) {
  phase.value = 'decoding'
  errMsg.value = ''
  try {
    await ensureReady('image')
    phase.value = 'thinking'
    track('birdid_infer', { modality: 'image' })
    const r = await identifyImage(blob, undefined, regionKey.value)
    runs.image = r.view
    metas.image = { durationSec: 0, windows: 1 }
    phase.value = 'idle'
    await loadMedia(r.view.all)
  } catch (e) {
    phase.value = 'error'
    console.error('[birdId] image identify failed:', e)
    errMsg.value = t('birdId.err.generic')
    track('birdid_error', { modality: 'image' })
  }
}

/** 一键切到另一模态：录音结束 → 直接开图片选择；图片识别完 → 直接开录音 */
function switchTo(kind: Modality) {
  if (kind === 'image') (document.getElementById('birdid-image-input') as HTMLInputElement)?.click()
  else startRecording()
}

function reset(kind?: Modality) {
  if (kind) runs[kind] = null
  else {
    runs.audio = null
    runs.image = null
  }
  metas.audio = null
  metas.image = null
  errMsg.value = ''
  phase.value = 'idle'
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

const fmtMB = (b: number) => (b / 1048576).toFixed(1)

/* ═══ 地域先验 ═══
 * 模型的概率饱和在 99%+，单靠分数排序等于按噪声排。真实的强约束是
 * 「你拍到的鸟大概率就在当地」—— Merlin 认得准主要就靠这个。
 * 这里让用户选地点，识别后按当地常见度档位重排候选（src/core/birdId/regionPrior.ts）。
 * 默认跟随全局设置里的地区，不额外打断用户；可临时改，不写回设置。
 */
const settings = useSettingsStore()
const regionCountry = ref(String(settings.region ?? 'ALL').split('-')[0] || 'ALL')
const regionCode = ref<string>(settings.region?.includes('-') ? settings.region : '')
const provinceData = ref<ProvinceData | null>(null)
const REGION_COUNTRIES = ['CN', 'US', 'CA', 'AU', 'NZ', 'GB', 'IE', 'JP', 'DE', 'FR', 'ES', 'IT', 'NL', 'IN', 'VN']

const regionKey = computed(() =>
  regionCountry.value === 'ALL' ? 'ALL' : regionCode.value ? `${regionCountry.value}-${regionCode.value.replace(`${regionCountry.value}-`, '')}` : regionCountry.value,
)
const provinceOptions = computed(() =>
  regionCountry.value === 'ALL' ? [] : provincesOf(provinceData.value, regionCountry.value, String(locale.value)),
)
const countryName = (cc: string) => (cc === 'ALL' ? t('birdId.region.all') : regionLabel(cc, t, String(locale.value)))

loadProvinces().then((d) => {
  provinceData.value = d
})

function onCountryChange() {
  regionCode.value = ''
}
</script>

<template>
  <div class="wrap">
    <h1><Bird :size="22" /> {{ t('birdId.title') }}</h1>

    <!-- 隐私说明保留一行：识别在本机、录音不上传（055 §5.3 的红线）。要更干净可直接删。 -->
    <p class="privacy">{{ t('birdId.privacyShort') }}</p>

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

    <!-- ═══ 跨模态互证：并排两路结果 ═══ -->
    <section v-if="runs.audio || runs.image" class="panel" :class="{ agree: verdict.agree }">
      <div class="row between">
        <h2>{{ t('birdId.crossTitle') }}</h2>
        <button class="btn ghost sm" @click="reset()"><Trash2 :size="15" /> {{ t('birdId.reset') }}</button>
      </div>

      <ol class="lanes">
        <li v-for="m in modalities" :key="m" class="lane" :class="{ empty: !runs[m] }">
          <div class="laneHead">
            <Mic v-if="m === 'audio'" :size="15" />
            <Camera v-else :size="15" />
            <span>{{ m === 'audio' ? t('birdId.mod.audio') : t('birdId.mod.image') }}</span>
            <button v-if="runs[m]" class="link sm" @click="reset(m)">{{ t('birdId.redo') }}</button>
          </div>

          <div v-if="!runs[m]" class="laneEmpty">
            <p>{{ m === 'audio' ? t('birdId.hint.audio') : t('birdId.hint.image') }}</p>
            <label v-if="m === 'image'" class="btn sm">
              {{ t('birdId.chooseImage') }}
              <input id="birdid-image-input" type="file" accept="image/*" hidden @change="onImageFile" />
            </label>
            <button v-else class="btn sm" :disabled="busy" @click="startRecording">
              <Mic :size="14" /> {{ t('birdId.record') }}
            </button>
          </div>

          <div v-else-if="!runs[m]!.shown.length" class="laneNone">
            {{ t('birdId.band.none') }}
          </div>

          <div v-else class="laneBody">
            <!-- 每个候选一块：一句「可能是 X」+ 该种现有的图/音 + 详情链接。
                 不写「模型不是 100% 准」这类反复解释——用户知道，说了反而像免责声明。 -->
            <div v-for="(c, i) in runs[m]!.shown" :key="c.label" class="cand" :class="{ top: i === 0 }">
              <div class="cName">{{ t('birdId.maybe.one', { name: c.entry?.z || c.label.split('_')[1] || c.label }) }}</div>
              <div class="cSci">{{ c.label }}</div>
              <p v-if="c.regionTier" class="cTier">{{ t(`birdId.region.tier.${c.regionTier}`) }}</p>
              <p v-if="c.entry?.t === 4" class="cNote">{{ t('birdId.genusOnly', { genus: c.entry.g }) }}</p>
              <!-- 只有名录明确说「没有素材」时才这么讲（p===false）；speciesId 缺失不再作为判据——
                   产物原来只从采集台账取 id，会把核心库的种误判成没素材（2026-10-17 白头鹎） -->
              <p v-else-if="c.entry && c.entry.p === false" class="cNote">{{ t('birdId.noMedia') }}</p>

              <template v-if="c.speciesId">
                <!-- 生境 / 习性：有就显示（当前仅 7 个核心种有人工文本） -->
                <div v-if="profileOf(c.speciesId).habitat || profileOf(c.speciesId).habit" class="facts">
                  <p v-if="profileOf(c.speciesId).habitat">
                    <span class="fKey">{{ t('birdId.factHabitat') }}</span>{{ profileOf(c.speciesId).habitat }}
                  </p>
                  <p v-if="profileOf(c.speciesId).habit">
                    <span class="fKey">{{ t('birdId.factHabit') }}</span>{{ profileOf(c.speciesId).habit }}
                  </p>
                </div>

                <div v-if="mediaLoading.has(c.speciesId)" class="spinWrap"><Loader2 :size="16" class="spin" /></div>
                <template v-else>
                  <!-- 大号素材：图片优先，没有图就大号播放器 -->
                  <div v-if="mediaById[c.speciesId]?.images?.length" class="hero">
                    <img
                      :src="mediaById[c.speciesId]!.images![heroIdx(c, 'img')]!.url"
                      :alt="c.entry?.z || c.label"
                      loading="lazy"
                      @click="origin = mediaById[c.speciesId]!.images![heroIdx(c, 'img')]!"
                    />
                    <AttributionLine :media="mediaById[c.speciesId]!.images![heroIdx(c, 'img')]!" />
                  </div>
                  <div v-else-if="mediaById[c.speciesId]?.audios?.length" class="heroAudio">
                    <audio
                      crossorigin="anonymous"
                      :src="mediaById[c.speciesId]!.audios![heroIdx(c, 'audio')]!.url"
                      controls
                      preload="none"
                    />
                    <AttributionLine :media="mediaById[c.speciesId]!.audios![heroIdx(c, 'audio')]!" />
                  </div>

                  <!-- 小号：点一下它变大，原来的变回常规大小 -->
                  <div v-if="(mediaById[c.speciesId]?.images?.length ?? 0) > 1" class="thumbs">
                    <button
                      v-for="(im, k) in mediaById[c.speciesId]!.images!"
                      :key="im.url"
                      type="button"
                      class="thumb"
                      :class="{ on: k === heroIdx(c, 'img') }"
                      :aria-pressed="k === heroIdx(c, 'img')"
                      @click="setHero(c, 'img', k)"
                    >
                      <img :src="im.thumbUrl || im.url" alt="" loading="lazy" />
                    </button>
                  </div>
                  <div v-if="(mediaById[c.speciesId]?.audios?.length ?? 0) > 1" class="audio">
                    <button
                      v-for="(au, k) in mediaById[c.speciesId]!.audios!"
                      :key="au.url"
                      type="button"
                      class="play"
                      :class="{ on: k === heroIdx(c, 'audio') }"
                      :aria-label="t('birdId.playOne')"
                      @click="setHero(c, 'audio', k)"
                    >
                      <Play :size="14" /> {{ k + 1 }}
                    </button>
                  </div>

                  <button class="link" @click="router.push(`/species/${c.speciesId}`)">
                    {{ t('birdId.viewSpecies') }}
                  </button>
                </template>
              </template>
            </div>
          </div>
        </li>
      </ol>

      <!-- 互证结论 + 主动引导 -->
      <div v-if="verdict.textKey" class="verdict" :class="verdict.agree ? 'ok' : 'warnBox'">
        {{ verdict.agree ? '✓ ' : '' }}{{ t(verdict.textKey) }}
      </div>
      <button
        v-if="ENABLE_IMAGE && suggest && suggestTask"
        class="cta"
        :disabled="busy"
        @click="switchTo(suggest)"
      >
        <Camera v-if="suggest === 'image'" :size="16" />
        <Mic v-else :size="16" />
        {{ suggest === 'image' ? t('birdId.cross.goImage') : t('birdId.cross.goAudio') }}
      </button>
    </section>

    <!-- ═══ 首次使用 ═══ -->
    <section v-else class="panel">
      <div class="twoUp">
        <div class="col">
          <h3><Mic :size="17" /> {{ t('birdId.mod.audio') }}</h3>
          <p v-if="!runs.audio" class="hint">{{ t('birdId.hint.audio') }}</p>
          <div class="row">
            <button class="btn primary" :disabled="busy" @click="startRecording">
              <Mic :size="16" /> {{ t('birdId.record') }}
            </button>
            <label class="btn">{{ t('birdId.upload') }}<input type="file" accept="audio/*" hidden @change="onAudioFile" /></label>
          </div>
        </div>
        <!-- 图像侧已下线（ENABLE_IMAGE）；恢复时无需改结构 -->
        <div v-if="ENABLE_IMAGE" class="col">
          <h3><Camera :size="17" /> {{ t('birdId.mod.image') }}</h3>
          <label class="btn">
            {{ t('birdId.chooseImage') }}<input type="file" accept="image/*" hidden @change="onImageFile" />
          </label>
        </div>
      </div>
    </section>

    <!-- ═══ 运行中 / 报错 ═══ -->
    <section class="panel">
      <div v-if="phase === 'capturing'" class="status">
        <button class="btn danger" @click="stopRecording">
          <Square :size="16" /> {{ t('birdId.stop') }} {{ elapsed.toFixed(1) }}s
        </button>
      </div>
      <div v-if="phase === 'loading-model'" class="status">
        <Loader2 :size="16" class="spin" />
        <span>{{ t('birdId.model.downloading', { pct: dlPct }) }}</span>
        <div class="bar"><i :style="{ width: dlPct + '%' }" /></div>
      </div>
      <div v-if="phase === 'thinking'" class="status">
        <Loader2 :size="16" class="spin" /> {{ t('birdId.thinking') }}
      </div>
      <p v-if="phase === 'error'" class="err">✗ {{ errMsg }}</p>

      <div class="modelRow">
        <template v-for="m in modalities" :key="m">
          <span v-if="modelState[m].ready" class="ok">✓</span>
          <TriangleAlert v-else :size="14" />
          <span class="modelTxt">{{
            modelState[m].ready
              ? t('birdId.model.ready', { mb: fmtMB(modelState[m].bytes) })
              : t('birdId.model.need', { mb: fmtMB(modelState[m].bytes || MODELS[m].sizeMB * 1024 * 1024) })
          }}</span>
          <button v-if="modelState[m].ready" class="link sm" @click="dropModel(m)">{{ t('birdId.model.drop') }}</button>
        </template>
      </div>
    </section>
  </div>

  <!-- 看原图：大号图点开。xlUrl = 母版原分辨率；originalUrl = 源站原始文件 -->
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
  max-width: 760px;
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
  font-size: 15px;
  margin: 0 0 6px;
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
.privacy {
  font-size: 12px;
  color: var(--muted, #6b7280);
  margin: 0 0 12px;
}
.panel {
  background: var(--surface-1, #fff);
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
}
.hero img {
  width: 100%;
  max-height: 340px;
  object-fit: cover;
  border-radius: 10px;
  cursor: zoom-in;
  display: block;
}
.heroAudio audio {
  width: 100%;
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
.thumb {
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  background: none;
  cursor: pointer;
  line-height: 0;
}
.thumb.on {
  border-color: var(--primary, #2563eb);
}
.panel.agree {
  border-color: #16a34a;
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
.regionPick .pHint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted, #6b7280);
  margin: 10px 0 0;
}
.cTier {
  display: inline-block;
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-2, #f3f4f6);
  color: var(--muted, #6b7280);
}
.twoUp {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
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
.btn.sm {
  padding: 5px 10px;
  font-size: 13px;
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
  margin: 6px 0 10px;
  line-height: 1.6;
}
.lanes {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.lane {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 8px;
  padding: 10px;
}
.lane.empty {
  border-style: dashed;
  background: var(--surface-2, #f9fafb);
}
.laneHead {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.laneHead .link {
  margin-left: auto;
}
.laneEmpty p {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  margin: 0 0 8px;
  line-height: 1.6;
}
.laneNone {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  line-height: 1.7;
}
.cand {
  padding: 6px 0;
  border-bottom: 1px solid var(--line, #f0f1f3);
}
.cand:last-child {
  border-bottom: none;
}
.cHead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.cLabel {
  font-size: 11px;
  color: var(--text-3, #6b7280);
}
.maybeNote {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  line-height: 1.7;
  margin: 8px 0 0;
}
.rank {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface-2, #f3f4f6);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
}
.cName {
  font-size: 14px;
  font-weight: 600;
}
.cSci {
  font-size: 11px;
  color: var(--text-3, #6b7280);
  margin-top: 1px;
}
.cNote {
  font-size: 12px;
  color: var(--text-3, #6b7280);
  margin: 4px 0 0;
}
.media {
  margin-top: 8px;
}
.thumbs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.thumbs img {
  width: 68px;
  height: 51px;
  object-fit: cover;
  border-radius: 6px;
}
.audio {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.play {
  width: 30px;
  height: 30px;
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
.verdict {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
}
.verdict.ok {
  background: #f0fdf4;
  color: #166534;
}
.verdict.warnBox {
  background: #fffbeb;
  color: #92400e;
}
.cta {
  margin-top: 10px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  border: none;
  background: var(--accent, #2563eb);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.cta:disabled {
  opacity: 0.5;
}
.status {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 14px;
  margin-bottom: 10px;
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
  margin: 0 0 10px;
}
.modelRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--text-3, #6b7280);
  padding-top: 8px;
  border-top: 1px solid var(--line, #e5e7eb);
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
