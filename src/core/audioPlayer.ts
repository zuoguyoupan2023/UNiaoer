/**
 * 共享单音频播放器（观鸟页卡片小喇叭 + 预习浮窗共用）。
 *
 * - 全局只创建**一个** `HTMLAudioElement`：天然保证「同一时间只播一条」，
 *   点第二条时上一条自动停（074 P0-4 验收要求）；
 * - `crossorigin` **必须先于 `src` 设置**：Safari 只读设置 src 那一刻的值，
 *   WebKit 无法消费 SW 返回的 opaque 响应（docs/033，2026-10-08 iPhone 音频全挂）；
 * - 元素懒创建（首次用户点击时），避免页面加载即实例化媒体元素；
 * - 只做播放/暂停切换，不带 UI——喇叭按钮的状态由组件按 `playingUrl` 渲染。
 */
import { ref } from 'vue'

/** 当前正在播放的 URL；'' = 空闲 */
export const playingUrl = ref('')
/** 当前 URL 加载/播放失败（UI 据此把按钮复位并提示） */
export const playFailed = ref(false)

let el: HTMLAudioElement | null = null

function ensureEl(): HTMLAudioElement {
  if (el) return el
  const a = new Audio()
  // crossorigin 必须在设置任何 src 之前（docs/033）：整个生命周期只用这一个元素，
  // 创建时先定 CORS 模式，之后换 src 也安全。
  a.crossOrigin = 'anonymous'
  a.preload = 'auto'
  a.addEventListener('playing', () => {
    playingUrl.value = a.currentSrc || a.src || ''
    playFailed.value = false
  })
  a.addEventListener('pause', () => {
    if (playingUrl.value === (a.currentSrc || a.src || '')) playingUrl.value = ''
  })
  a.addEventListener('ended', () => {
    playingUrl.value = ''
  })
  a.addEventListener('error', () => {
    playFailed.value = true
    playingUrl.value = ''
  })
  el = a
  return a
}

/** 该 URL 是否正在播放 */
export function isPlaying(url: string): boolean {
  return !!url && playingUrl.value === url
}

/** 停止播放（切页/关浮窗时调用） */
export function stopSharedAudio(): void {
  if (!el) return
  el.pause()
  el.src = ''
  playingUrl.value = ''
}

/**
 * 切换播放：同 URL 正在播 → 暂停；否则停掉旧的换新 URL 播。
 * 播放失败时 `playFailed` 置 true（由调用方决定提示方式）。
 */
export async function toggleSharedAudio(url: string): Promise<void> {
  if (!url) return
  const a = ensureEl()
  const current = a.currentSrc || a.src || ''
  if (playingUrl.value === url && !a.paused) {
    a.pause()
    return
  }
  if (current !== url) {
    // 只在换源时才动 src：同 URL 重播不重置网络缓冲
    a.src = url
  }
  playFailed.value = false
  try {
    await a.play()
    playingUrl.value = url
  } catch {
    // AbortError（快速连点换源）与真正的加载失败都落到这里，
    // 统一交给 error 事件/失败态处理，不向 UI 抛异常
    if (a.error) playFailed.value = true
    if (playingUrl.value === url) playingUrl.value = ''
  }
}

/** 测试用：销毁单例（与其他 core 模块的 _reset 惯例一致） */
export function _resetSharedAudio(): void {
  if (el) {
    el.pause()
    el.src = ''
  }
  el = null
  playingUrl.value = ''
  playFailed.value = false
}
