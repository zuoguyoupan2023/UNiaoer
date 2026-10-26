<script setup lang="ts">
/**
 * L6 半鸟人的选项列表（docs/081 §7）：题干是名字，**选项是图/音**。
 *  - 看图版：点按图片即作答（与经典 OptionList 一致）；
 *  - 听音版：点按播放该选项录音，**再点同一项**才作答（先听后答，R24 的 L6 版）；
 *    播放中点其它项则切换播放。共享一个 Audio 元素，crossorigin 先于 src 设置
 *    （铁律：跨域媒体必须走 CORS 模式，Safari 只读设置 src 那一刻的值，docs/033）。
 * 判分/反馈状态与 OptionList 同语义：correct / wrong / dim。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play } from 'lucide-vue-next'
import type { MediaAsset, MediaType } from '@/types'

const props = defineProps<{
  options: string[]
  optionsMedia: MediaAsset[]
  answer: string
  chosen: string | null
  type: MediaType
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

function pressIndex(i: number) {
  const name = props.options[i]
  if (!name || props.chosen) return
  if (props.type === 'image') {
    emit('select', name)
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

/** 键盘快捷键入口（1–4/A–D）：与点按完全同一套语义 */
function pressByKey(i: number) {
  pressIndex(i)
}

defineExpose({ pressIndex: pressByKey, stopPlayback })
</script>

<template>
  <div class="media-options" :class="type">
    <button
      v-for="(opt, i) in options"
      :key="`${opt}-${i}`"
      class="mopt"
      :class="[state(opt), { playing: optionsMedia[i]?.url === playingUrl }]"
      :disabled="!!chosen"
      :aria-label="`${letters[i]}`"
      @click="pressIndex(i)"
    >
      <template v-if="type === 'image'">
        <img
          class="thumb"
          :src="optionsMedia[i]?.thumbUrl || optionsMedia[i]?.url"
          :alt="''"
          decoding="async"
          @load="emit('media-settled', true)"
          @error="emit('media-settled', false)"
        />
      </template>
      <template v-else>
        <span class="key">{{ letters[i] }}</span>
        <span class="play"><Play class="ic" :size="18" /></span>
        <span class="hint">{{ t('quiz6.audioOptionHint') }}</span>
      </template>
      <span v-if="type === 'image'" class="key corner">{{ letters[i] }}</span>
    </button>
  </div>
  <p v-if="type === 'audio' && !chosen" class="audio-tip" role="note">
    {{ t('quiz6.audioHint') }}
  </p>
</template>

<style scoped>
.media-options {
  display: grid;
  gap: 10px;
}
.media-options.image {
  grid-template-columns: repeat(3, 1fr);
}
.media-options.audio {
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 480px) {
  .media-options.image {
    gap: 7px;
  }
}
.mopt {
  position: relative;
  padding: 0;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.18s ease;
  box-shadow: var(--shadow-sm);
}
.mopt:not(:disabled):hover {
  border-color: var(--primary-light);
  transform: translateY(-2px);
}
.mopt:disabled {
  cursor: default;
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
.thumb {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
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
.key.corner {
  position: absolute;
  top: 6px;
  left: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.mopt.correct .key {
  background: var(--correct);
  color: #fff;
}
.mopt.wrong .key {
  background: var(--wrong);
  color: #fff;
}
/* 听音选项：字母 + 播放图标 + 试听状态 */
.media-options.audio .mopt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
  text-align: left;
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
</style>
