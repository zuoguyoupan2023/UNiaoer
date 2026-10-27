<script setup lang="ts">
/**
 * L8 记忆挑战鸟答题区（docs/092）——**纯答题组件**，与 QuizPlayName/QuizPlayInput 同构：
 * QuizPlay 在 `quiz.tier === 8` 时挂载；介绍页与开轮（quiz.start → buildMemoryQuestions）都在 QuizPlay。
 *
 * 玩法（2026-10-27 用户定稿）：12 对「图/音 ↔ 鸟名」合区 4×6 打乱（窄屏 3×8，对数不变）；
 * 点开两张牌，同物种即配上、永久翻开，配不上盖回（位置不变）。
 *
 * 计分（docs/092 §4）：**纯正计时**——从第一张翻开设表，到最后一对配对成功停表；
 * 三档评语 memoryRatingFor（大盘 60/90s、小盘 30/60s，图音同一套）。不设错题、不记翻牌次数、
 * 不参与称号与徽章。中途退出**不落库、不给评语**（直接回家，不经结果页）。
 *
 * 音频（docs/092 §5）：翻开音牌即尝试 play()——首次翻牌的手势即解锁来源；
 * 被浏览器策略拦截时牌面原地显示播放按钮（NotAllowedError → 兜底，绝不"翻了没反应"）；
 * 配错盖回不播放并暂停；配对成功把音牌**再播一次**强化联结。
 * <audio> 的 crossorigin 静态属性先于 :src（docs/033 铁律，Safari 只读设置 src 那一刻的值）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { AudioLines, Image as ImageIcon, LogOut, Play, Timer, VolumeX } from 'lucide-vue-next'
import { useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { ambiencePlayer } from '@/core/ambience'
import { TIERS } from '@/core/difficulty'
import { formatMemoryTime, memoryRatingFor } from '@/core/memoryRating'
import { preferredImageUrl } from '@/core/mediaLoader'
import type { MediaAsset, MediaType, NameMode } from '@/types'

const props = defineProps<{ type: MediaType }>()
const router = useRouter()
const quiz = useQuizStore()
const settings = useSettingsStore()
const { t } = useI18n()

// ---- 盘面：quiz.questions 的每题 = 一对 → 媒体牌 + 名字牌，合区洗牌 ----
interface MemoryCard {
  idx: number
  /** 所属对（quiz.questions 的下标）；配对判定 = 两张牌 pair 相同 */
  pair: number
  kind: 'media' | 'name'
  speciesId: string
  /** 名字牌文案（引擎按卷别权威 nameByMode 给出，scss 卷为拉丁名） */
  name: string
  sci: string
  nameMode?: NameMode
  /** 媒体牌素材（首选；看图版=图，听音版=音） */
  media: MediaAsset
}

const cards = ref<MemoryCard[]>([])

/**
 * 盘面档（2026-10-27 用户加）：按**实际建出的对数**判定（6 对 = 缩小盘 3×4，
 * 其余 = 标准盘：桌面 6 列×4 行 / 手机 4 列×6 行）。布局跟着对数走，绝不跟设置走——
 * 设置只在开轮时决定 buildMemoryPairs 的 pairs。
 */
const isCompact = computed(() => quiz.questions.length > 0 && quiz.questions.length <= 6)

function buildBoard() {
  const out: MemoryCard[] = []
  quiz.questions.forEach((q, i) => {
    out.push({
      idx: out.length,
      pair: i,
      kind: 'media',
      speciesId: q.media.speciesId || q.media.url,
      name: q.answer,
      sci: q.sci,
      nameMode: q.nameMode,
      media: q.media,
    })
    out.push({
      idx: out.length,
      pair: i,
      kind: 'name',
      speciesId: q.media.speciesId || q.media.url,
      name: q.answer,
      sci: q.sci,
      nameMode: q.nameMode,
      media: q.media,
    })
  })
  // 合区洗牌（docs/092 §3：不做左图右名分区——分区会把记忆题退化成连线题）
  cards.value = out
    .map((c) => ({ c, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ c }) => c)
    .map((c, i) => ({ ...c, idx: i }))
}

// 图片牌预取：全部 12 张（320px 缩略图优先）在开局面就绪，翻开零等待
const cardImageSrc = computed(() => new Map(cards.value.map((c) => [c.idx, c.media.thumbUrl || c.media.url])))
function preloadImages() {
  for (const c of cards.value) {
    if (props.type !== 'image' || c.kind !== 'media') continue
    const url = c.media.thumbUrl || c.media.url
    const img = new Image()
    img.src = url
    // AVIF 支持时换优选地址（与 MediaCard 同链路；仅缓存预热，失败无害）
    void preferredImageUrl(c.media).then((u) => {
      if (u !== url) new Image().src = u
    })
  }
}

// ---- 翻牌状态机 ----
const faceUp = ref<boolean[]>([])
const matchedPairs = ref<Set<number>>(new Set())
const firstIdx = ref<number | null>(null)
const lock = ref(false)
/**
 * 配错冷却（2026-10-27 用户定）：看图 2s / 听音 5s 再盖回（原来是 800ms 马上盖）。
 * 听音给 5s 是留出"对着两张牌回想/比较"的时间，且倒计时可见（4.9s → 4.8s …）；
 * 看图不显示倒计时（安静地多看 2 秒）。
 */
const MISMATCH_MS: Record<MediaType, number> = { image: 2000, audio: 5000 }
/** 冷却中的两张牌（盖回前 cdIdx 含它们的下标）；remain 只在听音模式更新（秒，1 位小数） */
const cdIdx = ref<[number, number] | null>(null)
const cdRemain = ref<number | null>(null)
let cooldownTimer: number | undefined
let cooldownTicker: number | undefined

function clearCooldownTimers() {
  if (cooldownTimer !== undefined) {
    clearTimeout(cooldownTimer)
    cooldownTimer = undefined
  }
  if (cooldownTicker !== undefined) {
    clearInterval(cooldownTicker)
    cooldownTicker = undefined
  }
}

function isSettled(card: MemoryCard): boolean {
  return matchedPairs.value.has(card.pair)
}

function flip(card: MemoryCard) {
  // 已翻开（含冷却中配错的两张）与已配对的牌：点击无反应
  if (finished.value || faceUp.value[card.idx] || isSettled(card)) return
  // 冷却期点隐藏的牌 = 提前继续：配错两张立即盖回（停播），所点的牌翻开当新的第一张
  if (lock.value) endCooldown()
  openAndCompare(card)
}

/** 翻开一张牌并进入配对比较：第一张 → 记住；第二张 → 判定配对/配错 */
function openAndCompare(card: MemoryCard) {
  startTimer() // 计时从第一张翻开起（docs/092 §4；已开表则空操作）
  faceUp.value[card.idx] = true
  if (props.type === 'audio' && card.kind === 'media' && settings.autoplayAudio) attemptPlay(card)

  if (firstIdx.value === null) {
    firstIdx.value = card.idx
    return
  }
  const a = cards.value[firstIdx.value]!
  const b = card
  firstIdx.value = null
  if (a.pair === b.pair) {
    // 配对成功：永久翻开；音版把 A 牌再播一次（强化联结，不受策略限制）
    matchedPairs.value = new Set(matchedPairs.value).add(a.pair)
    if (props.type === 'audio') {
      window.setTimeout(() => replayOf(a), 350)
    }
    if (matchedPairs.value.size >= quiz.questions.length) finish()
  } else {
    // 配错：冷却期（图 2s / 音 5s + 可见倒计时）后盖回；期间点隐藏牌可提前继续
    lock.value = true
    cdIdx.value = [a.idx, b.idx]
    const ms = MISMATCH_MS[props.type]
    const deadline = Date.now() + ms
    if (props.type === 'audio') {
      cdRemain.value = ms / 1000
      cooldownTicker = window.setInterval(() => {
        const left = Math.max(0, (deadline - Date.now()) / 1000)
        cdRemain.value = left
      }, 100)
    }
    cooldownTimer = window.setTimeout(endCooldown, ms)
  }
}

/** 立即盖回冷却中的两张配错牌（自然到点或用户提前继续），停播、解锁 */
function endCooldown() {
  clearCooldownTimers()
  const cd = cdIdx.value
  if (cd) {
    const a = cards.value[cd[0]!]
    const b = cards.value[cd[1]!]
    if (a) {
      faceUp.value[a.idx] = false
      pauseCard(a) // 盖回即停播：不许上一张的声音拖进下一次翻牌
    }
    if (b) {
      faceUp.value[b.idx] = false
      pauseCard(b)
    }
  }
  cdIdx.value = null
  cdRemain.value = null
  lock.value = false
}

// ---- 音频：每张音牌独立 <audio>（同牌常驻，preload 预热），共享"首次手势已解锁"状态 ----
const audioEls = ref<Map<number, HTMLAudioElement>>(new Map())
const blockedIdx = ref<number | null>(null)

function setAudioRef(idx: number, el: unknown) {
  if (el instanceof HTMLAudioElement) audioEls.value.set(idx, el)
  else audioEls.value.delete(idx)
}

function audioOf(card: MemoryCard): HTMLAudioElement | null {
  // 音牌的 audio 元素挂在媒体牌上
  const mediaCard = cards.value.find((c) => c.pair === card.pair && c.kind === 'media')
  return mediaCard ? (audioEls.value.get(mediaCard.idx) ?? null) : null
}

/** 停掉**其它**所有正在播的音（一次只响一个）：翻新牌/重听前调用，防止两种鸟鸣混在一起 */
function pauseOthers(pair: number) {
  for (const [idx, el] of audioEls.value) {
    const c = cards.value[idx]
    if (c && c.pair !== pair && !el.paused) el.pause()
  }
}

/** 翻开即播；被策略拦截（NotAllowedError 等）→ 牌面显示播放按钮兜底 */
function attemptPlay(card: MemoryCard) {
  const el = audioOf(card)
  if (!el) return
  pauseOthers(card.pair)
  el.currentTime = 0
  el.play().catch(() => {
    blockedIdx.value = card.pair
  })
}

/** 配对成功的再播一次（已解锁，失败静默） */
function replayOf(card: MemoryCard) {
  const el = audioOf(card)
  if (!el) return
  pauseOthers(card.pair)
  el.currentTime = 0
  el.play().catch(() => {})
}

function pauseCard(card: MemoryCard) {
  audioOf(card)?.pause()
}

/** 拦截兜底的播放按钮；autoplayAudio 关闭时每张音牌都显示（与其他听音题一致，docs/092 §5.4） */
function needsManualPlay(pair: number): boolean {
  if (props.type !== 'audio') return false
  if (settings.autoplayAudio && blockedIdx.value !== pair) return false
  const card = cards.value.find((c) => c.pair === pair && c.kind === 'media')
  return !!card && !!faceUp.value[card.idx] && !isSettled(card)
}

function manualPlay(pair: number) {
  blockedIdx.value = null
  const card = cards.value.find((c) => c.pair === pair && c.kind === 'media')
  if (card) attemptPlay(card)
}

// ---- 正计时：第一张翻开 → 最后一对配对成功（docs/092 §4.1） ----
const elapsedMs = ref(0)
let firstFlipAt = 0
let tick: number | undefined

function startTimer() {
  if (firstFlipAt) return
  firstFlipAt = Date.now()
  tick = window.setInterval(() => {
    elapsedMs.value = Date.now() - firstFlipAt
  }, 100)
}

function stopTimer() {
  if (tick !== undefined) {
    clearInterval(tick)
    tick = undefined
  }
  if (firstFlipAt) elapsedMs.value = Date.now() - firstFlipAt
}

const timeLabel = computed(() => formatMemoryTime(elapsedMs.value))

// ---- 完成：写 store 汇总 → 短暂停留看到全配平 → 结果页（落库/评语都在结果页做） ----
const finished = ref(false)

function finish() {
  if (finished.value) return
  finished.value = true
  stopTimer()
  const pairs = quiz.questions.length
  quiz.memoryResult = {
    pairs,
    matched: matchedPairs.value.size,
    rating: memoryRatingFor(elapsedMs.value, pairs),
    durationMs: elapsedMs.value,
  }
  window.setTimeout(() => router.push('/result'), 1400)
}

// ---- 中途退出：不落库、不给评语（docs/092 §4.6），直接回家 ----
function quitRound() {
  if (!window.confirm(t('memory.quitConfirm'))) return
  stopTimer()
  quiz.reset()
  router.push('/')
}

// ---- 对数不足时明确说明（与 072-a 同则：允许不足但绝不静默） ----
const shortRoundNote = computed(() => {
  const d = quiz.lastBuild
  if (!d || d.built >= d.want) return ''
  return t('memory.shortRound', { built: d.built, want: d.want })
})

// ---- 署名：12 对素材的合并署名行（许可义务不因玩法改变，铁律 5） ----
const attributions = computed(() => {
  const seen = new Set<string>()
  const list: { source: string; author: string; license: string; href: string }[] = []
  for (const q of quiz.questions) {
    const m = q.media
    const key = `${m.source}|${m.author}|${m.license}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({
      source: m.source,
      author: m.author,
      license: m.license,
      href: m.licenseUrl || m.sourceUrl || '',
    })
  }
  return list
})

onMounted(() => {
  // 「再来一轮」续轮（ResultView → nextRound 重建配对后回到本页）
  if (quiz.pendingContinue) {
    quiz.pendingContinue = false
  }
  ambiencePlayer.stop() // 进入答题停全局环境鸟鸣（现有规则，docs/092 §5.2.4）
  buildBoard()
  faceUp.value = cards.value.map(() => false)
  preloadImages()
})

onUnmounted(() => {
  stopTimer()
  clearCooldownTimers()
  for (const el of audioEls.value.values()) el.pause()
})

// 防御：题目被重建（续轮）但组件未重挂 → 重建盘面
watch(
  () => quiz.roundId,
  () => {
    finished.value = false
    firstFlipAt = 0
    elapsedMs.value = 0
    firstIdx.value = null
    lock.value = false
    blockedIdx.value = null
    matchedPairs.value = new Set()
    buildBoard()
    faceUp.value = cards.value.map(() => false)
    preloadImages()
  },
)
</script>

<template>
  <template v-if="cards.length">
    <!-- 状态行：左=档位 · 中=配对进度 · 右=正计时（与其它档位同一套三栏） -->
    <div class="status-bar">
      <span class="sb-left">
        <span class="tier-tag">{{ t(TIERS[quiz.tier].labelKey) }}</span>
      </span>
      <span class="sb-mid">{{ t('memory.pairsProgress', { n: matchedPairs.size, total: quiz.questions.length }) }}</span>
      <span class="sb-right">
        <span class="timer" :class="{ idle: !firstFlipAt }">
          <Timer class="ic" :size="14" /> {{ timeLabel }}
        </span>
      </span>
    </div>

    <p v-if="shortRoundNote" class="short-round-note" role="status">{{ shortRoundNote }}</p>

    <div class="card board-card">
      <button class="quit-corner" type="button" @click="quitRound">
        <LogOut class="ic" :size="13" /> {{ t('quiz.quit') }}
      </button>

      <p class="board-hint muted">{{ t(type === 'audio' ? 'memory.hintAudio' : 'memory.hint') }}</p>

      <div class="memory-board" :class="isCompact ? 'compact' : 'std'" role="group" :aria-label="t('memory.boardLabel')">
        <button
          v-for="c in cards"
          :key="c.idx"
          type="button"
          class="mcard"
          :class="{
            up: faceUp[c.idx] || isSettled(c),
            matched: isSettled(c),
            audio: c.kind === 'media' && type === 'audio',
          }"
          :aria-label="faceUp[c.idx] || isSettled(c) ? t('memory.cardOpen') : t('memory.cardClosed')"
          @click="flip(c)"
        >
          <span class="mcard-inner">
            <!-- 背面（盖着） -->
            <span class="face back" aria-hidden="true">
              <ImageIcon v-if="type === 'image'" class="back-ic" :size="18" />
              <AudioLines v-else class="back-ic" :size="18" />
            </span>
            <!-- 正面（翻开）：媒体牌 / 名字牌 -->
            <span class="face front">
              <template v-if="c.kind === 'media'">
                <img
                  v-if="type === 'image'"
                  :src="cardImageSrc.get(c.idx)"
                  :alt="t('media.birdAlt')"
                  decoding="async"
                  loading="eager"
                  draggable="false"
                />
                <template v-else>
                  <AudioLines class="audio-ic" :size="22" />
                  <span class="audio-cap muted small">{{ t('memory.audioCard') }}</span>
                  <!-- 拦截兜底：翻了没声（或自动播放已关）→ 原地给播放按钮（docs/092 §5.3/§5.4） -->
                  <span
                    v-if="needsManualPlay(c.pair)"
                    class="play-blocked"
                    role="status"
                  >
                    <VolumeX class="ic" :size="13" /> {{ t('media.autoplayBlocked') }}
                    <button
                      type="button"
                      class="play-btn"
                      :aria-label="t('memory.playCard')"
                      @click.stop="manualPlay(c.pair)"
                    >
                      <Play class="ic" :size="14" />
                    </button>
                  </span>
                </template>
              </template>
              <template v-else>
                <span class="name" :class="{ sci: c.nameMode === 'sci' }">{{ c.name }}</span>
              </template>
            </span>
          </span>
          <!-- 听音版配错冷却：可见倒计时（4.9s → 4.8s …），到点盖回（看图版静默等 2s，不显示） -->
          <span
            v-if="cdIdx && cdRemain !== null && (cdIdx[0] === c.idx || cdIdx[1] === c.idx)"
            class="cd-badge"
            aria-hidden="true"
          >{{ cdRemain.toFixed(1) }}s</span>
          <!-- 音牌常驻元素：preload 预热 + 翻开即播；crossorigin 先于 src（铁律 5 / docs/033） -->
          <audio
            v-if="c.kind === 'media' && type === 'audio'"
            :ref="(el) => setAudioRef(c.idx, el)"
            crossorigin="anonymous"
            :src="c.media.url"
            preload="auto"
          ></audio>
        </button>
      </div>

      <!-- 全配平过渡提示（1.4s 后进结果页） -->
      <Transition name="fade">
        <p v-if="finished" class="complete-banner" role="status">{{ t('memory.complete') }}</p>
      </Transition>

      <!-- 署名：全部配对素材的合并署名行（许可义务不因题型打折） -->
      <div v-if="attributions.length" class="option-attr">
        <template v-for="(a, i) in attributions" :key="i">
          <template v-if="i > 0"> · </template>
          <a v-if="a.href" :href="a.href" target="_blank" rel="noopener noreferrer"
            >{{ a.source }} · {{ a.author }} ({{ a.license }})</a
          >
          <span v-else>{{ a.source }} · {{ a.author }} ({{ a.license }})</span>
        </template>
      </div>
    </div>
  </template>
</template>

<style scoped>
.status-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.78rem;
}
.sb-left {
  justify-self: start;
}
.sb-mid {
  font-weight: 700;
  color: var(--text);
}
.sb-right {
  justify-self: end;
  font-weight: 700;
  color: var(--text);
}
.tier-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
}
.timer {
  font-variant-numeric: tabular-nums;
  background: #eaf4ef;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* 未开表时弱化：计时从第一张翻开才开始（docs/092 §4.1） */
.timer.idle {
  color: var(--text-light);
  background: #f0f4f2;
}
.timer .ic {
  flex-shrink: 0;
}
.short-round-note {
  font-size: 0.75rem;
  color: #8a6d00;
  background: #fdf3d8;
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  margin: 0 0 8px;
}
.board-card {
  position: relative;
}
.board-hint {
  text-align: center;
  font-size: 0.76rem;
  margin: 0 0 10px;
}
.quit-corner {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.88);
  color: var(--text-light);
  font-size: 0.72rem;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: all 0.18s ease;
  z-index: 2;
}
.quit-corner:hover {
  color: var(--wrong);
  border-color: var(--wrong);
  background: #fff;
}

/* ---- 盘面（2026-10-27 用户定）：
     标准盘 = 桌面 6 列×4 行 / 手机（≤700px）4 列×6 行；
     缩小盘（实验）= 3 列×4 行。目标：整个盘面一屏放得下，卡片宁小勿大。 ---- */
.memory-board {
  display: grid;
  gap: 6px;
  margin: 0 auto;
}
.memory-board.std {
  grid-template-columns: repeat(6, 1fr);
  max-width: 680px;
}
.memory-board.compact {
  grid-template-columns: repeat(3, 1fr);
  max-width: 380px;
}
@media (max-width: 640px) {
  .memory-board.std {
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
  }
}
.mcard {
  position: relative;
  /* 手机上标准盘 6 行偏高，用略扁的牌（6:5）把整盘压进一屏；桌面/缩小盘保持方形 */
  aspect-ratio: 1 / 1;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  perspective: 600px;
  -webkit-tap-highlight-color: transparent;
}
@media (max-width: 640px) {
  .memory-board.std .mcard {
    aspect-ratio: 6 / 5;
  }
}
.mcard-inner {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transition: transform 0.3s ease;
}
.mcard.up .mcard-inner {
  transform: rotateY(180deg);
}
.mcard.matched {
  cursor: default;
}
/* 听音版配错冷却倒计时（两张配错的牌各挂一枚，到点随盖回一起消失） */
.cd-badge {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(18, 38, 29, 0.78);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* 背面（盖着）：素色 + 图标 */
.face.back {
  background: linear-gradient(135deg, #2f6d52, #1d4a36);
  color: rgba(255, 255, 255, 0.5);
  border: 1px solid #1d4a36;
}
.mcard:not(.up):not(.matched):hover .face.back {
  filter: brightness(1.15);
}
.back-ic {
  opacity: 0.55;
}
/* 正面（翻开） */
.face.front {
  transform: rotateY(180deg);
  background: #fff;
  border: 2px solid var(--border);
  padding: 3px;
}
.mcard.matched .face.front {
  border-color: var(--correct, #2f8f5b);
  box-shadow: 0 0 0 1px var(--correct, #2f8f5b) inset;
  opacity: 0.92;
}
.face.front img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: calc(var(--radius-sm) - 2px);
  user-select: none;
}
/* 音牌正面：声波图标 + 兜底播放 */
.face.front.audio {
  gap: 4px;
}
.audio-ic {
  color: var(--primary);
}
.audio-cap {
  font-size: 0.62rem;
}
.play-blocked {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 0.6rem;
  color: #8a6d00;
  text-align: center;
  line-height: 1.3;
  padding: 0 2px;
}
.play-blocked .ic {
  flex-shrink: 0;
}
.play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--primary);
  background: var(--primary);
  color: #fff;
  cursor: pointer;
}
/* 名字牌正面 */
.name {
  font-size: clamp(0.6rem, 1.9vw, 0.85rem);
  font-weight: 700;
  color: var(--text);
  line-height: 1.25;
  text-align: center;
  overflow-wrap: anywhere;
  padding: 1px;
}
.name.sci {
  font-style: italic;
  font-weight: 600;
}
.complete-banner {
  text-align: center;
  font-weight: 800;
  color: var(--primary);
  margin: 12px 0 0;
  animation: pop 0.3s ease;
}
.fade-enter-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from {
  opacity: 0;
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
@media (prefers-reduced-motion: reduce) {
  .mcard-inner {
    transition: none;
  }
  .complete-banner {
    animation: none;
  }
}
.option-attr {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  font-size: 0.68rem;
  color: var(--text-light);
  line-height: 1.7;
  text-align: center;
  word-break: break-word;
}
.option-attr a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
}
.option-attr a:hover {
  color: var(--primary);
}
</style>
