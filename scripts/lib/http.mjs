/**
 * 021 §2.1 统一采集层：所有新增数据抓取脚本统一走这里，不得各写各的 fetch。
 * - 超时覆盖 headers+body（000-SUMMARY §3 踩坑 11：收到响应头就清计时器会让卡住的 body 无限挂起）
 * - 每源 QPS 节奏；429/5xx/网络错误指数退避，尊重 Retry-After
 * - 统一 User-Agent（如实表明非商业开源身份）
 * - 磁盘缓存断点续跑（force 重拉）；mock 注入后完全不联网（本地测试可用）
 * - 失败显式抛错（禁止静默空值）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { sleep } from './util.mjs'

const DEFAULT_UA =
  'uniaoer-build/1.0 (non-commercial open-source bird quiz; https://github.com/zuoguyoupan2023/UNiaoer)'

export function createClient({
  name = 'src',
  cacheDir = null,
  qps = 5,
  timeoutMs = 45_000,
  retries = 3,
  headers = {},
  mock = null,
} = {}) {
  let lastAt = 0
  const minGapMs = Math.ceil(1000 / Math.max(1, qps))

  async function pace() {
    const wait = lastAt + minGapMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastAt = Date.now()
  }

  async function readCache(file) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      return undefined
    }
  }

  async function request(url, { timeout: t = timeoutMs, retries: r = retries } = {}) {
    let lastErr
    for (let attempt = 0; attempt <= r; attempt++) {
      await pace()
      const ctrl = new AbortController()
      // 计时器覆盖到 body 读完为止（res.json()），不是只盖响应头
      const timer = setTimeout(() => ctrl.abort(), t)
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json', ...headers },
        })
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`)
          err.status = res.status
          err.retryAfterSec = Number(res.headers.get('retry-after')) || 0
          throw err
        }
        return await res.json()
      } catch (e) {
        lastErr = e
        const status = String(e?.status || '')
        const retryable = !status || status === '429' || status.startsWith('5')
        if (!retryable || attempt === r) break
        const wait =
          status === '429' && e.retryAfterSec
            ? Math.min(e.retryAfterSec * 1000, 30_000)
            : Math.min(1200 * 2 ** attempt, 15_000)
        await sleep(wait)
      } finally {
        clearTimeout(timer)
      }
    }
    throw new Error(`[${name}] GET ${url} failed: ${lastErr?.message || lastErr}`)
  }

  /**
   * GET JSON。cacheFile 为 cacheDir 内文件名；force 跳过缓存（--refresh）。
   * mock(url) 返回非 undefined 时直接采用夹具（不联网、不读写缓存）。
   */
  async function getJson(url, { cacheFile = null, force = false, timeout, retries } = {}) {
    if (mock) {
      const fixture = mock(url)
      if (fixture !== undefined) return fixture
    }
    const file = cacheDir && cacheFile ? path.join(cacheDir, cacheFile) : null
    if (!force && file) {
      const hit = await readCache(file)
      if (hit !== undefined) return hit
    }
    const data = await request(url, { timeout, retries })
    if (file) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify(data))
    }
    return data
  }

  return { getJson, request }
}
