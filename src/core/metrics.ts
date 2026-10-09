/**
 * 028 最小用户计量（匿名事件计数）——前端上报层。
 *
 * 隐私口径（docs/028 §0/§4）：
 *   · **只做事件计数，不做用户追踪**：无 cookie、无设备指纹、不存 IP/UA、无持久 ID；
 *   · 计数维度 = 日期 × 事件类型 × 少量枚举属性（题型/难度/页面类目）；
 *   · 设置页披露 + 可关闭（`settings.metricsEnabled=false` 即完全不上报）；
 *   · 发送走 `navigator.sendBeacon`（不阻塞、离页也能发出），失败静默。
 *
 * 白名单与 Worker `METRIC_EVENTS` 一一对应（两处一起改）。
 */
import { useSettingsStore } from '@/stores/settings'

type Props = Record<string, string | number>

/** 徽章 id 白名单（与 `src/core/badges.ts` BADGES 同步；改那张表时同步这里 + Worker） */
const BADGE_IDS = [
  'first-round', 'perfect', 'hundred', 'listener', 'expert', 'beginner-birder', 'streak',
  'hell-first', 'audio-perfect', 'learned-revenge', 'five-rounds', 'thousand', 'veteran-fifty',
  'collection-master', 'collection-all', 'dual-perfect', 'stable-five', 'audio-correct-200',
  'review-correct-30', 'review-five', 'hell-ten', 'cross-streak-100', 'omniscient',
  'all-tier-perfect', 'hell-perfect', 'perfect-three', 'hell-coach', 'wrong-terminator',
  'hundred-rounds', 'night-owl', 'lark', 'escaped-quit', 'triple-forgiven', 'phoenix',
]
/** 称号轨道 id 白名单（与 `src/core/titles.ts` TITLE_TRACKS 同步） */
const TITLE_TRACKS = ['volume', 'collection', 'streak', 'perfect', 'audio', 'hell', 'rank', 'species-friend']

/**
 * 事件白名单（与 worker METRIC_EVENTS 对齐；键=事件，值=属性名 → 允许值）。
 * 两侧都校验：前端先裁剪（省一次无效往返），Worker 再硬校验（前端不可信）。
 */
const EVENT_SPEC: Record<string, Record<string, readonly string[]>> = {
  session_start: {},
  page_view: {
    category: ['quiz', 'region', 'catalog', 'species', 'profile', 'faq', 'reports', 'stats', 'other'],
  },
  quiz_complete: { mode: ['image', 'audio'], tier: ['1', '2', '3', '4', '5'] },
  report_submit: {},
  poster_create: {},
  // 公开看板（docs/028 §3.4）：徽章/称号**获取计数**（id 来自固定枚举，非用户输入）
  badge_earned: { badge: BADGE_IDS },
  title_earned: { track: TITLE_TRACKS, level: ['1', '2', '3', '4', '5'] },
}

const ENDPOINT = '/api/metrics'
/** 会话去重键（sessionStorage：每标签页会话一次；不是设备标识、关闭即清） */
const SESSION_KEY = 'uniaoer.sess'

/** 白名单裁剪：只保留允许的属性且值在枚举内（越界属性丢弃，事件本身仍计） */
function sanitize(event: string, props?: Props): Record<string, string> | undefined {
  const spec = EVENT_SPEC[event]
  if (!spec || !props) return undefined
  const out: Record<string, string> = {}
  for (const k of Object.keys(spec).sort()) {
    const v = props[k]
    if (v === undefined || v === null) continue
    if (spec[k]!.includes(String(v))) out[k] = String(v)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 上报一个事件。任何异常（未开开关/不支持/网络失败）都静默返回——
 * 计量绝不影响功能，也绝不重试堆积。
 */
export function track(event: string, props?: Props): void {
  if (!(event in EVENT_SPEC)) return
  try {
    const settings = useSettingsStore()
    if (!settings.metricsEnabled) return
    const p = sanitize(event, props)
    const body = JSON.stringify(p ? { e: event, p } : { e: event })
    if (body.length > 300) return // 与 Worker 上限一致
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // text/plain 避免 CORS 预检；Worker 只按文本解析
      const blob = new Blob([body], { type: 'text/plain' })
      navigator.sendBeacon(ENDPOINT, blob)
      return
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 静默：计量失败不影响任何功能 */
  }
}

/** 会话开始（每标签页会话一次）：App 挂载时调用，已标记则跳过 */
export function trackSessionStart(): void {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    // 隐私模式：无法去重 → 仍计（宁可多计一次也不漏）
  }
  track('session_start')
}
