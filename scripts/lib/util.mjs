import { promises as fs } from 'node:fs'
import path from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解析 CLI 参数：--key value / --flag */
export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i++
    } else {
      args[key] = true
    }
  }
  return args
}

/** 极简 .env 加载（无第三方依赖） */
export async function loadEnv(file = '.env') {
  try {
    const txt = await fs.readFile(file, 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      const key = m[1]
      let val = m[2].trim().replace(/^["']|["']$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    /* 无 .env 时忽略 */
  }
}

const UA = 'UNiaoer-build/0.1 (open-source non-commercial bird quiz)'

/** 带超时与重试的 JSON 请求（429 感知：尊重 Retry-After，指数长退避；023 P2 全量采集实测 iNat 会持续限流） */
export async function fetchJson(url, { retries = 3, timeout = 45000, headers = {}, retryOn429 = true } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    // 超时覆盖 body（res.json()）；只在收到头后清除会让卡住的 body 无限挂起
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      })
      if (res.status === 429) {
        // 限流退避：优先服务端 Retry-After，否则指数（15s 起，封顶 150s）
        const ra = Number(res.headers.get('retry-after'))
        const hasRa = Number.isFinite(ra) && ra > 0
        let host = '?'
        try {
          host = new URL(url).host
        } catch {
          /* 相对 URL 忽略 */
        }
        const wait = hasRa ? ra * 1000 : Math.min(150_000, 15_000 * 2 ** attempt)
        // 429 诊断(2026-10-07):记录主机/尝试次数/服务端 Retry-After,定位限流来源
        console.warn(
          `      ↳ 429 ${host} (第 ${attempt + 1}/${retries + 1} 次尝试, Retry-After ${hasRa ? ra + 's' : '无'}, 退避 ${Math.round(wait / 1000)}s)`,
        )
        lastErr = new Error(`HTTP 429 ${host} (rate limited, backoff ${Math.round(wait / 1000)}s)`)
        lastErr.wait = wait
        lastErr.rateLimited = true
        throw lastErr
      }
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      lastErr = e
      // retryOn429=false：429 立即上抛给调用方（由全局熔断/暂停处理，避免在封禁期内重试继续敲门）
      if (e.rateLimited && !retryOn429) throw e
      if (attempt < retries) await sleep(e.wait != null ? e.wait : 1200 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/** 带磁盘缓存的 JSON 获取 */
export async function cachedJson(cacheFile, producer, { force = false } = {}) {
  if (!force) {
    try {
      return JSON.parse(await fs.readFile(cacheFile, 'utf8'))
    } catch {
      /* miss */
    }
  }
  const data = await producer()
  await fs.mkdir(path.dirname(cacheFile), { recursive: true })
  await fs.writeFile(cacheFile, JSON.stringify(data))
  return data
}

/** 并发池：限制同时运行的任务数 */
export async function mapPool(items, limit, fn) {
  const results = Array.from({ length: items.length })
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}
