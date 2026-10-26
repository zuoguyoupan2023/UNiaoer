/**
 * 网络测速（2026-10-26）：素材加载失败时给用户一个「当前网速」的量级参考。
 *
 * 做法是从媒体同源抓一个真实资源（缩略图优先），按 `字节数 / 耗时` 估算。
 * 只用于提示，不参与判分，也不阻塞答题；失败/超时返回 null（调用方显示"速度未知"）。
 */
export async function measureSpeedMbps(url: string, timeoutMs = 6000): Promise<number | null> {
  if (!url || typeof fetch !== 'function') return null
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined
  try {
    const startedAt = performance.now()
    const res = await fetch(url, ctl ? { cache: 'no-store', signal: ctl.signal } : { cache: 'no-store' })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const secs = (performance.now() - startedAt) / 1000
    if (!buf.byteLength || secs <= 0) return null
    return (buf.byteLength * 8) / secs / 1_000_000
  } catch {
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
