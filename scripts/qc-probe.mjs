/**
 * docs/103 首图质检 · 多模态通道探测（Zhipu ChatGLM，OpenAI 兼容 v4 端点）
 *
 * 用法：
 *   node scripts/qc-probe.mjs --models        # 探测哪些视觉模型可用（各发 1 次微型请求）
 *   node scripts/qc-probe.mjs --rpm [MODEL]   # 实测该模型一分钟内能成功几次（顺序 + 4 并发爆发）
 *
 * 凭证读 .env 的 QC_API_BASE / QC_API_KEY；key 不出现在任何输出里。
 * 请求用本地 320px 缩略图（4KB），提示词只要求回 "OK"，把花费压到最低。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ---- .env 读取（仅取 QC_*，不打印） ----
const env = {}
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/)
    if (m) env[m[1]] = m[2]
  }
}
const BASE = (env.QC_API_BASE || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')
const KEY = env.QC_API_KEY
if (!KEY) {
  console.error('缺少 QC_API_KEY（.env）')
  process.exit(1)
}

// 测试图：本仓库一只真实缩略图（320px webp 转 png，4KB）
const IMG_B64 = readFileSync('data-cache/media-qc/pilot/larus-fuscus.png').toString('base64')
const IMAGE_URL = `data:image/png;base64,${IMG_B64}`

async function chat(model, { timeoutMs = 45_000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: IMAGE_URL } },
              { type: 'text', text: '只回答两个字母：OK' },
            ],
          },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
    })
    const retryAfter = Number(res.headers.get('retry-after')) || null
    let body = ''
    try {
      const j = await res.json()
      body = j?.choices?.[0]?.message?.content ?? j?.error?.message ?? JSON.stringify(j).slice(0, 160)
    } catch {
      body = '(non-json)'
    }
    return { status: res.status, ms: Date.now() - t0, retryAfter, body: String(body).slice(0, 120) }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, retryAfter: null, body: e.name === 'AbortError' ? '(timeout)' : String(e).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- --models：候选视觉模型各探一次 ----
const CANDIDATES = [
  'glm-4.7v',
  'glm-4.6v',
  'glm-4.5v',
  'glm-4.1v-thinking-flash',
  'glm-4.1v-thinking',
  'glm-4v-plus-0111',
  'glm-4v-plus',
  'glm-4v-flash',
  'glm-4v',
]

async function probeModels() {
  console.log(`端点: ${BASE}`)
  console.log('model'.padEnd(26), '状态  耗时    回复/错误')
  for (const m of CANDIDATES) {
    const r = await chat(m)
    const mark = r.status === 200 ? '✅' : r.status === 429 ? '🟡429' : '❌'
    console.log(m.padEnd(26), `${mark}${String(r.status).padStart(4)}`, `${String(r.ms).padStart(6)}ms`, r.body.replace(/\n/g, ' '))
    await sleep(1200)
  }
}

// ---- --rpm：一分钟频次实测（先顺序 60s，再 4 并发爆发） ----
async function probeRpm(model) {
  console.log(`模型: ${model} · 顺序连发 60s（收到 429 即退避并记录）`)
  const t0 = Date.now()
  let ok = 0
  let limited = 0
  let other = 0
  let first429At = null
  let maxRetryAfter = 0
  const latencies = []
  while (Date.now() - t0 < 60_000) {
    const r = await chat(model, { timeoutMs: 30_000 })
    if (r.status === 200) {
      ok++
      latencies.push(r.ms)
      process.stdout.write('.')
    } else if (r.status === 429) {
      limited++
      if (!first429At) first429At = ((Date.now() - t0) / 1000).toFixed(0)
      maxRetryAfter = Math.max(maxRetryAfter, r.retryAfter || 0)
      const wait = (r.retryAfter ? r.retryAfter * 1000 : 10_000)
      process.stdout.write('4')
      await sleep(Math.min(wait, 20_000))
      if (Date.now() - t0 >= 60_000) break
    } else {
      other++
      process.stdout.write('x')
      await sleep(2_000)
    }
  }
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
  console.log(`\n顺序 60s：成功 ${ok} · 429 ${limited}（首次出现在第 ${first429At ?? '-'} 秒，最大 Retry-After ${maxRetryAfter || '-'}s）· 其它错误 ${other} · 平均延迟 ${avg}ms`)

  // 4 并发爆发（检验 qc 脚本并发 2–4 是否可行）：先歇 30s 让窗口滚动
  console.log('歇 30s 后做 4 并发爆发测试…')
  await sleep(30_000)
  const burst = await Promise.all([1, 2, 3, 4].map(() => chat(model, { timeoutMs: 30_000 })))
  burst.forEach((r, i) => console.log(`  并发#${i + 1}: ${r.status} ${r.ms}ms ${r.status !== 200 ? r.body : ''}`))
  const okBurst = burst.filter((r) => r.status === 200).length
  console.log(`\n结论参考：顺序 ≈ ${ok} 次/分钟；4 并发爆发成功 ${okBurst}/4。qc 脚本建议并发 2–3 + 令牌桶 ≤${Math.max(6, Math.floor(ok * 0.7))}/分钟起步，跑 200 张校准后再调。`)
}

const arg = process.argv[2]
if (arg === '--models') {
  await probeModels()
} else if (arg === '--rpm') {
  await probeRpm(process.argv[3] || env.QC_MODEL || 'glm-4v-flash')
} else {
  console.log('用法: node scripts/qc-probe.mjs --models | --rpm [model]')
}
