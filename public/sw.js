/* UNiaoer Service Worker —— 媒体持久化缓存 + 离线可用
 * 策略：
 *   - 媒体（iNaturalist / Xeno-canto / Wikimedia / 同源 /media/）：cache-first（持久化，二次访问秒开）
 *   - 题库 manifest：network-first（有网取新，断网回退缓存）
 *   - 构建后的同源 /assets/：cache-first（内容哈希，可长缓存）
 *   - 页面导航：network-first，断网回退缓存的首页
 */
const VERSION = 'uniaoer-v1'
const MEDIA_CACHE = `${VERSION}-media`
const RUNTIME_CACHE = `${VERSION}-runtime`

const MEDIA_HOSTS = new Set([
  'inaturalist-open-data.s3.amazonaws.com',
  'static.inaturalist.org',
  'xeno-canto.org',
  'upload.wikimedia.org',
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

  // 题库：network-first
  if (url.pathname.includes('/data/manifest')) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE))
    return
  }

  // 同源构建产物：cache-first
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
  if (hit) return hit
  const res = await fetch(req)
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).catch(() => {})
  }
  return res
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
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
