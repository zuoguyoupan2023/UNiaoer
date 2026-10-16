/**
 * 识别模型的下载与本地缓存
 *
 * 铁律（055 §6）：**必须用户主动触发才下载**，绝不自动预取。
 * 25MB 的权重在移动网络上是实打实的流量，不该由页面替他决定。
 *
 * 缓存策略：
 *   1. 先查 Cache Storage（SW 也走这条，避免同一份模型存两份）
 *   2. 命中直接用；未命中则带进度下载
 *   3. 下载后请求 navigator.storage.persist()，降低被系统清掉的可能
 */

export const MODEL_PATH = `${import.meta.env.BASE_URL}models/birdnet-audio.tflite`
const CACHE_NAME = 'uniaoer-birdnet-model-v1'

export type ModelState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'missing'; bytes: number }
  | { phase: 'downloading'; received: number; total: number }
  | { phase: 'ready'; bytes: number }
  | { phase: 'error'; message: string }

export async function cachedModel(): Promise<Response | null> {
  if (typeof caches === 'undefined') return null
  try {
    const c = await caches.open(CACHE_NAME)
    const hit = await c.match(MODEL_PATH)
    return hit ?? null
  } catch {
    return null
  }
}

export async function modelSize(): Promise<number> {
  const hit = await cachedModel()
  if (hit) return Number(hit.headers.get('content-length') || 0) || (await hit.clone().arrayBuffer()).byteLength
  try {
    const head = await fetch(MODEL_PATH, { method: 'HEAD' })
    return Number(head.headers.get('content-length') || 0)
  } catch {
    return 0
  }
}

/**
 * 拿到模型字节：优先缓存，其次下载（带进度）。
 * 用 arrayBuffer 而非 Response，是因为 tfjs-tflite 的 fromArrayBuffer 需要完整 buffer。
 */
export async function ensureModel(
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const hit = await cachedModel()
  if (hit) return hit.arrayBuffer()

  const res = await fetch(MODEL_PATH)
  if (!res.ok) throw new Error(`模型下载失败：${res.status}`)

  // 有 content-length 时走流式以便报进度；没有就一次性读
  const total = Number(res.headers.get('content-length') || 0)
  let buf: ArrayBuffer
  if (res.body && total > 0) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        onProgress?.(received, total)
      }
    }
    const merged = new Uint8Array(received)
    let off = 0
    for (const c of chunks) {
      merged.set(c, off)
      off += c.length
    }
    buf = merged.buffer as ArrayBuffer
  } else {
    buf = await res.arrayBuffer()
  }

  try {
    if (typeof caches !== 'undefined') {
      const c = await caches.open(CACHE_NAME)
      await c.put(MODEL_PATH, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }))
    }
  } catch {
    /* 存不下缓存不影响本次使用 */
  }
  void requestPersist()
  return buf
}

/** 申请持久化存储，降低模型被系统回收的概率（浏览器可能静默拒绝） */
export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* 忽略 */
  }
  return false
}

export async function clearModelCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  await caches.delete(CACHE_NAME)
}
