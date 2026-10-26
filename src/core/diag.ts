/**
 * 072-a/b 观测开关（**默认关闭，对普通用户零影响**）。
 *
 * 尚未确定「一轮不足 10 题」的修法（是必须凑满，还是允许不足但说明），
 * 所以先只做观测：**不改变任何出题行为**，只把本轮的实际链路与池子大小记下来。
 *
 * 打开方式（任选其一）：
 *   · URL 加 `?diag=1`（会记住，之后每轮都显示）／ `?diag=0` 关闭
 *   · 控制台 `localStorage.setItem('uniaoer.diag','1')`
 *
 * 打开后：
 *   1) 答题页进度条下方出现一行诊断文案（手机可直接截图/记录）；
 *   2) 控制台每轮输出一行 `[quiz] built/next`，短轮输出 `[quiz] short round`；
 *   3) 在预览域名（`*.pages.dev`）或本地 dev 上，在线候选改打生产 API ——
 *      因为这些域名没有挂 Worker，`/api/questions` 只会返回 SPA 的 HTML，
 *      不这样处理，分支预览里根本复现不了「在线候选 ∩ 赛制池」这条链路。
 */
const STORAGE_KEY = 'uniaoer.diag'
const PARAM = 'diag'

let cached: boolean | null = null

/** 测试用：清掉进程内缓存 */
export function _resetDiagCache(): void {
  cached = null
}

/** 是否处于诊断观测模式（默认 false） */
export function isDiag(): boolean {
  if (cached !== null) return cached
  cached = false
  if (typeof window === 'undefined') return cached
  try {
    const raw = new URL(window.location.href).searchParams.get(PARAM)
    if (raw === '1') {
      localStorage.setItem(STORAGE_KEY, '1')
      cached = true
    } else if (raw === '0') {
      localStorage.removeItem(STORAGE_KEY)
      cached = false
    } else {
      cached = localStorage.getItem(STORAGE_KEY) === '1'
    }
    if (cached) console.info('[diag] observation mode ON (?diag=0 to turn off)')
  } catch {
    cached = false // 隐私模式/配额异常：当作关闭
  }
  return cached
}

/**
 * 诊断模式下的 API 基址（仅预览/本地环境返回生产域名）。
 * 生产环境（`uniaoer.com`）永远返回空串 → 行为与今天完全一致。
 */
export function diagApiBase(): string {
  if (!isDiag() || typeof location === 'undefined') return ''
  return apiBaseFor(location.hostname, true)
}

/** 纯函数（便于单测）：某个主机名 + 是否诊断模式 → API 基址 */
export function apiBaseFor(host: string, diag: boolean): string {
  if (!diag) return ''
  const preview = host.endsWith('.pages.dev') || host === 'localhost' || host === '127.0.0.1'
  return preview ? 'https://uniaoer.com' : ''
}

// ---------------------------------------------------------------------------
// 2026-10-25（问题 3）：**选项残留/幽灵点击**观测（默认关闭，仅 diag 模式生效）
//
// 现象（用户报告）：手机上某题选了第一个选项，下一题**未操作**却显示第一项已被选中。
// 桌面从未复现。已知可疑机制（移动端特有）：
//   · 幽灵点击（ghost click）：触点在下一题 DOM 上补发一次 click（旧 iOS/WebKit 的 300ms 延迟路径）；
//   · Vue 复用 DOM：:key 命中同名字符串时按钮被复用，上一题的 :disabled/:class 残留一帧；
//   · 指针事件在切题瞬间穿透（touchstart 落在旧题、touchend 落在新题）。
//
// 观测内容（不改变任何行为）：
//   · 每次「作答被接受」记录：题号/选项/来源（click/key）、距切题的毫秒数、是否处于作答后自动切换窗口；
//   · 若某题的作答发生在**切题后 600ms 内**且来源是 click/touch → 判定为可疑残留，记 console.warn 并在
//     诊断行尾部追加一条摘要（手机上可直接截图）。
//
// 打开方式：与既有 diag 相同（?diag=1）。**未开启时所有函数立即 return，零开销零副作用**。
// ---------------------------------------------------------------------------

/** 单次作答来源 */
export type AnswerSource = 'click' | 'key' | 'timeout' | 'unknown'

interface AnswerTrace {
  at: number
  questionIndex: number
  questionId: string
  value: string
  source: AnswerSource
  /** 距上一次切题的毫秒数（无从得知时为 null） */
  msSinceAdvance: number | null
  /** 作答后自动切换倒计时是否在跑（true = 可能是上一轮窗口的尾部点击） */
  autoPending: boolean
}

/** 最近若干条作答轨迹（环形缓冲，供诊断行展示；仅 diag 模式写入） */
const traceBuf: AnswerTrace[] = []
/** 最近一次切题（index 变化）的时间戳 */
let lastAdvanceAt: number | null = null
/** 可疑残留计数（切题后 <600ms 内的用户输入） */
let suspiciousCount = 0
const SUSPICIOUS_MS = 600

/** 切题时调用（QuizPlay 的 index watcher；非 diag 模式直接 return） */
export function diagMarkAdvance(): void {
  if (!isDiag()) return
  lastAdvanceAt = Date.now()
}

/**
 * 作答被接受时调用（quiz.answer 成功写入后）。
 * 命中「切题后 600ms 内的 click」→ 记一条 warn（手机端可直接在控制台看到）。
 */
export function diagMarkAnswer(input: {
  questionIndex: number
  questionId: string
  value: string
  source: AnswerSource
  autoPending: boolean
}): void {
  if (!isDiag()) return
  const now = Date.now()
  const msSinceAdvance = lastAdvanceAt === null ? null : now - lastAdvanceAt
  const suspicious =
    (input.source === 'click' || input.source === 'key') &&
    msSinceAdvance !== null &&
    msSinceAdvance < SUSPICIOUS_MS
  if (suspicious) {
    suspiciousCount++
    console.warn(
      '[diag] possible stale-input (ghost click / reused DOM):',
      JSON.stringify({
        ...input,
        msSinceAdvance,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
    )
  }
  traceBuf.push({ at: now, ...input, msSinceAdvance })
  if (traceBuf.length > 20) traceBuf.shift()
}

/** 诊断行摘要（非 diag / 无数据返回 ''） */
export function diagInputSummary(): string {
  if (!isDiag() || !traceBuf.length) return ''
  const last = traceBuf[traceBuf.length - 1]!
  const since = last.msSinceAdvance === null ? '?' : `${last.msSinceAdvance}ms`
  return `input#${last.questionIndex + 1} ${last.source} ${since} · suspect ${suspiciousCount}`
}

/** 测试用：清空轨迹 */
export function _resetInputTrace(): void {
  traceBuf.length = 0
  lastAdvanceAt = null
  suspiciousCount = 0
}
