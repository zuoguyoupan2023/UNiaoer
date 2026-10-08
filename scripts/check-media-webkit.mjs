#!/usr/bin/env node
/**
 * 033 回归工具：WebKit（iPhone Safari / Edge）媒体播放 + SW 缓存行为检查。
 *
 * 为什么单测/e2e 覆盖不到：Chromium 能消费 SW 返回的 opaque/Range 响应，WebKit 不能——
 * 这是一个只有真引擎才能暴露的差异（2026-10-08 的线上故障：iPhone 音频全部无法播放）。
 * 本脚本用真实 dist 产物 + 真实 R2 媒体 + Playwright WebKit 引擎跑通「播放 → 缓存 → 再播放」，
 * 若 SW 媒体策略回退（重新引入 opaque 缓存 / 206 片段），这里会直接失败。
 *
 * 前置：
 *   npm run build
 *   npx playwright install webkit     # 首次需下载 WebKit 引擎（约 80MB）
 * 用法：
 *   node scripts/check-media-webkit.mjs            # 默认：WebKit + SW + CORS 主路径
 *   node scripts/check-media-webkit.mjs --all      # 追加 no-cors 与无 SW 对照组
 *
 * 已知限制（不是失败）：Playwright 的 WebKit 离线模拟会拦截**一切** fetch（连 SW 的
 * 合成响应也拦），故离线重放无法在此环境验证；真实 Safari 自 iOS 11.3 起支持 SW 离线。
 * 需要验证离线时请在真机/真 Safari 上手动测。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DIST = path.join(ROOT, 'dist')
const AUDIO_PATH = 'media/pycnonotus-sinensis/audio-1.mp3'
const AUDIO_URL = `https://bird.wewalk.world/${AUDIO_PATH}`
const PORT = 4399
const RUN_ALL = process.argv.includes('--all')

if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  console.error('✗ 找不到 dist/sw.js —— 先跑 `npm run build`')
  process.exit(1)
}

// 真实媒体（联网可得；离线环境下本条检查会失败，属预期）
const audioRes = await fetch(AUDIO_URL).catch(() => null)
if (!audioRes?.ok) {
  console.error(`✗ 无法获取测试音频（需要联网）：${AUDIO_URL}`)
  process.exit(2)
}
const audioBytes = Buffer.from(await audioRes.arrayBuffer())
console.log(`· 测试音频 ${(audioBytes.length / 1024).toFixed(0)}KB 就绪`)

const TEST_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"></head>
<body><audio id="a" controls preload="auto"></audio>
<script>navigator.serviceWorker.register('/sw.js').catch(() => {})</script></body></html>`

const server = http.createServer((req, res) => {
  if (req.url === '/audio-test') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(TEST_HTML)
    return
  }
  const p = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
  try {
    const data = fs.readFileSync(p)
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('nf')
  }
})
await new Promise((r) => server.listen(PORT, r))

/** 播放一次并等结果 */
async function playOnce(page) {
  return await page.evaluate(
    (url) =>
      new Promise((resolve) => {
        const a = document.getElementById('a')
        a.src = url
        const done = (outcome) =>
          resolve({ outcome, readyState: a.readyState, networkState: a.networkState, error: a.error ? a.error.code : null })
        a.addEventListener('canplaythrough', () => done('canplaythrough'), { once: true })
        a.addEventListener('error', () => done('error'), { once: true })
        a.load()
        a.play().catch(() => {})
        setTimeout(() => done('timeout'), 12_000)
      }),
    AUDIO_URL,
  )
}

/** 缓存里与音频相关的条目 */
async function inspectCache(page) {
  return await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      for (const req of await c.keys()) {
        if (!req.url.includes('audio-1')) continue
        const r = await c.match(req)
        return { cache: name, status: r?.status, type: r?.type, len: r?.headers.get('content-length') ?? null }
      }
    }
    return null
  })
}

let failures = 0
async function scenario(title, engine, { serviceWorkers, crossOrigin }) {
  const browser = await engine.launch()
  const ctx = await browser.newContext({ serviceWorkers })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/audio-test`, { waitUntil: 'domcontentloaded' })
  if (crossOrigin) await page.evaluate(() => { document.getElementById('a').crossOrigin = 'anonymous' })
  if (serviceWorkers === 'allow') {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  }
  const p1 = await playOnce(page)
  const p2 = await playOnce(page)
  const cached = serviceWorkers === 'allow' ? await inspectCache(page) : null
  await browser.close()

  const ok = p1.outcome === 'canplaythrough' && p2.outcome === 'canplaythrough'
  if (!ok) failures++
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${title}`)
  console.log(`    play1=${p1.outcome}(rs=${p1.readyState}) play2=${p2.outcome}(rs=${p2.readyState})` + (p1.error ? ` err=${p1.error}` : ''))
  if (cached !== null) console.log(`    缓存: ${JSON.stringify(cached)}`)
  if (ok && cached && (cached.status !== 200 || cached.type === 'opaque')) {
    console.log('    ⚠ 缓存条目不是完整 CORS 200 —— SW 媒体策略可能回退（docs/033）')
    failures++
  }
}

console.log('\n── WebKit（≈ iPhone Safari/Edge）· SW + CORS（线上主路径）──')
await scenario('WebKit · SW · CORS', webkit, { serviceWorkers: 'allow', crossOrigin: true })
await scenario('Chromium · SW · CORS（安卓回归）', chromium, { serviceWorkers: 'allow', crossOrigin: true })

if (RUN_ALL) {
  console.log('\n── 对照组 ──')
  await scenario('WebKit · 无 SW · CORS（对照：SW 之外一切正常）', webkit, { serviceWorkers: 'block', crossOrigin: true })
  await scenario('WebKit · SW · no-cors（历史故障形态：应失败）', webkit, { serviceWorkers: 'allow' })
}

server.close()
console.log(failures ? `\n✗ 媒体 WebKit 检查未通过（${failures} 项）` : '\n✓ 媒体 WebKit 检查通过（在线播放 + 缓存完整 200/CORS）')
console.log('  注：离线重放无法在本模拟器验证（WebKit 离线会拦掉 SW 合成响应）；真机 Safari 支持 SW 离线。')
process.exit(failures ? 1 : 0)
