/* UNiaoer Service Worker —— 媒体持久化缓存 + 离线可用
 * 策略（030 措施 4 调整后）：
 *   - 媒体（iNaturalist / Xeno-canto / Wikimedia / 同源 /media/）：cache-first（持久化，二次访问秒开）
 *   - 题库启动层 manifest-core：**stale-while-revalidate**（先给缓存即刻可用，后台拉新）
 *   - 详情层 data/assets/*：**cache-first**（构建产物 URL 稳定；内容随版本变，故按 version 失效）
 *   - 大静态产物（catalog.json / manifest-global.min.json）：stale-while-revalidate
 *   - 构建后的同源 /assets/：cache-first（内容哈希，可长缓存）
 *   - 页面导航：network-first，断网回退缓存的首页
 */
const VERSION = 'uniaoer-v2'
const MEDIA_CACHE = `${VERSION}-media`
const RUNTIME_CACHE = `${VERSION}-runtime`
/** 构建版本标记的存储键（存放最近一次见到的 manifest-core.generatedAt） */
const BUILD_TAG_KEY = `${VERSION}-build-tag`

/**
 * 030 措施 4 配套：构建版本感知的缓存失效。
 *
 * 问题：assets 分片（/data/assets/*.json）改 cache-first 后，构建更新时 **URL 不变**，
 * 旧缓存会一直命中——用户看到的是上一版的素材元数据。
 * 做法：用构建产物自带的 `manifest-core.generatedAt` 作为版本标记；
 * 每次启动比对，发现变化就清空运行时缓存（媒体缓存不动，媒体 URL 含物种目录,不受构建版本影响）。
 */
async function refreshBuildTag() {
  try {
    const res = await fetch('/data/manifest-core.json', { cache: 'no-store' })
    if (!res.ok) return
    const doc = await res.json()
    const tag = String(doc?.generatedAt || '')
    if (!tag) return
    const cache = await caches.open(RUNTIME_CACHE)
    const prev = await cache.match(BUILD_TAG_KEY)
    const prevTag = prev ? await prev.text() : ''
    if (prevTag && prevTag !== tag) {
      // 构建已更新：清运行时缓存（含 assets 分片 / 旧 core），并把新标记写回
      const keys = await cache.keys()
      await Promise.all(keys.map((k) => cache.delete(k)))
      await cache.put(BUILD_TAG_KEY, new Response(tag))
      return
    }
    if (!prevTag) await cache.put(BUILD_TAG_KEY, new Response(tag))
  } catch {
    /* 离线/网络异常:保留现有缓存（离线优先于新鲜度） */
  }
}

const MEDIA_HOSTS = new Set([
  'inaturalist-open-data.s3.amazonaws.com',
  'static.inaturalist.org',
  'xeno-canto.org',
  'upload.wikimedia.org',
  'whitenoise.earthtrip.online', // 环境鸟鸣/地狱干扰音（R22/R23），cache-first 秒开
])

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
      await refreshBuildTag()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // 媒体：cache-first
  if (MEDIA_HOSTS.has(url.hostname) || url.pathname.startsWith('/media/')) {
    event.respondWith(cacheFirst(req, MEDIA_CACHE))
    return
  }

  // 029 M1 分层产物 + 030 措施 4：按"变更频率 × 体积"分策略
  //   · 启动层 core：stale-while-revalidate —— 首屏立刻可用（缓存），后台更新下次生效
  //   · 详情层 assets/*：cache-first —— 构建产物、内容稳定，命中即零网络（省 R2 Class B）
  //   · 大产物（catalog / global.min）：stale-while-revalidate —— 体积大，优先本地
  if (url.pathname.includes('/data/manifest-core')) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE))
    return
  }
  if (url.pathname.includes('/data/assets/')) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE))
    return
  }
  if (url.pathname.includes('/data/catalog.json') || url.pathname.includes('/data/manifest-global')) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE))
    return
  }
  // 其余题库 JSON（含完整层 manifest.json）：network-first（口径与旧行为一致）
  if (url.pathname.includes('/data/')) {
    event.respondWith(manifestFetch(req))
    return
  }

  // 同源构建产物：cache-first（/assets/ 是 vite 产物;data/assets/*.json 走上面的 network-first）
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE))
    return
  }

  // 页面导航：network-first，回退首页
  if (req.mode === 'navigate') {
    event.respondWith(navigateFirst(req))
  }
})

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  // CORS 请求不能复用不透明（opaque）缓存，否则 canvas 会判定跨域失败
  const usableHit = hit && !(req.mode === 'cors' && hit.type === 'opaque')
  if (usableHit) return hit
  const res = await fetch(req)
  if (res && (res.ok || res.type === 'opaque')) {
    // 不要把不透明响应覆盖到已有的 CORS 缓存上
    if (!(req.mode === 'cors' && res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {})
    }
  }
  return res
}

/**
 * 030 措施 4：stale-while-revalidate。
 * 先返回缓存（若有）→ 立即响应、零等待；同时在后台拉取新版本写入缓存（供下次用）。
 * 无缓存时退化为网络请求。只缓存 JSON（防 SPA 回退 HTML 入缓存）。
 */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  const network = fetch(req)
    .then((res) => {
      const ct = res.headers.get('content-type') || ''
      if (res.ok && ct.includes('json')) cache.put(req, res.clone()).catch(() => {})
      return res
    })
    .catch(() => null)
  if (hit) {
    // 后台更新（不阻塞响应）
    network.catch(() => {})
    return hit
  }
  const res = await network
  if (res) return res
  return new Response('{"error":"offline"}', {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function manifestFetch(req) {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const res = await fetch(req)
    const ct = res.headers.get('content-type') || ''
    if (res.ok && ct.includes('json')) cache.put(req, res.clone()).catch(() => {})
    return res
  } catch {
    const hit = await cache.match(req)
    if (hit) return hit
    return new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function navigateFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put('/index.html', res.clone()).catch(() => {})
    return res
  } catch {
    const hit = (await cache.match(req)) || (await cache.match('/index.html'))
    if (hit) return hit
    return new Response('离线且无缓存', { status: 503 })
  }
}
