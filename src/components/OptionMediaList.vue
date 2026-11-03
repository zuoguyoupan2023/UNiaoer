<script setup lang="ts">
/**
 * 选项列表（题干是名字，**选项是图/音**）：L6 半鸟人（docs/081 §7）+ S1 看名选图（docs/099 §3.2）。
 *  - 看图版：点击/敲字母作答；
 *  - 听音版：点按播放该选项录音，**再点同一项**才作答（先听后答，R24 的 L6 版）；
 *    播放中点其它项则切换播放。共享一个 Audio 元素，crossorigin 先于 src 设置
 *    （铁律：跨域媒体必须走 CORS 模式，Safari 只读设置 src 那一刻的值，docs/033）。
 * 判分/反馈状态与 OptionList 同语义：correct / wrong / dim。
 *
 * ---- 触摸交互（2026-11-03 用户定，解决「滚动 vs 选中」冲突）----
 * 图片选项在手机上占屏幕主体，手指一滑就误选是硬伤。改为**三区分离**：
 *   1. 图片本体：**不响应作答**。单击 = 看大图；按住上下拖 = 交给浏览器滚动（不 preventDefault）。
 *   2. 右上角白色勾选框：**唯一作答入口**（点击即选中并提交）。点击区域 ≥44px（iOS HIG）。
 *   3. 键盘：1–4 / A–D 仍可作答（桌面效率不降）。
 * 这样「滚动」与「选中」在物理上就不冲突，不依赖手势阈值猜测（原 SWIPE_MAX_DY 那种猜测
 * 在惯性滚动/大图上必然误判）。
 * **桌面与 iPad 一致**：同一套交互，不按 UA 分叉——避免「换个设备就忘了怎么答题」。
 *
 * 选项布局：桌面 2 列（2×2），手机 1 列（避免两列把图压太小）——用户 2026-11-03 定。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Play, X, ZoomIn } from 'lucide-vue-next'
import type { MediaAsset, MediaType } from '@/types'

const props = defineProps<{
  options: string[]
  optionsMedia: MediaAsset[]
  answer: string
  chosen: string | null
  type: MediaType
  /**
   * 首次提示的标识（2026-11-03）：按模式传不同的值（如 `l6` / `s1-name`），
   * 该模式第一次做题时在方框左侧弹一次「点击选择」，之后永不再弹。
   * 不传 = 不显示提示（留给未来不想要提示的调用方）。
   */
  hintKey?: string
}>()

const emit = defineEmits<{ select: [value: string]; 'media-settled': [ok: boolean] }>()

const { t } = useI18n()

const letters = ['A', 'B', 'C', 'D', 'E', 'F']

function state(opt: string): string {
  if (!props.chosen) return ''
  if (opt === props.answer) return 'correct'
  if (opt === props.chosen) return 'wrong'
  return 'dim'
}

// ---- 首次提示（2026-11-03 用户定）----
//
// 「点击选择」的小 toast 只在**每个模式的第一次做题**时显示一次，之后永不再显示：
// - 两个模式各自独立记标记：L6 识图 与 S1 看名选图（两者共用本组件，靠 `hintKey` 区分）；
// - 出现约 2.4s 后自动消失；**用户一旦作答也立刻消失**（不需要等计时）；
// - 标记存 localStorage（跨会话、跨刷新），符合「一次性」的要求；
// - 轻微放大缩小的呼吸动画（`hintPulse`），不做弹跳以免干扰读图。
const HINT_MS = 2400
/** 首次提示的存储键（调用方按模式传入，缺省不显示——避免误给未来新用途弹提示） */
const hintKey = computed(() => (props.hintKey ? `uniaoer-hint-shown:${props.hintKey}` : ''))
const showFirstHint = ref(false)
let hintTimer: ReturnType<typeof setTimeout> | null = null

function hideHint() {
  showFirstHint.value = false
  if (hintTimer) {
    clearTimeout(hintTimer)
    hintTimer = null
  }
}

onMounted(() => {
  const key = hintKey.value
  if (!key || props.type !== 'image') return
  try {
    if (localStorage.getItem(key)) return // 已经提示过 → 永不重复
    localStorage.setItem(key, '1')
  } catch {
    return // 隐私模式：不提示（宁可不提示，也不每次重复打扰）
  }
  showFirstHint.value = true
  hintTimer = setTimeout(hideHint, HINT_MS)
})

// 一旦作答，提示立刻收掉（不留到过期，避免遮挡对错标记）
watch(
  () => props.chosen,
  (v) => {
    if (v) hideHint()
  },
)

onUnmounted(hideHint)

/** 大图查看（图片选项单击触发；与 SpeciesGallery 的 lightbox 同形） */
const zoom = ref<{ url: string; alt: string } | null>(null)
function openZoom(i: number) {
  const m = props.optionsMedia[i]
  if (!m) return
  zoom.value = { url: m.xlUrl || m.url, alt: props.options[i] ?? '' }
}
function closeZoom() {
  zoom.value = null
}

// ---- 听音版：共享 Audio 元素（点按播放 / 再点作答） ----
const playingUrl = ref<string | null>(null)
let audio: HTMLAudioElement | null = null

onMounted(() => {
  audio = new Audio()
  // crossorigin 必须在 src 之前（docs/033：Safari 只读设置 src 前的值）
  audio.crossOrigin = 'anonymous'
  audio.preload = 'none'
})

onUnmounted(() => {
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio = null
  }
  playingUrl.value = null
})

/**
 * 作答入口：**只有勾选框和键盘走这里**。
 * 图片来源校验：勾选框点击时若该选项没有媒体（理论上不会有）也不作答。
 */
function commit(i: number) {
  if (props.chosen) return
  const name = props.options[i]
  if (!name) return
  emit('select', name)
}

/** 图片本体点击：只看大图，绝不作答（滚动手势也不会触发这个，click 在滚动后不派发） */
function clickImage(i: number) {
  openZoom(i)
}

// ---- 听音版：点按整行播放（听音时选项上没有图，不存在滚动冲突） ----
function pressIndex(i: number) {
  const name = props.options[i]
  if (!name || props.chosen) return
  if (props.type === 'image') {
    // 图片版整行点击 = 看大图（作答只能点勾选框）——作保留给键盘/勾选框
    openZoom(i)
    return
  }
  const media = props.optionsMedia[i]
  if (!media || !audio) return
  // 播放中再点同一项 = 作答；点其它项 = 切换播放
  if (playingUrl.value === media.url) {
    audio.pause()
    playingUrl.value = null
    emit('select', name)
    return
  }
  audio.src = media.url
  playingUrl.value = media.url
  audio.play().catch(() => {
    playingUrl.value = null
  })
}

/** 作答后停掉试听（父组件在 answered 变化时调用） */
function stopPlayback() {
  if (audio) audio.pause()
  playingUrl.value = null
}

/** 键盘快捷键入口（1–4/A–D）：与勾选框同一套语义（直接作答） */
function pressByKey(i: number) {
  if (props.type === 'image') {
    commit(i)
    return
  }
  pressIndex(i)
}

/** 勾选框是否可用（已作答则禁用） */
function canPick(i: number): boolean {
  return !props.chosen && !!props.optionsMedia[i]
}

/** 网格列数（图片版）：桌面/平板 2 列，手机 1 列 */
const cols = computed(() => (props.type === 'image' ? 2 : 2))

defineExpose({ pressIndex: pressByKey, stopPlayback })
</script>

<template>
  <div class="media-options" :class="type" :style="type === 'image' ? { '--cols': cols } : undefined">
    <div
      v-for="(opt, i) in options"
      :key="`${opt}-${i}`"
      class="mopt"
      :class="[state(opt), { playing: optionsMedia[i]?.url === playingUrl }]"
    >
      <!-- 听音版：整行是播放/作答按钮（没有图，不存在滚动冲突） -->
      <button
        v-if="type === 'audio'"
        class="row-btn"
        :disabled="!!chosen"
        :aria-label="letters[i]"
        @click="pressIndex(i)"
      >
        <span class="key">{{ letters[i] }}</span>
        <span class="play"><Play class="ic" :size="18" /></span>
        <span class="hint">{{ t('quiz6.audioOptionHint') }}</span>
      </button>

      <!-- 图片版：图片本体**只负责看大图**（点击）与滚动（按住拖），作答只走右上角方框 -->
      <template v-else>
        <!-- 用 <img> 的默认行为：不设 touch-action 限制 → 竖向拖拽交给浏览器滚动 -->
        <img
          class="thumb"
          :src="optionsMedia[i]?.thumbUrl || optionsMedia[i]?.url"
          alt=""
          decoding="async"
          @load="emit('media-settled', true)"
          @error="emit('media-settled', false)"
          @click="clickImage(i)"
        />
        <!-- 标号放**左上角**（2026-11-03 用户定）：它是单纯标号，不参与作答 -->
        <span class="label" aria-hidden="true">{{ letters[i] }}</span>
        <span class="zoom-hint" aria-hidden="true"><ZoomIn :size="14" /></span>

        <!-- 状态/作答框放**右上角**：未作答 = 纯空白；作答后正确 = 绿底白勾、其余 = 红底白叉 -->
        <button
          class="pick"
          :class="{ 'is-picked': chosen === opt }"
          type="button"
          :disabled="!canPick(i)"
          :aria-label="t('quiz6.pickThis', { letter: letters[i] })"
          :aria-pressed="chosen === opt"
          @click.stop="commit(i)"
        >
          <template v-if="chosen">
            <Check v-if="opt === answer" class="ic" :size="15" />
            <X v-else class="ic" :size="15" />
          </template>
        </button>

        <!-- 首次提示（每个模式第一次做题时出现一次）。
             **四个选项旁都显示**（2026-11-03 用户定）——只挂在 A 旁会被误读成「引导选 A」。
             所以文案必须极短，才能四条并排而不挤。 -->
        <Transition name="hint-fade">
          <span v-if="showFirstHint" class="pick-hint" aria-hidden="true">{{
            t('quiz6.firstHint')
          }}</span>
        </Transition>
      </template>
    </div>
  </div>
  <p v-if="type === 'audio' && !chosen" class="audio-tip" role="note">
    {{ t('quiz6.audioHint') }}
  </p>

  <!-- 看大图（与合作 SpeciesGallery 的 lightbox 同形） -->
  <Teleport to="body">
    <div
      v-if="zoom"
      class="ml-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="t('quiz6.viewPhoto')"
      @click="closeZoom"
    >
      <img :src="zoom.url" :alt="zoom.alt" @click.stop />
      <button class="ml-close" type="button" :aria-label="t('gallery.close')" @click="closeZoom">
        <X :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.media-options {
  display: grid;
  gap: 10px;
}
/* 图片版：桌面/平板 2×2；手机 1 列（2026-11-03 用户定：两列会把图压太小）。
   **整体限宽并居中**（用户定「电脑版也要滚」）——2×2 铺满 1200px 时单图高约 330px，
   两行就 660px 以上，加上题干/按钮必须滚动。限在 720px 后单图约 350×240，一屏可容纳。 */
.media-options.image {
  grid-template-columns: repeat(var(--cols, 2), 1fr);
  max-width: 640px;
  margin-inline: auto;
}
.media-options.audio {
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 600px) {
  .media-options.image {
    /* 手机：一列上下显示，图更大、勾选框更好点 */
    grid-template-columns: 1fr;
    gap: 8px;
    max-width: none;
    /* 行高降一档（一列 4 张，太高就要多滚） */
    --cell-h: 150px;
  }
  .media-options.audio {
    grid-template-columns: 1fr;
  }
}
.mopt {
  position: relative;
  padding: 0;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  overflow: hidden;
  /* 固定格高（2026-11-03）：所有选项等高，图片用 contain 整张塞进格子，
     竖图两侧留白、绝不上下溢出。手机上由 .media-options.image 覆盖成 150px。 */
  height: var(--cell-h, 190px);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
  box-shadow: var(--shadow-sm);
}
.mopt.correct {
  border-color: var(--correct);
  background: linear-gradient(135deg, #eafaf1, #d8f3dc);
}
.mopt.wrong {
  border-color: var(--wrong);
  background: #fdecee;
}
.mopt.dim {
  opacity: 0.55;
}
.mopt.playing {
  border-color: var(--primary);
  background: #f3fbf7;
}

/* 图片本体：单击 = 看大图（不是作答）；竖向拖拽自然交给页面滚动。
   尺寸（2026-11-03 用户定「图太大，电脑版都要滚」）：
   - 桌面 2×2 时把整块宽度收在 640px 内并居中；
   - 手机一列时用同一套逻辑，行高更小。

   **布局改为「固定格高 + contain」（2026-11-03 用户定）**：
   原先 `aspect-ratio: 4/3` + `max-height` 会被 height 上限打断比例（311px 宽本该 233 高，
   被压成 190），于是连横图都出现明显左右留白、图显得又小又空；而 `cover` 又会把竖图裁成
   横框、只露中段，用户被迫点开大图才看得全（等于绕远路）。
   现在：格高固定（`.mopt` 给高度），图片 `width/height: 100%` + `object-fit: contain`——
   **整图永远完整**，横图铺满宽、竖图两侧留白，绝不上下溢出；所有格子等高，排版整齐。 */
.thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #f2f6f4;
  cursor: zoom-in;
}
.zoom-hint {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  pointer-events: none; /* 不拦截点击，避免成为第二个「作答入口」 */
}

/* ---- 左上角标号（单纯 ABCD，不参与作答；2026-11-03 用户定） ---- */
.label {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font-size: 0.74rem;
  font-weight: 800;
  line-height: 1;
  pointer-events: none; /* 纯标号，绝不拦截点击 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

/* ---- 状态/作答框（右上角）：未作答纯空白，**视觉缩小、热区不缩** ----
   视觉 32×32（2026-11-03 用户定「框太大，小一些」），
   但点击热区经 `::after` 向外扩到约 46×46，保持 iOS HIG / Material 的可点性。 */
.pick {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 2px solid #fff;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.94);
  color: var(--primary);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: transform 0.14s ease, background 0.14s ease;
}
/* 热区外扩：视觉小、好点按（不改变布局，只是把可点范围撑出去） */
.pick::after {
  content: '';
  position: absolute;
  inset: -7px;
  border-radius: 14px;
}
.pick:not(:disabled):active {
  transform: scale(0.93);
  background: var(--primary);
  color: #fff;
}
.pick:disabled {
  cursor: default;
  opacity: 0.75;
}

/* ---- 首次提示 toast（每个方框左侧，每个模式只出现一次）----
   方框缩到 32px 后，提示右距同步改成 46px（32 + 右 8 + 6 间距），
   文案极短（「选」/「Pick」）以便四条并排不互相挤压。 */
.pick-hint {
  position: absolute;
  top: 11px;
  /* 方框 32px + 右 8px = 40px，再留 8px 间隙 → 48px。
     原先写 46px 会与方框边缘几乎贴合（视觉上像压住方框）。 */
  right: 48px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(20, 40, 30, 0.86);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none; /* 不挡住作答 */
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  /* 轻微放大缩小的呼吸感（用户要求「轻微的放大缩小效果」） */
  animation: hintPulse 1.2s ease-in-out infinite;
}
/* 小三角指向右侧的方框 */
.pick-hint::after {
  content: '';
  position: absolute;
  top: 50%;
  right: -5px;
  width: 0;
  height: 0;
  transform: translateY(-50%);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 5px solid rgba(20, 40, 30, 0.86);
}
@keyframes hintPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}
.hint-fade-leave-active {
  transition: opacity 0.22s ease;
}
.hint-fade-leave-to {
  opacity: 0;
}
/* 尊重「减少动态效果」偏好：只保留淡出，不做缩放呼吸 */
@media (prefers-reduced-motion: reduce) {
  .pick-hint {
    animation: none;
  }
}

/* 未作答：**纯空白方框**（无任何图标）——放勾号会让人误判「已选中」。
   作答后按对错换成图标：正确 → 绿底白勾；其余 → 红底白叉（用户 2026-11-03 定）。 */
.mopt.correct .pick {
  background: var(--correct);
  border-color: var(--correct);
  color: #fff;
}
.mopt.wrong .pick,
.mopt.dim .pick {
  background: var(--wrong);
  border-color: var(--wrong);
  color: #fff;
  box-shadow: none;
  opacity: 1;
}
/* 作答后所有框都可读（.dim 的整卡淡化不再叠加到状态框上） */
.mopt.correct .pick,
.mopt.wrong .pick,
.mopt.dim .pick {
  opacity: 1;
}

/* ---- 听音版：整行播放 ---- */
.row-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.row-btn:disabled {
  cursor: default;
}
.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.74rem;
  font-weight: 800;
  flex-shrink: 0;
}
.play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #eaf4ef;
  color: var(--primary);
  flex-shrink: 0;
}
.mopt.playing .play {
  background: var(--primary);
  color: #fff;
}
.mopt.correct .play {
  background: var(--correct);
  color: #fff;
}
.mopt.wrong .play {
  background: var(--wrong);
  color: #fff;
}
.hint {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-light);
}
.audio-tip {
  margin: 8px 0 0;
  font-size: 0.75rem;
  color: var(--text-light);
  text-align: center;
}

/* ---- 看大图 ---- */
.ml-lightbox {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 18, 14, 0.86);
  backdrop-filter: blur(6px);
  cursor: zoom-out;
}
.ml-lightbox img {
  max-width: 94vw;
  max-height: 92vh;
  border-radius: var(--radius-sm);
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8);
  cursor: default;
}
.ml-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  cursor: pointer;
}
</style>
