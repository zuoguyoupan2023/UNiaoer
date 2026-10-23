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
  /**
   * 072-k：一轮结果的**正确率分桶**（不是每题、不含物种、不含用户）。
   * 用途：「各档位正确率」公开看板（`/stats`）。分桶而非精确值，避免任何可识别性。
   * 076 起精确口径由 `quiz_score` 承担；本事件**保留一段时间**，
   * 只为让历史曲线不断层（精确数据上线前的轮次只能按桶中点估算）。
   */
  quiz_result: {
    tier: ['1', '2', '3', '4', '5'],
    band: ['0-20', '20-40', '40-60', '60-80', '80-100'],
    // 073 P0：**用户自选**的地区（不是 IP）；形态校验见 allowedMetricValue
    region: ['@region'],
  },
  /**
   * 076：一轮的**精确得分**（correct / total），取代分桶估算。
   * 用整数而不是百分比：题量可能不足 10（072-a），存原始分数才能按题加权、也不丢信息。
   * 不含物种、不含任何用户标识；`region` 仍是**用户自选**地区（不是 IP）。
   */
  quiz_score: {
    tier: ['1', '2', '3', '4', '5'],
    correct: ['@score'],
    total: ['@score'],
    region: ['@region'],
  },
  report_submit: {},
  poster_create: {},
  // 公开看板（docs/028 §3.4）：徽章/称号**获取计数**（id 来自固定枚举，非用户输入）
  badge_earned: { badge: BADGE_IDS },
  title_earned: { track: TITLE_TRACKS, level: ['1', '2', '3', '4', '5'] },
}

/**
 * 正确率 → 分桶（072-k）。
 * 分桶而不是精确百分比：既能算"各档位平均正确率"，又不留下可识别的高精度行为轨迹。
 */
export function accuracyBand(accuracy: number): '0-20' | '20-40' | '40-60' | '60-80' | '80-100' {
  if (accuracy < 20) return '0-20'
  if (accuracy < 40) return '20-40'
  if (accuracy < 60) return '40-60'
  if (accuracy < 80) return '60-80'
  return '80-100'
}

const ENDPOINT = '/api/metrics'
/** 会话去重键（sessionStorage：每标签页会话一次；不是设备标识、关闭即清） */
const SESSION_KEY = 'uniaoer.sess'

/** 白名单裁剪：只保留允许的属性且值在枚举内（越界属性丢弃，事件本身仍计） */
/**
 * 073 P0：`region` 不穷举（330 省码 + 249 国），改形态校验：`ALL` | `CN` | `CN-11`。
 * 与 Worker 的 `REGION_VALUE_RE` 保持一致（两侧都校验）。
 */
const REGION_VALUE_RE = /^(ALL|[A-Z]{2}(?:-[A-Z0-9]{1,3})?)$/

/**
 * 076：精确得分属性（`correct`/`total`）只接受 **0–99 的整数**。
 * Worker 侧用同一条规则硬校验，且聚合时再判 `correct ≤ total`。
 */
const SCORE_VALUE_RE = /^\d{1,2}$/

function allowedMetricValue(allowed: readonly string[], v: string): boolean {
  if (allowed.includes('@region')) return REGION_VALUE_RE.test(v)
  if (allowed.includes('@score')) return SCORE_VALUE_RE.test(v)
  return allowed.includes(v)
}

function sanitize(event: string, props?: Props): Record<string, string> | undefined {
  const spec = EVENT_SPEC[event]
  if (!spec || !props) return undefined
  const out: Record<string, string> = {}
  for (const k of Object.keys(spec).sort()) {
    const v = props[k]
    if (v === undefined || v === null) continue
    if (allowedMetricValue(spec[k]!, String(v))) out[k] = String(v)
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
    // 076：省级归属地统计要用户显式同意（默认关）。只带一个布尔标记，
    // 省码由 Worker 从 request.cf 派生 —— 前端既拿不到也传不了省码。
    const geo = settings.metricsGeo ? { g: 1 } : {}
    const body = JSON.stringify(p ? { e: event, p, ...geo } : { e: event, ...geo })
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
