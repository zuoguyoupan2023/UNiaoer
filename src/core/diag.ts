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
