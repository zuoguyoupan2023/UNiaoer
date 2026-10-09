/* UNiaoer Service Worker —— 媒体持久化缓存 + 离线可用
 * 策略（030 措施 4 调整后）：
 *   - 媒体（iNaturalist / Xeno-canto / Wikimedia / 同源 /media/）：cache-first（持久化，二次访问秒开）
 *   - 题库启动层 manifest-core：**stale-while-revalidate**（先给缓存即刻可用，后台拉新）
 *   - 详情层 data/assets/*：**cache-first**（构建产物 URL 稳定；内容随版本变，故按 version 失效）
 *   - 大静态产物（catalog.json / manifest-global.min.json）：stale-while-revalidate
 *   - 构建后的同源 /assets/：cache-first（内容哈希，可长缓存）
 *   - 页面导航：network-first，断网回退缓存的首页
 */
// v3（2026-10-08）：媒体缓存策略修复（去 Range 取全量 + CORS 模式音频，见 docs/033）
// —— 版本号必须随本次变更递增：activate 时按前缀清理旧缓存，把历史不透明/206 片段清干净。
const VERSION = 'uniaoer-v3'
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
  // 036 省级常见度分片：内容随构建更新（URL 不含版本号），故 stale-while-revalidate
  // （首屏立刻可用 + 后台更新；构建版本变更时由 refreshBuildTag 清缓存兜底）
  if (url.pathname.includes('/data/province-commonness')) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE))
    return
  }
  // 039 P1 附近观鸟点（按国分片）：同 036 —— 产物随构建更新、URL 不含版本号，
  // stale-while-revalidate 让"断网点开 /nearby"仍能出上次的列表（docs/039 §5 DoD）
  if (url.pathname.includes('/data/hotspots-ebird')) {
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

/**
 * cache-first（媒体：R2 域名 / 同源 /media/、data/assets 分片）。
 *
 * 033（2026-10-08）：修 iPhone/Safari 音频无法播放。Safari 的媒体加载器**总会带 Range 请求**
 * （先 bytes=0-1 探针，再分段），而 Cache API **拒绝存储 206 响应**（put 抛错，此前被
 * `.catch(() => {})` 静默吞掉）→ 音频永远进不了缓存、离线不可用；更致命的是 WebKit 无法
 * 消费 SW 返回的 opaque 媒体响应（安卓正常、iPhone 卡在加载态）。对策：
 *   ① 上游统一去掉 Range 取全量（媒体文件约几十 KB～1.5MB，全量对本项目可接受），
 *      这样缓存里是完整 200，既能在线播也能离线播；
 *   ② 客户端音频一律走 CORS 模式（crossOrigin="anonymous"；R2 已配 ACAO:*），
 *      响应可读、可缓存；旧的不透明条目对 CORS 请求自动旁路并在下次取数时覆盖。
 * 映射约定：媒体 URL 与 R2 的 CORS 配置是此项修复的前提（新增媒体源时须确认 ACAO）。
 */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  // 缓存键一律去掉 Range：Range 是播放器的取数细节，不是资源身份。
  // 实测（Chromium + WebKit，2026-10-08）：带 Range 的请求能命中无 Range 的完整 200 条目，
  // 故统一用「无 Range 键」读写，规避 206 无法入缓存/无法跨版本复用的坑。
  const hasRange = req.headers.has('range')
  const cacheKey = hasRange ? stripRange(req) : req
  const hit = await cache.match(cacheKey)
  // CORS 请求不能复用不透明（opaque）缓存，否则 canvas/媒体会判定跨域失败
  const usableHit = hit && !(req.mode === 'cors' && hit.type === 'opaque') && hit.status !== 206
  if (usableHit) return hit
  const res = await fetch(hasRange ? stripRange(req) : req)
  if (res && (res.ok || res.type === 'opaque') && res.status !== 206) {
    // 不要把不透明响应覆盖到已有的 CORS 缓存上
    if (!(req.mode === 'cors' && res.type === 'opaque')) {
      cache.put(cacheKey, res.clone()).catch(() => {})
    }
  }
  return res
}

/** 复制请求但去掉 Range 头（Cache API 拒绝存 206；全量响应才能兼顾在线与离线重放）。 */
function stripRange(req) {
  const headers = new Headers(req.headers)
  headers.delete('range')
  return new Request(req.url, {
    method: 'GET',
    mode: req.mode,
    credentials: req.credentials,
    headers,
  })
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
