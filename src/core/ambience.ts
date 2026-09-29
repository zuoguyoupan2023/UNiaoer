/**
 * 环境鸟鸣（R22）：与 backhill 项目同源的白噪声库 whitenoise.earthtrip.online。
 * 只取目录中的纯鸟叫音轨（鸟鸣/乌鸦/猫头鹰/海鸥/啄木鸟），在用户勾选的范围内乱序轮流播放。
 * 音频仅在用户点击「播放」后加载（符合浏览器自动播放策略）；勾选状态存本地 settings，不上传。
 */

const API_URL = 'https://whitenoise.earthtrip.online/api/categories.json'
const BASE = 'https://whitenoise.earthtrip.online'

/** 目录中的纯鸟叫音轨 key（与 backhill 的白噪声目录对应） */
const BIRD_KEYS = ['birds', 'crows', 'owl', 'seagulls', 'woodpecker'] as const

export interface AmbienceTrack {
  id: string
  key: string
  labelZh: string
  labelEn: string
  url: string
}

interface CatalogItem {
  id: string
  key: string
  category: string
  src: string
  label?: Record<string, string> | string
}

let tracksCache: AmbienceTrack[] | null = null
/** 本会话已预热过的音轨 URL（避免重复 fetch） */
const warmed = new Set<string>()

/** 加载（并缓存）鸟叫音轨目录；网络失败时抛错，由调用方展示 */
export async function loadBirdTracks(): Promise<AmbienceTrack[]> {
  if (tracksCache) return tracksCache
  const res = await fetch(API_URL, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`bird track catalog load failed: HTTP ${res.status}`)
  const data = (await res.json()) as { items?: CatalogItem[] }
  const items = Array.isArray(data.items) ? data.items : []
  tracksCache = items
    .filter((it) => (BIRD_KEYS as readonly string[]).includes(it.key))
    .map((it) => {
      const label =
        typeof it.label === 'object' && it.label !== null
          ? it.label
          : { en: typeof it.label === 'string' ? it.label : it.id }
      return {
        id: it.id,
        key: it.key,
        labelZh: label['zh-cn'] ?? label.en ?? it.id,
        labelEn: label.en ?? it.id,
        url: /^https?:\/\//.test(it.src) ? it.src : `${BASE}${it.src.startsWith('/') ? '' : '/'}${it.src}`,
      }
    })
  return tracksCache
}

/**
 * 后台预热全部音轨（共约 3.5MB）：fetch 会被 Service Worker 以 cache-first 持久缓存，
 * 之后切题/重播都是本地命中、即时出声（R25）。会话内只预热一次，失败静默。
 */
export function prewarmBirdTracks(): void {
  if (!tracksCache) return
  for (const t of tracksCache) {
    if (warmed.has(t.url)) continue
    warmed.add(t.url)
    fetch(t.url, { priority: 'low' }).catch(() => {
      // 预热失败不影响功能：下次播放仍会按需加载并经 SW 缓存
      warmed.delete(t.url)
    })
  }
}

/** 乱序队列：洗牌，并尽量避免与上一首相同 */
export function buildShuffledQueue(ids: string[], lastId?: string): string[] {
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  if (a.length > 1 && a[0] === lastId) {
    const swap = 1 + Math.floor(Math.random() * (a.length - 1))
    const tmp = a[0]!
    a[0] = a[swap]!
    a[swap] = tmp
  }
  return a
}

/** 体积最小的音轨（0.1MB）：index.html preload + 环境鸟鸣首发 */
export const FIRST_TRACK_ID = 'animals/owl'

/**
 * 背景音启动队列（R30）：首发音（preload 的小文件）打头，其余乱序跟上；
 * 首发音被用户取消勾选时退化为纯乱序。
 */
export function buildStartQueue(
  checkedIds: string[],
  firstId = FIRST_TRACK_ID,
  lastId?: string,
): string[] {
  if (!checkedIds.includes(firstId)) return buildShuffledQueue(checkedIds, lastId)
  const rest = checkedIds.filter((id) => id !== firstId)
  return [firstId, ...buildShuffledQueue(rest)]
}

// ---------- 播放器（单例） ----------

export interface AmbienceState {
  playing: boolean
  currentId: string | null
  /** 静音待命（R38）：浏览器拦截出声自动播放时，先静音播放（所有浏览器允许），首次交互取消静音 */
  muted: boolean
}

let state: AmbienceState = { playing: false, currentId: null, muted: false }
const listeners = new Set<(s: AmbienceState) => void>()

function setState(patch: Partial<AmbienceState>) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn(state)
}

export function getAmbienceState(): AmbienceState {
  return state
}

export function subscribeAmbience(fn: (s: AmbienceState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => {
    listeners.delete(fn)
  }
}

class AmbiencePlayer {
  private audio: HTMLAudioElement | null = null
  private queue: string[] = []
  private failCount = 0
  /** 由宿主注入：返回当前被取消勾选的音轨 id（来自 settings store） */
  private getExcluded: () => string[] = () => []

  configure(opts: { getExcluded: () => string[] }) {
    this.getExcluded = opts.getExcluded
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio
    const a = new Audio()
    a.volume = 0.5
    a.addEventListener('ended', () => {
      this.failCount = 0
      void this.playNext()
    })
    a.addEventListener('error', () => this.skipCurrent())
    this.audio = a
    return a
  }

  /** 一键播放：加载目录 → 按勾选过滤 → 首发音打头 + 乱序队列；muted=true 为静音待命（R38） */
  async start(opts: { muted?: boolean } = {}): Promise<void> {
    const all = await loadBirdTracks()
    prewarmBirdTracks() // 后台预热其余音轨（R25）：之后切题/重播都是本地命中
    const checked = all.filter((t) => !this.getExcluded().includes(t.id))
    if (!checked.length) throw new Error('no bird tracks checked (enable some in settings)')
    this.failCount = 0
    this.queue = buildStartQueue(
      checked.map((t) => t.id),
      FIRST_TRACK_ID,
      state.currentId ?? undefined,
    )
    this.ensureAudio()
    if (this.audio) this.audio.muted = !!opts.muted
    setState({ playing: true, muted: !!opts.muted })
    await this.playNext()
  }

  /** 取消静音（首次交互后调用，让静音待命的环境音出声） */
  unmute() {
    if (this.audio) this.audio.muted = false
    setState({ muted: false })
  }

  /** 一键停止 */
  stop() {
    setState({ playing: false, currentId: null, muted: false })
    this.queue = []
    this.failCount = 0
    this.audio?.pause()
  }

  /** 勾选变化时调用：正在播放的音轨被取消勾选则切到下一首 */
  syncExclusions() {
    if (!state.playing || !state.currentId) return
    if (this.getExcluded().includes(state.currentId)) void this.playNext()
  }

  private async playNext() {
    if (!state.playing || !this.audio) return
    const all = tracksCache ?? []
    const checked = all.filter((t) => !this.getExcluded().includes(t.id))
    // 勾选全被取消，或连续失败的音轨数已达上限：停止
    if (!checked.length || this.failCount >= checked.length) {
      this.stop()
      return
    }
    if (!this.queue.length) {
      this.queue = buildShuffledQueue(
        checked.map((t) => t.id),
        state.currentId ?? undefined,
      )
    }
    let id = this.queue.shift()!
    while (!checked.some((t) => t.id === id) && this.queue.length) id = this.queue.shift()!
    const track = checked.find((t) => t.id === id)
    if (!track) {
      this.stop()
      return
    }
    setState({ currentId: track.id })
    try {
      this.audio.src = track.url
      if (this.audio) this.audio.muted = state.muted
      await this.audio.play()
      this.failCount = 0
    } catch {
      // 自动播放被拒或该轨加载失败：跳下一首；连续全失败则停止
      this.failCount++
      void this.playNext()
    }
  }

  private skipCurrent() {
    if (!state.playing) return
    this.failCount++
    void this.playNext()
  }
}

export const ambiencePlayer = new AmbiencePlayer()

// ---------- 干扰音频（地狱难度，R23） ----------

/** 随机挑 n 条不重复音轨 */
export function pickRandomTracks<T>(tracks: T[], n: number): T[] {
  const a = [...tracks]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a.slice(0, Math.max(0, n))
}

/**
 * 地狱难度干扰播放器：每道题随机 N 条鸟叫循环播放（与顶栏环境鸟鸣相互独立）。
 * 看图版 2 条、听音版 1 条（听音版音量更低，避免盖过考题鸟鸣）。
 */
class InterferencePlayer {
  private audios: HTMLAudioElement[] = []

  /** 当前正在播放的干扰音轨数（观测/测试用） */
  get activeCount(): number {
    return this.audios.length
  }

  /** 开始 N 条随机干扰音；volume 为干扰音量（听音版建议更低） */
  async start(count: number, volume = 0.3) {
    this.stop()
    const all = await loadBirdTracks()
    prewarmBirdTracks() // 后台预热其余音轨（R25）：切题时干扰即时出声
    const picked = pickRandomTracks(all, count)
    this.audios = picked.map((t) => {
      const a = new Audio(t.url)
      a.loop = true
      a.volume = volume
      return a
    })
    // 用户已有点击手势（开始答题），播放被拒时静默忽略
    await Promise.allSettled(this.audios.map((a) => a.play()))
  }

  stop() {
    for (const a of this.audios) a.pause()
    this.audios = []
  }
}

export const interferencePlayer = new InterferencePlayer()

// 开发模式暴露实例，便于浏览器调试/验证播放状态（生产构建剔除）
if (import.meta.env.DEV) {
  ;(window as unknown as { __uniaoer: object }).__uniaoer = { ambiencePlayer, interferencePlayer }
}

