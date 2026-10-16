/**
 * 模型权重的下载与本地缓存
 *
 * 铁律（docs/055 §6）：**必须用户主动触发才下载**，绝不自动预取。
 * 几十 MB 的权重在移动网络上是实打实的流量，不该由页面替他决定。
 *
 * 下载策略（M3 决策）：**并行分块**。实测本项目 R2 单流 3.86 MB/s、
 * 8 连接合计 28.45 MB/s，故用 4 路分块把 44MB 从 12 秒压到 4~6 秒。
 * R2 已验证支持 `Accept-Ranges` + 206 + `Access-Control-Allow-Origin: *`。
 *
 * 缓存策略：
 *   1. 先查 Cache Storage（SW 不参与，见 sw.js 注释：/models/ 故意不匹配任何分支）
 *   2. 命中直接用；未命中则分块并发下载（带进度）
 *   3. 下载后请求 navigator.storage.persist()，降低被系统回收的概率
 */

import { weightsUrl, type ModelRef } from './weights'

const CACHE_PREFIX = 'uniaoer-model-'
export const cacheNameFor = (m: ModelRef) => CACHE_PREFIX + m.file

/** 并发分块数。4 是实测甜点：再高收益递减（单连接已接近本机带宽上限） */
const PARALLEL = 4
/** 小于该值不分块，直接单流（分块反而多几次往返） */
const CHUNK_THRESHOLD = 4 * 1024 * 1024

export type ModelState =
  | { phase: 'idle' }
  | { phase: 'missing'; bytes: number }
  | { phase: 'downloading'; received: number; total: number }
  | { phase: 'ready'; bytes: number }
  | { phase: 'error'; message: string }

export async function cachedModel(m: ModelRef): Promise<Response | null> {
  if (typeof caches === 'undefined') return null
  try {
    const c = await caches.open(cacheNameFor(m))
    return (await c.match(weightsUrl(m))) ?? null
  } catch {
    return null
  }
}

async function head(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    return Number(r.headers.get('content-length') || 0)
  } catch {
    return 0
  }
}

export async function modelSize(m: ModelRef): Promise<number> {
  const hit = await cachedModel(m)
  if (hit) return (await hit.clone().arrayBuffer()).byteLength
  return head(weightsUrl(m))
}

/** 并行分块下载并合并；返回完整 ArrayBuffer */
async function downloadChunked(
  url: string,
  total: number,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const size = Math.ceil(total / PARALLEL)
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < PARALLEL; i++) {
    const s = i * size
    const e = Math.min(s + size - 1, total - 1)
    if (s <= e) ranges.push([s, e])
  }
  const parts: Uint8Array[] = Array.from({ length: ranges.length })
  let done = 0
  await Promise.all(
    ranges.map(async ([s, e], i) => {
      const want = e - s + 1
      let lastErr: unknown
      // 单块重试：分块比单流更容易撞上偶发断流
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(url, { headers: { Range: `bytes=${s}-${e}` } })
          if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`)
          const buf = new Uint8Array(await r.arrayBuffer())
          // 服务端若忽略 Range 会回 200 全量，此时只取需要的切片
          const slice = buf.length === total ? buf.slice(s, e + 1) : buf
          if (slice.length !== want) throw new Error(`分块长度 ${slice.length} ≠ ${want}`)
          parts[i] = slice
          done += slice.length
          onProgress?.(done, total)
          return
        } catch (err) {
          lastErr = err
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('分块下载失败')
    }),
  )
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    merged.set(p, off)
    off += p.length
  }
  return merged.buffer as ArrayBuffer
}

export async function ensureModel(
  m: ModelRef,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const hit = await cachedModel(m)
  if (hit) return hit.arrayBuffer()

  const url = weightsUrl(m)
  const total = await head(url)
  if (!total) throw new Error(`拿不到模型大小（${url} 无 Content-Length）`)

  let buf: ArrayBuffer
  if (total < CHUNK_THRESHOLD) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`模型下载失败：${r.status}`)
    buf = await r.arrayBuffer()
    onProgress?.(buf.byteLength, total)
  } else {
    buf = await downloadChunked(url, total, onProgress)
  }

  try {
    if (typeof caches !== 'undefined') {
      const c = await caches.open(cacheNameFor(m))
      await c.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }))
    }
  } catch {
    /* 存不下缓存不影响本次使用 */
  }
  void requestPersist()
  return buf
}

export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* 忽略 */
  }
  return false
}

export async function clearModelCache(m: ModelRef): Promise<void> {
  if (typeof caches === 'undefined') return
  await caches.delete(cacheNameFor(m))
}
