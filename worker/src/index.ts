/**
 * UNiaoer API Worker（B2/B3）
 *
 * 路由（挂在 uniaoer.com/api/*，与前端同源）：
 *   GET /api/health              —— 健康检查
 *   GET /api/manifest            —— 题库索引（优先 R2 data/manifest.json，回退 Pages 静态）
 *   GET /api/questions?tier&type&count —— 按档位/题型返回候选物种池（客户端组装选项）
 *   GET /api/media/:id           —— 按 media.id 302 到 R2 公开地址
 *
 * 密钥：XC_API_KEY 由 `wrangler secret put` 注入（env.XC_API_KEY），仅在服务端使用。
 * 说明：/api/questions 的档位→常见度映射与 src/core/difficulty.ts 的 TIERS.commonness 保持一致。
 */

interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  MANIFEST_ORIGIN?: string
  XC_API_KEY?: string
  /** B6 管理接口密钥（wrangler secret put ADMIN_KEY） */
  ADMIN_KEY?: string
}

interface D1Result<T> {
  results: T[]
  success: boolean
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ success: boolean }>
}
interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface R2ObjectBody {
  body: ReadableStream
  httpMetadata?: { contentType?: string }
  text(): Promise<string>
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
}

interface SpeciesRow {
  id: string
  name_zh: string | null
  name_sci: string
  name_en: string | null
  taxon_id: number | null
  taxon_key: string | null
  family: string | null
  commonness: number
  rank_world: number | null
  rank_cn: number | null
  in_cn: number | null
  group_name: string | null
  migration: string | null
  iucn_category: string | null
  distribution_count: number | null
  playable_image: number
  playable_audio: number
  quiz_excluded: number
  desc: string | null
  location: string | null
  habit: string | null
  // 首图（内联；完整 5+5 由前端 assets 分片提供）
  img_url: string | null
  img_thumb_url: string | null
  img_xl_url: string | null
  img_avif_url: string | null
  img_thumbhash: string | null
  img_original_url: string | null
  img_source_id: string | null
  img_license: string | null
  img_license_raw: string | null
  img_author: string | null
  img_source: string | null
  img_source_url: string | null
  img_transcode: number | null
  // 首音
  aud_url: string | null
  aud_original_url: string | null
  aud_source_id: string | null
  aud_license: string | null
  aud_license_raw: string | null
  aud_author: string | null
  aud_source: string | null
  aud_source_url: string | null
  aud_quality: string | null
  aud_transcode: number | null
  rnd: number
}

/** 档位 → 允许的常见度（与 src/core/difficulty.ts TIERS 对齐） */
const TIER_COMMONNESS: Record<number, number[]> = {
  1: [1, 2],
  2: [1, 2, 3],
  3: [2, 3, 4],
  4: [3, 4],
  5: [3, 4],
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, x-admin-key',
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
      ...init.headers,
    },
  })
}

function clampInt(raw: string | null, min: number, max: number, def: number): number {
  const v = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(v)) return def
  return Math.max(min, Math.min(max, v))
}

/** 物种行 → 前端 BankSpecies 形状（media 由调用方补齐） */
function toSpeciesBase(r: SpeciesRow): Record<string, unknown> {
  const profile =
    r.group_name || r.migration || r.iucn_category || r.distribution_count != null
      ? {
          group: r.group_name ?? undefined,
          migration: r.migration ?? undefined,
          distribution:
            r.distribution_count != null
              ? { count: r.distribution_count, category: r.iucn_category ?? undefined }
              : undefined,
        }
      : undefined
  return {
    id: r.id,
    nameZh: r.name_zh ?? '',
    nameSci: r.name_sci,
    nameEn: r.name_en ?? undefined,
    taxonId: r.taxon_id ?? undefined,
    taxonKey: r.taxon_key ?? undefined,
    family: r.family ?? '',
    commonness: r.commonness,
    playableImage: r.playable_image === 1,
    playableAudio: r.playable_audio === 1,
    quizExcluded: r.quiz_excluded === 1,
    rankWorld: r.rank_world,
    rankCN: r.rank_cn,
    inCN: r.in_cn == null ? null : r.in_cn === 1,
    desc: r.desc ?? '',
    location: r.location ?? '',
    habit: r.habit ?? '',
    profile,
  }
}

/** 行内首图 → 前端 MediaAsset（字段名与前端一致；id 供错题本等引用） */
function inlineImage(r: SpeciesRow): Record<string, unknown> | null {
  if (!r.img_url) return null
  return {
    id: `${r.id}-image-1`,
    speciesId: r.id,
    type: 'image',
    url: r.img_url,
    thumbUrl: r.img_thumb_url ?? undefined,
    xlUrl: r.img_xl_url ?? undefined,
    avifUrl: r.img_avif_url ?? undefined,
    thumbhash: r.img_thumbhash ?? undefined,
    originalUrl: r.img_original_url ?? undefined,
    sourceId: r.img_source_id ?? undefined,
    license: r.img_license ?? undefined,
    licenseRaw: r.img_license_raw ?? undefined,
    author: r.img_author ?? undefined,
    source: r.img_source ?? undefined,
    sourceUrl: r.img_source_url ?? undefined,
    transcode: r.img_transcode === 1,
  }
}

/** 行内首音 → 前端 MediaAsset */
function inlineAudio(r: SpeciesRow): Record<string, unknown> | null {
  if (!r.aud_url) return null
  return {
    id: `${r.id}-audio-1`,
    speciesId: r.id,
    type: 'audio',
    url: r.aud_url,
    originalUrl: r.aud_original_url ?? undefined,
    sourceId: r.aud_source_id ?? undefined,
    license: r.aud_license ?? undefined,
    licenseRaw: r.aud_license_raw ?? undefined,
    author: r.aud_author ?? undefined,
    source: r.aud_source ?? undefined,
    sourceUrl: r.aud_source_url ?? undefined,
    quality: r.aud_quality ?? undefined,
    transcode: r.aud_transcode === 1,
  }
}

/**
 * 题库索引：优先 R2 快照，回退 Pages 静态。
 * 029 M1 起支持分层产物：/api/manifest → 完整层；/api/manifest-core → 启动层（默认前端使用）。
 * `name` 仅允许白名单文件名,避免路径穿越。
 */
async function handleManifest(env: Env, name = 'manifest.json'): Promise<Response> {
  const allowed = ['manifest.json', 'manifest-core.json', 'manifest-global.min.json']
  const file = allowed.includes(name) ? name : 'manifest.json'
  // 1) 优先 R2 上的 data/<file>（若已上传）
  const obj = await env.MEDIA.get(`data/${file}`)
  if (obj) {
    return new Response(await obj.text(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
        ...CORS,
      },
    })
  }
  // 2) 回退 Pages 静态文件（始终与部署同步）
  const origin = env.MANIFEST_ORIGIN || 'https://uniaoer.com'
  const upstream = await fetch(`${origin}/data/${file}`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit & { cf: Record<string, unknown> })
  if (!upstream.ok) {
    return json({ error: 'manifest_unavailable', status: upstream.status }, { status: 502 })
  }
  return new Response(await upstream.text(), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      ...CORS,
    },
  })
}

/**
 * 措施一:边缘缓存。
 *
 * `/api/questions` 的响应在**同一档位/题型/地区**下是可复用的（题库是静态的，
 * 随机性只影响"抽到哪几题"——用户明确接受题目可重复）。用 Cache API 在边缘
 * 缓存 30 分钟：同一时间窗内的并发/重复请求直接命中缓存，不落到 D1。
 *
 * 效果（100 日活的测算）：D1 读从 940 次查询 / ~680 万行 → 十几回源，降幅 >98%。
 * 缓存键含 tier/type/region/count，故不同档位互不干扰；地区过滤结果也各自缓存。
 *
 * TTL 300s → 1800s（031 D-031-1）：当前体量下 D1 读已 <1% 额度，收益是**余量**——
 * 突发并发时把回源次数按窗口再压缩 6 倍；日活上千后（030 §5.2）这是最便宜的一档
 * 免费额度杠杆。代价是题库重建后边缘池最多陈旧 30 分钟：需立即生效时把
 * QUESTIONS_CACHE_VERSION +1 重新部署（缓存键含版本段，旧条目自然失联）。
 *
 * 新鲜度不依赖 Cache API 对 Cache-Control 的解释：命中时按 x-cached-at 自行校验
 * 年龄（超龄视为 MISS 回源覆盖），保证 TTL 语义确定、可观测（x-cache-age 头）。
 *
 * 写入必须 `ctx.waitUntil`：响应返回后 Worker 的待处理任务会被取消，
 * 裸的 `cache.put(...)`（不 await）会被丢弃——那正是 2026-10-08 首版边缘缓存
 * 上线后每次仍 MISS 的原因（本地测不出，只有远端连续请求才暴露）。
 */
const QUESTIONS_CACHE_TTL = 1800
/** 缓存版本：需要强制失效旧缓存时 +1（随 Worker 重新部署生效）。 */
const QUESTIONS_CACHE_VERSION = 3

async function handleQuestionsCached(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  // 只缓存 GET（无 cookie/鉴权参与,题库对所有用户相同）
  const cache = await caches.open('uniaoer-api-questions')
  // 规范化缓存键：排除无关查询参数顺序差异（按固定顺序重建）
  const keyUrl = new URL(url.origin + url.pathname)
  for (const k of ['tier', 'type', 'region', 'count']) {
    const v = url.searchParams.get(k)
    if (v) keyUrl.searchParams.set(k, v)
  }
  keyUrl.searchParams.set('v', String(QUESTIONS_CACHE_VERSION))
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' })

  const hit = await cache.match(cacheKey)
  if (hit) {
    const cachedAt = Number(hit.headers.get('x-cached-at') || 0)
    const age = (Date.now() - cachedAt) / 1000
    if (cachedAt > 0 && age < QUESTIONS_CACHE_TTL) {
      const res = new Response(hit.body, hit)
      res.headers.set('x-cache', 'HIT')
      res.headers.set('x-cache-age', String(Math.round(age)))
      return res
    }
    // 超龄：落到下面的回源（cache.put 覆盖旧条目）
  }

  const res = await handleQuestions(env, url)
  if (!res.ok) return res
  const forCache = new Response(res.body, res)
  forCache.headers.set('cache-control', `public, max-age=${QUESTIONS_CACHE_TTL}`)
  forCache.headers.set('x-cached-at', String(Date.now()))
  forCache.headers.set('x-cache', 'MISS')
  // 写缓存不阻塞响应，但必须挂到 waitUntil——否则响应返回后写操作被运行时取消
  ctx.waitUntil(cache.put(cacheKey, forCache.clone()))
  return forCache
}

/**
 * 029 M4/M5:/api/questions —— 由 D1（派生读模型）按档位/题型/地区出候选池。
 *
 * 过滤链（036 定稿 2026-10-09，与前端 questionEngine 语义一致）：
 *   L1–L3 + 指定地区：**地区档位**（R2 `data/province-commonness/<CC>.json`）优先
 *     · 省码 → 省级分片 tiersByCode[省码]；国家码 → 国家级降级层（<CC>.country.json）
 *     · 严格档位（TIER_COMMONNESS[tier]）不足 → 放宽到**表内任意档位**（仍排除表外物种）
 *     · 表外 = 本地罕见/无记录（省表只收录该省有记录的物种）→ **剔除**（不回退全局 commonness）
 *   L1–L3 + 分片缺失：降级为区系短码（species-distribution，国家级"有没有"）+ 全局 commonness
 *   L4–L5 / region=ALL：全局 commonness（不做地区过滤，与前端 D-029-2 一致）
 *   两处共同：可玩（playable_image/audio 按题型） + quiz_excluded=0
 *
 * 返回候选物种（含 media），前端据此本地组装题面（不返回答案/选项——选项由前端按档位生成）。
 */
async function handleQuestions(env: Env, url: URL): Promise<Response> {
  const tier = clampInt(url.searchParams.get('tier'), 1, 5, 2)
  const type = url.searchParams.get('type') === 'audio' ? 'audio' : 'image'
  const count = clampInt(url.searchParams.get('count'), 1, 100, 10)
  const region = (url.searchParams.get('region') || 'ALL').toUpperCase()

  const commonness = TIER_COMMONNESS[tier] ?? TIER_COMMONNESS[2]!
  const playableCol = type === 'audio' ? 'aud_url' : 'img_url'
  const placeholders = commonness.map(() => '?').join(',')

  let rows: SpeciesRow[] = []
  let byTiers = false
  if (region !== 'ALL' && tier <= 3) {
    // ① 地区档位（036）：省/国家分片 → 严格档位；不足则放宽到表内任意档位
    const tiers = await regionTiers(env, region)
    if (tiers?.size) {
      const allowed = new Set(commonness)
      let ids = [...tiers].filter(([, t]) => allowed.has(t)).map(([id]) => id)
      if (ids.length < count) ids = [...tiers.keys()]
      rows = await sampleByIds(env, ids, playableCol, count)
      byTiers = true
    }
  }
  if (!byTiers) {
    // ② 旧路径：区系短码（分片缺失时降级）；L4/L5 或 ALL 则不做地区过滤
    const shortCodes = region !== 'ALL' && tier <= 3 ? await regionShortCodes(env, region) : null

    // 措施二：索引区间扫描替代 ORDER BY RANDOM()（后者扫完候选集再排序：L3 每轮 ~10,000 行）。
    // 做法：以随机 rnd 起点沿 idx_species_sample(commonness, rnd) 取一段，
    // 不足则从头补齐（wrap）；每次只读几十行。随机性来源 = 每次请求不同的起点。
    const need = shortCodes ? Math.max(count * 8, 200) : count
    const startAt = Math.random()
    const base = `FROM species
       WHERE commonness IN (${placeholders}) AND ${playableCol} IS NOT NULL AND quiz_excluded = 0`
    const sp = await env.DB.prepare(
      `SELECT * ${base} AND rnd >= ? ORDER BY rnd LIMIT ?`,
    )
      .bind(...commonness, startAt, need)
      .all<SpeciesRow>()

    let sampled = sp.results
    if (sampled.length < need) {
      // 环形补齐：从区间起点的另一端再取（保证低 rnd 值的物种也有机会被抽到）
      const more = await env.DB.prepare(`SELECT * ${base} AND rnd < ? ORDER BY rnd LIMIT ?`)
        .bind(...commonness, startAt, need - sampled.length)
        .all<SpeciesRow>()
      sampled = sampled.concat(more.results)
    }

    if (shortCodes) {
      const set = new Set(shortCodes)
      sampled = sampled
        .filter((r) => {
          const key = r.taxon_key || ''
          const code = key.startsWith('avibase-') ? key.slice(8) : ''
          return code && set.has(code)
        })
        .slice(0, count)
    } else {
      sampled = sampled.slice(0, count)
    }
    rows = sampled
  }

  const species = rows.map((r) => {
    const image = inlineImage(r)
    const audio = inlineAudio(r)
    return { ...toSpeciesBase(r), images: image ? [image] : [], audios: audio ? [audio] : [], image, audio }
  })

  // 029 M4:干扰项名字候选（同样走索引区间扫描，只取 6 列，扫行数极小）
  const targetIds = new Set(species.map((s) => s.id))
  let distractors: Record<string, unknown>[] = []
  try {
    const dStart = Math.random()
    const dBase = `FROM species WHERE commonness IN (${placeholders}) AND quiz_excluded = 0`
    const d = await env.DB.prepare(
      `SELECT id,name_zh,name_sci,name_en,family,commonness ${dBase} AND rnd >= ? ORDER BY rnd LIMIT ?`,
    )
      .bind(...commonness, dStart, 120)
      .all<Pick<SpeciesRow, 'id' | 'name_zh' | 'name_sci' | 'name_en' | 'family' | 'commonness'>>()
    let dRows = d.results
    if (dRows.length < 120) {
      const more = await env.DB.prepare(
        `SELECT id,name_zh,name_sci,name_en,family,commonness ${dBase} AND rnd < ? ORDER BY rnd LIMIT ?`,
      )
        .bind(...commonness, dStart, 120 - dRows.length)
        .all<Pick<SpeciesRow, 'id' | 'name_zh' | 'name_sci' | 'name_en' | 'family' | 'commonness'>>()
      dRows = dRows.concat(more.results)
    }
    distractors = dRows
      .filter((r) => !targetIds.has(r.id))
      .map((r) => ({
        id: r.id,
        nameZh: r.name_zh ?? '',
        nameSci: r.name_sci,
        nameEn: r.name_en ?? undefined,
        family: r.family ?? '',
        commonness: r.commonness,
      }))
  } catch {
    distractors = []
  }

  return json({ tier, type, region, count: species.length, species, distractors })
}

/**
 * 地区 → AviList 短码集合（029 M5）。
 * 从 R2 读 species-distribution.json（构建产物已上传）；对象缺失/解析失败返回 null
 * 表示"区系不可用"→ 调用方降级为不过滤。结果按 region 缓存 10 分钟（Worker 实例内）。
 */
const regionCodesCache = new Map<string, { at: number; codes: string[] | null }>()
async function regionShortCodes(env: Env, region: string): Promise<string[] | null> {
  const hit = regionCodesCache.get(region)
  if (hit && Date.now() - hit.at < 600_000) return hit.codes
  let codes: string[] | null = null
  try {
    const obj = await env.MEDIA.get('data/species-distribution.json')
    if (obj) {
      const doc = JSON.parse(await obj.text()) as { byCountry?: Record<string, string[]> }
      // 省码（CN-11）→ 所属国：区系层是国家级的；与前端 countryOfRegion 同语义。缓存键仍用原 region。
      const cc = region.includes('-') ? (region.split('-')[0] ?? region) : region
      const list = doc.byCountry?.[cc]
      codes = Array.isArray(list) ? list : []
    }
  } catch {
    codes = null
  }
  regionCodesCache.set(region, { at: Date.now(), codes })
  return codes
}

/**
 * 036 修法 b：地区**档位**（province-commonness 分片）→ 出题候选按省过滤。
 *
 * 数据：R2 `data/province-commonness/<CC>.json`（省级 tiersByCode）与
 *      `data/province-commonness/<CC>.country.json`（国家级降级层）。
 * 语义（2026-10-09 定稿，与前端 questionEngine 一致）：
 *   · 表内且档位落在 TIER_COMMONNESS[tier] → 本地常见，出题；
 *   · 表内但档位不匹配 → 剔除；
 *   · 表外 → **视为本地罕见**（省表只收录该省有记录的物种，不入表=该省罕见/无记录）→ 剔除。
 * 返回 null（分片缺失/解析失败）→ 调用方按"无地区档位"降级（保持可用性，绝不 500）。
 */
const regionTiersCache = new Map<string, { at: number; tiers: Map<string, number> | null }>()
async function regionTiers(env: Env, region: string): Promise<Map<string, number> | null> {
  const hit = regionTiersCache.get(region)
  if (hit && Date.now() - hit.at < 600_000) return hit.tiers
  let tiers: Map<string, number> | null = null
  try {
    const m = /^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/.exec(region)
    if (m) {
      const cc = m[1]!
      const code = m[2] ? `${m[1]}-${m[2]}` : null
      if (code) {
        const obj = await env.MEDIA.get(`data/province-commonness/${cc}.json`)
        if (obj) {
          const doc = JSON.parse(await obj.text()) as {
            tiersByCode?: Record<string, Record<string, number>>
          }
          const map = doc.tiersByCode?.[code]
          if (map) tiers = new Map(Object.entries(map))
        }
      }
      if (!tiers) {
        const obj = await env.MEDIA.get(`data/province-commonness/${cc}.country.json`)
        if (obj) {
          const doc = JSON.parse(await obj.text()) as { tiers?: Record<string, number> }
          if (doc.tiers) tiers = new Map(Object.entries(doc.tiers))
        }
      }
    }
  } catch {
    tiers = null
  }
  regionTiersCache.set(region, { at: Date.now(), tiers })
  return tiers
}

/**
 * 按 id 白名单取样候选（036 地区档位路径）。
 * id 列表来自 R2 分片（单省 ≤ 538、国家级 ≤ ~2,600），经 json_each 展开成行；
 * 与索引区间扫描同口径：随机起点 + 环形补齐（边缘缓存 30 分钟窗口内可复用）。
 */
async function sampleByIds(
  env: Env,
  ids: string[],
  playableCol: string,
  count: number,
): Promise<SpeciesRow[]> {
  if (!ids.length) return []
  const json = JSON.stringify(ids)
  const need = Math.min(ids.length, Math.max(count * 8, 200))
  const startAt = Math.random()
  const base = `FROM species
     WHERE id IN (SELECT value FROM json_each(?)) AND ${playableCol} IS NOT NULL AND quiz_excluded = 0`
  const head = await env.DB.prepare(`SELECT * ${base} AND rnd >= ? ORDER BY rnd LIMIT ?`)
    .bind(json, startAt, need)
    .all<SpeciesRow>()
  let rows = head.results
  if (rows.length < need) {
    const tail = await env.DB.prepare(`SELECT * ${base} AND rnd < ? ORDER BY rnd LIMIT ?`)
      .bind(json, startAt, need - rows.length)
      .all<SpeciesRow>()
    rows = rows.concat(tail.results)
  }
  return rows.slice(0, count)
}

/**
 * 媒体重定向（历史端点）。2026-10-08 起媒体直连 R2（manifest/内联字段给的是绝对地址），
 * 前端已不再调用本端点；D1 的 media 表同步移除（写入额度优化,见 schema.sql 说明）。
 */
async function handleMedia(_env: Env, id: string): Promise<Response> {
  return json({ error: 'gone', id, hint: 'media is served directly from R2' }, { status: 410 })
}

// ---------- B6 报错 / 大众评审 ----------

const REPORT_REASONS = new Set(['image', 'audio', 'answer', 'quality', 'other'])
const REPORT_STATUSES = new Set(['open', 'published', 'fixed', 'rejected'])

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}
function clientIdOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length >= 8 && s.length <= 64 ? s : null
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 提交报错（公开）：状态 open，等待管理方处理/大众评审 */
async function handleSubmitReport(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  const clientId = clientIdOf(body.clientId)
  if (!clientId) return json({ error: 'invalid_client' }, { status: 400 })
  const reason = typeof body.reason === 'string' ? body.reason : ''
  if (!REPORT_REASONS.has(reason)) return json({ error: 'invalid_reason' }, { status: 400 })

  const now = Date.now()
  // 简单防刷：同一设备每小时最多 20 条
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reports WHERE client_id = ? AND created_at > ?',
  )
    .bind(clientId, now - 3600_000)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= 20) return json({ error: 'rate_limited' }, { status: 429 })

  const id = str(body.id, 64) ?? crypto.randomUUID()
  await env.DB.prepare(
    `INSERT OR IGNORE INTO reports
      (id,created_at,updated_at,species_id,species_name,sci,question_type,media_url,reason,suggested_answer,note,status,client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
  )
    .bind(
      id,
      now,
      now,
      str(body.speciesId, 100),
      str(body.speciesName, 100),
      str(body.sci, 120),
      str(body.questionType, 16),
      str(body.mediaUrl, 600),
      reason,
      str(body.suggestedAnswer, 100),
      str(body.note, 1000),
      clientId,
    )
    .run()
  return json({ ok: true, id }, { status: 201 })
}

/** 公开列表：**仅已发布**（published）；待处理/驳回不公开，按时间倒序 */
async function handlePublicReports(env: Env, url: URL): Promise<Response> {
  const limit = clampInt(url.searchParams.get('limit'), 1, 50, 20)
  const offset = clampInt(url.searchParams.get('offset'), 0, 10000, 0)
  const species = str(url.searchParams.get('species'), 100)
  const where = species ? "status = 'published' AND species_id = ?" : "status = 'published'"
  const binds = species ? [species] : []
  const rows = await env.DB.prepare(
    `SELECT id,created_at,species_id,species_name,sci,question_type,media_url,reason,
            suggested_answer,note,status,up,down
     FROM reports WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>()
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>()
  return json({ reports: rows.results, total: total?.n ?? 0 })
}

/** 投票（+1/-1，每设备每报错一票，可改票） */
async function handleVote(request: Request, env: Env, reportId: string): Promise<Response> {
  const body = await readBody(request)
  const clientId = clientIdOf(body.clientId)
  const value = body.value === 1 || body.value === -1 ? body.value : null
  if (!clientId) return json({ error: 'invalid_client' }, { status: 400 })
  if (value === null) return json({ error: 'invalid_value' }, { status: 400 })

  const exists = await env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(reportId).first()
  if (!exists) return json({ error: 'not_found' }, { status: 404 })

  const now = Date.now()
  const votes = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM report_votes WHERE client_id = ? AND created_at > ?',
  )
    .bind(clientId, now - 3600_000)
    .first<{ n: number }>()
  if ((votes?.n ?? 0) >= 500) return json({ error: 'rate_limited' }, { status: 429 })

  await env.DB.prepare(
    `INSERT INTO report_votes (report_id,client_id,value,created_at) VALUES (?,?,?,?)
     ON CONFLICT(report_id,client_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
  )
    .bind(reportId, clientId, value, now)
    .run()

  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS down
     FROM report_votes WHERE report_id = ?`,
  )
    .bind(reportId)
    .first<{ up: number | null; down: number | null }>()
  const up = counts?.up ?? 0
  const down = counts?.down ?? 0
  await env.DB.prepare('UPDATE reports SET up = ?, down = ?, updated_at = ? WHERE id = ?')
    .bind(up, down, now, reportId)
    .run()
  return json({ ok: true, up, down, myVote: value })
}

/**
 * ── 035 单轮成绩分享（用户主动分享；D-035-1~6 已拍板）────────────────────
 *
 * 设计要点：
 *  · 载荷**白名单化**：客户端只能提交固定形状（一轮 items），服务端逐字段裁剪长度，
 *    并强制 mediaUrl 属于本站媒体域——避免被当成任意图床/跳转跳板（docs/035 §2.3）。
 *  · id 不可猜测：base62 12 位（≈71 bit）；**不用自增**（否则可枚举他人成绩）。
 *  · 撤回凭据：创建时下发 32 位 hex 管理令牌，库内**只存 SHA-256**；
 *    撤回时比对哈希（跨设备凭令牌仍可撤回，D-035-6）。
 *  · 无 expires_at（D-035-3 永久有效）；撤回 = hidden=1（软删，公开读 404）。
 *  · 写入成本：1 行 + 2 索引 = 3 行/次（docs/032 额度纪律）。
 */
const SHARE_MEDIA_PREFIX = 'https://bird.wewalk.world/media/'
const SHARE_MAX_ITEMS = 20
const SHARE_MAX_BYTES = 32 * 1024

/** 不可猜测短 id：12 位 base62（crypto 随机；去掉易混字符） */
function shareId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 单条 item 的白名单裁剪（返回 null = 该条不可用，整单拒绝） */
function sanitizeShareItem(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const it = raw as Record<string, unknown>
  const mediaUrl = str(it.mediaUrl, 600)
  // 必须是本站 R2 媒体域（防任意图床/跳转）
  if (!mediaUrl || !mediaUrl.startsWith(SHARE_MEDIA_PREFIX)) return null
  const type = it.type === 'audio' ? 'audio' : it.type === 'image' ? 'image' : null
  if (!type) return null
  const answer = str(it.answer, 120)
  if (!answer) return null
  return {
    speciesId: str(it.speciesId, 100),
    answer,
    sci: str(it.sci, 160),
    family: str(it.family, 120),
    type,
    chosen: str(it.chosen, 120),
    chosenId: str(it.chosenId, 100),
    correct: it.correct === true,
    timedOut: it.timedOut === true,
    mediaUrl,
    thumbUrl: str(it.thumbUrl, 600),
    source: str(it.source, 60),
    author: str(it.author, 200),
    license: str(it.license, 60),
  }
}

/** 创建分享：公开可访问（D-035-1）；返回 id + 管理令牌（仅此一次明文下发） */
async function handleCreateShare(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  const clientId = clientIdOf(body.clientId)
  if (!clientId) return json({ error: 'invalid_client' }, { status: 400 })

  const mode = body.mode === 'audio' ? 'audio' : body.mode === 'image' ? 'image' : null
  if (!mode) return json({ error: 'invalid_mode' }, { status: 400 })
  const tier = Number(body.tier)
  const total = Number(body.total)
  const correct = Number(body.correct)
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) return json({ error: 'invalid_tier' }, { status: 400 })
  if (!Number.isInteger(total) || total < 1 || total > SHARE_MAX_ITEMS) {
    return json({ error: 'invalid_total' }, { status: 400 })
  }
  if (!Number.isInteger(correct) || correct < 0 || correct > total) {
    return json({ error: 'invalid_correct' }, { status: 400 })
  }
  const itemsRaw = Array.isArray(body.items) ? body.items : []
  if (!itemsRaw.length || itemsRaw.length > SHARE_MAX_ITEMS) {
    return json({ error: 'invalid_items' }, { status: 400 })
  }
  const items: Record<string, unknown>[] = []
  for (const raw of itemsRaw) {
    const it = sanitizeShareItem(raw)
    if (!it) return json({ error: 'invalid_item' }, { status: 400 })
    items.push(it)
  }

  const payload = JSON.stringify({
    v: 1,
    mode,
    tier,
    total,
    correct,
    accuracy: Math.round((correct / total) * 100),
    durationMs: Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : null,
    locale: str(body.locale, 12) ?? 'zh-CN',
    items,
  })
  if (payload.length > SHARE_MAX_BYTES) return json({ error: 'payload_too_large' }, { status: 413 })

  const now = Date.now()
  // 防刷：同设备每天最多 30 条（远高于正常使用；见 docs/035 §2.2）
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM round_shares WHERE client_id = ? AND created_at > ?',
  )
    .bind(clientId, now - 86_400_000)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= 30) return json({ error: 'rate_limited' }, { status: 429 })

  const id = shareId()
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const tokenHash = await sha256Hex(token)
  await env.DB.prepare(
    `INSERT INTO round_shares
       (id,created_at,mode,tier,total,correct,accuracy,nickname,payload,token_hash,client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      now,
      mode,
      tier,
      total,
      correct,
      Math.round((correct / total) * 100),
      str(body.nickname, 24),
      payload,
      tokenHash,
      clientId,
    )
    .run()
  return json({ ok: true, id, token }, { status: 201 })
}

/** 公开读取：hidden=1 → 404（撤回）；边缘缓存见路由包装 */
async function handleGetShare(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id,created_at,mode,tier,total,correct,accuracy,nickname,payload,hidden,view_count FROM round_shares WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: string
      created_at: number
      mode: string
      tier: number
      total: number
      correct: number
      accuracy: number
      nickname: string | null
      payload: string
      hidden: number
      view_count: number | null
    }>()
  if (!row || row.hidden === 1) return json({ error: 'not_found' }, { status: 404 })
  let payload: unknown = null
  try {
    payload = JSON.parse(row.payload)
  } catch {
    return json({ error: 'corrupt_payload' }, { status: 500 })
  }
  return json({
    ok: true,
    share: {
      id: row.id,
      at: row.created_at,
      mode: row.mode,
      tier: row.tier,
      total: row.total,
      correct: row.correct,
      accuracy: row.accuracy,
      nickname: row.nickname,
      payload,
      /** 2026-10-09：分享页浏览次数（打点见 POST /api/shares/:id/view） */
      views: row.view_count ?? 0,
    },
  })
}

/** 撤回：凭管理令牌（只比对 SHA-256；不依赖设备）→ 软删 */
async function handleDeleteShare(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readBody(request)
  const token = str(body.token, 128)
  if (!token) return json({ error: 'invalid_token' }, { status: 400 })
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare('SELECT id, token_hash FROM round_shares WHERE id = ?')
    .bind(id)
    .first<{ id: string; token_hash: string }>()
  if (!row) return json({ error: 'not_found' }, { status: 404 })
  if (row.token_hash !== tokenHash) return json({ error: 'unauthorized' }, { status: 401 })
  await env.DB.prepare('UPDATE round_shares SET hidden = 1 WHERE id = ?').bind(id).run()
  return json({ ok: true, id, hidden: true })
}

/** 分享页浏览计数（2026-10-09 启用 view_count）：前端页面加载时打点，仅统计存在的未撤回分享 */
async function handleShareView(request: Request, env: Env, id: string): Promise<Response> {
  try {
    await env.DB.prepare(
      'UPDATE round_shares SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ? AND hidden = 0',
    )
      .bind(id)
      .run()
    // 独立访客同样登记（分享页是主要外部入口，见 docs/028 §3.4）
    await recordVisitor(env, request, new Date().toISOString().slice(0, 10))
  } catch {
    /* 计数失败不影响浏览：静默 */
  }
  return new Response(null, { status: 204, headers: CORS })
}

// ---------- 028 匿名计量 ----------

/**
 * 事件白名单（docs/028 §2）：属性值必须落在枚举内（越界丢弃该属性，事件本身仍计数）。
 * 新增事件/属性时只改这里——前端 metrics.ts 同名单，两处一起改。
 *
 * `badge_earned` / `title_earned`（2026-10-09 公开看板需要）：徽章 id 与称号轨道 id 是
 * **前端固定枚举**（`src/core/badges.ts` BADGES / `src/core/titles.ts` TITLE_TRACKS），
 * 故此处逐一列出做硬校验（避免任意字符串污染 props 主键）；改动那两张表时同步这里。
 */
const BADGE_IDS = [
  'first-round', 'perfect', 'hundred', 'listener', 'expert', 'beginner-birder', 'streak',
  'hell-first', 'audio-perfect', 'learned-revenge', 'five-rounds', 'thousand', 'veteran-fifty',
  'collection-master', 'collection-all', 'dual-perfect', 'stable-five', 'audio-correct-200',
  'review-correct-30', 'review-five', 'hell-ten', 'cross-streak-100', 'omniscient',
  'all-tier-perfect', 'hell-perfect', 'perfect-three', 'hell-coach', 'wrong-terminator',
  'hundred-rounds', 'night-owl', 'lark', 'escaped-quit', 'triple-forgiven', 'phoenix',
]
const TITLE_TRACKS = ['volume', 'collection', 'streak', 'perfect', 'audio', 'hell', 'rank', 'species-friend']

const METRIC_EVENTS: Record<string, Record<string, string[]>> = {
  session_start: {},
  page_view: {
    category: ['quiz', 'region', 'catalog', 'species', 'profile', 'faq', 'reports', 'stats', 'other'],
  },
  quiz_complete: {
    mode: ['image', 'audio'],
    tier: ['1', '2', '3', '4', '5'],
  },
  report_submit: {},
  poster_create: {},
  badge_earned: { badge: BADGE_IDS },
  title_earned: {
    track: TITLE_TRACKS,
    level: ['1', '2', '3', '4', '5'],
  },
}

/** 事件体上限（字节）：白名单事件 + ≤3 枚举属性，300 足够；超过静默丢弃 */
const METRIC_MAX_BYTES = 300

/**
 * 简易内存限流（按 IP；**不落库、不记录**，仅防刷）。
 * 单 IP 60 次/分钟；超限静默 202（调用方不重试）。Map 超 5000 条时清理过期项防内存膨胀。
 */
const metricsHits = new Map<string, number[]>()
function rateAllowed(bucket: string, perMinute: number): boolean {
  const now = Date.now()
  const arr = (metricsHits.get(bucket) ?? []).filter((t) => now - t < 60_000)
  if (arr.length >= perMinute) {
    metricsHits.set(bucket, arr)
    return false
  }
  arr.push(now)
  metricsHits.set(bucket, arr)
  if (metricsHits.size > 5000) {
    for (const [k, v] of metricsHits) {
      if (!v.length || now - v[v.length - 1]! > 60_000) metricsHits.delete(k)
    }
  }
  return true
}
const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown'

// ---------- 独立访客（日去重；只存不可逆哈希，见 schema.sql 与 docs/028 §3.4）----------

/**
 * 当日盐（存 meta，按日轮换）：盐只在内存缓存 10 分钟，避免每次上报都读 D1。
 * 轮换意义：**不同日的哈希不可关联** → 无法跨日追踪同一人（隐私口径）。
 */
const saltCache = new Map<string, { at: number; salt: string }>()
async function daySalt(env: Env, day: string): Promise<string | null> {
  const hit = saltCache.get(day)
  if (hit && Date.now() - hit.at < 600_000) return hit.salt
  try {
    const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?')
      .bind(`stats_salt_${day}`)
      .first<{ value: string }>()
    if (row?.value) {
      saltCache.set(day, { at: Date.now(), salt: row.value })
      return row.value
    }
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    await env.DB.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)')
      .bind(`stats_salt_${day}`, salt)
      .run()
    saltCache.set(day, { at: Date.now(), salt })
    return salt
  } catch {
    return null // 读不到盐 → 本次不计独立访客（不影响其他计数）
  }
}

/**
 * 记一个独立访客（当日去重）。**IP/UA 只在此处内存参与一次哈希，不落库**；
 * 落库的只有 `sha256(盐|日|IP|UA)` 的前 32 位 hex（不可逆、不可跨日关联）。
 */
async function recordVisitor(env: Env, request: Request, day: string): Promise<void> {
  const salt = await daySalt(env, day)
  if (!salt) return
  const ua = request.headers.get('user-agent') ?? ''
  const ip = clientIp(request)
  const hash = (await sha256Hex(`${salt}|${day}|${ip}|${ua}`)).slice(0, 32)
  try {
    const res = await env.DB.prepare('INSERT OR IGNORE INTO metrics_visitors (day, vhash) VALUES (?,?)')
      .bind(day, hash)
      .run()
    // changes=1 → 当天首次见到这个（不可逆）哈希 → 独立访客 +1
    if (res.meta?.changes) {
      await env.DB.prepare(
        `INSERT INTO metrics_daily (day, event, props, n) VALUES (?, 'visitor_unique', '', 1)
         ON CONFLICT(day, event, props) DO UPDATE SET n = n + 1`,
      )
        .bind(day)
        .run()
    }
  } catch {
    /* 静默：去重表异常不影响其他计数 */
  }
}

/** 属性规范化：只保留白名单枚举值，按 key 排序 → 'mode=image;tier=2'（缓存键稳定） */
function normalizeMetricProps(spec: Record<string, string[]>, raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const src = raw as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(spec).sort()) {
    const v = src[key]
    if (typeof v !== 'string') continue
    if (spec[key]!.includes(v)) parts.push(`${key}=${v}`)
  }
  return parts.join(';')
}

/**
 * GET /api/geo —— 粗定位（039 P1「附近观鸟点」的默认定位来源）。
 *
 * 位置取自 Cloudflare 注入的 `request.cf`（IP 归属地），**四舍五入到 0.05°（≈5km）**后返回：
 *  - **不落库**：不读也不写任何表；只在本次请求的内存里算一次；
 *  - **不进日志**：本函数不 console.*，也不带任何可关联标识返回；
 *  - **不可缓存**：响应 `no-store`（位置因人而异，缓存会串味；且我们不想在边缘留下副本）。
 * 客户端拿到后只放在页面内存里算距离。取不到（代理/某些移动网络无 cf 数据）→ 返回
 * `{ ok: true, located: false }`，前端回退到手动选地区。
 *
 * 隐私口径与 docs/028（计量）一致：不追踪、不画像；文案见设置页与 /nearby 页。
 */
function handleGeo(request: Request): Response {
  // request.cf 是 Cloudflare 运行时属性；类型上不在标准 Request 里，故按需读取
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf
  const lat = Number(cf?.latitude)
  const lng = Number(cf?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return json({ ok: true, located: false })
  }
  const round = (v: number) => Math.round(v * 20) / 20 // 0.05° 步长
  return json({
    ok: true,
    located: true,
    lat: round(lat),
    lng: round(lng),
    // 精度提示（前端文案用）：0.05° ≈ 5km
    precisionDeg: 0.05,
    country: typeof cf?.country === 'string' ? cf.country : null,
  })
}

/** POST /api/metrics：公开上报（事件计数；无 PII）。所有异常路径静默，绝不 5xx 打扰用户 */
async function handleMetrics(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const ip = clientIp(request)
  if (!rateAllowed(`m:${ip}`, 60)) return new Response(null, { status: 202, headers: CORS })
  let raw = ''
  try {
    raw = await request.text()
  } catch {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (raw.length > METRIC_MAX_BYTES) return new Response(null, { status: 204, headers: CORS })
  let body: { e?: unknown; p?: unknown }
  try {
    body = JSON.parse(raw) as { e?: unknown; p?: unknown }
  } catch {
    return new Response(null, { status: 204, headers: CORS })
  }
  const event = typeof body.e === 'string' ? body.e : ''
  const spec = METRIC_EVENTS[event]
  if (!spec) return new Response(null, { status: 204, headers: CORS }) // 非白名单：静默丢弃
  const props = normalizeMetricProps(spec, body.p)
  const day = new Date().toISOString().slice(0, 10)
  // 独立访客（2026-10-09）：每个上报都尝试登记（当日哈希去重；只存不可逆哈希）。
  // 与事件计数并行（waitUntil 不阻塞响应）。
  ctx?.waitUntil(recordVisitor(env, request, day))
  try {
    // 原子自增（无读改写竞态）；每事件 1 行写
    await env.DB.prepare(
      `INSERT INTO metrics_daily (day, event, props, n) VALUES (?, ?, ?, 1)
       ON CONFLICT(day, event, props) DO UPDATE SET n = n + 1`,
    )
      .bind(day, event, props)
      .run()
  } catch {
    /* 写入失败（如额度）：静默丢弃，不影响用户 */
  }
  return new Response(null, { status: 204, headers: CORS })
}

/** GET /api/metrics/summary?days=30（管理）：按日聚合，供人工回填 docs/028 §6 */
async function handleMetricsSummary(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 })
  const days = clampInt(url.searchParams.get('days'), 1, 365, 30)
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const rows = await env.DB.prepare(
    'SELECT day, event, props, n FROM metrics_daily WHERE day >= ? ORDER BY day DESC, event, props',
  )
    .bind(since)
    .all<{ day: string; event: string; props: string; n: number }>()
  const totals: Record<string, number> = {}
  for (const r of rows.results) totals[r.event] = (totals[r.event] ?? 0) + r.n
  return json({ days, since, totals, rows: rows.results })
}

// ---------- 035 分享页社交预览（OG）----------

/** HTML 转义（昵称/文案来自用户数据，注入前必须转义） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * `/s/:id` 的 OG 注入（2026-10-09）：
 * 社交平台爬虫不执行 JS，SPA 的 og:image 拿不到分享内容 → 由 Worker 在 HTML 壳里注入
 * 「标题/描述/首图」的 og meta（图片直接用该轮首张题图的 thumb，正是分享内容本身）。
 *
 * 失败降级：拿不到 HTML 壳 → 302 回首页；分享不存在/已撤回 → 原样壳（SPA 会渲染 404 页）。
 * 内容不缓存（撤回要即时生效）；壳本身由 Pages 承担，未额外读 D1 行（1 行 SELECT）。
 */
async function handleSharePage(request: Request, env: Env, id: string): Promise<Response> {
  const origin = env.MANIFEST_ORIGIN || 'https://uniaoer.com'
  let html: string
  try {
    const res = await fetch(`${origin}/`, { headers: { accept: 'text/html' }, cf: { cacheTtl: 300 } } as RequestInit)
    if (!res.ok) throw new Error(String(res.status))
    html = await res.text()
  } catch {
    return Response.redirect(`${origin}/`, 302)
  }

  const row = await env.DB.prepare(
    'SELECT nickname, payload, hidden, view_count FROM round_shares WHERE id = ?',
  )
    .bind(id)
    .first<{ nickname: string | null; payload: string; hidden: number; view_count: number }>()

  let title = 'UNiaoer'
  let description = 'UNiaoer · 鸟语识别：看图认鸟 / 听音认鸟'
  let image: string | null = null
  if (row && row.hidden !== 1) {
    try {
      const p = JSON.parse(row.payload) as {
        mode?: string
        tier?: number
        total?: number
        correct?: number
        accuracy?: number
        locale?: string
        items?: { type?: string; thumbUrl?: string | null; mediaUrl?: string }[]
      }
      const en = String(p.locale || '').startsWith('en')
      const modeLabel = p.mode === 'audio' ? (en ? 'Sound quiz' : '听音认鸟') : en ? 'Photo quiz' : '看图认鸟'
      const score = `${p.correct ?? 0}/${p.total ?? 0}`
      const who = row.nickname ? (en ? `${row.nickname}'s` : `${row.nickname} 的`) : en ? '' : ''
      title = en
        ? `${who ? who + ' ' : ''}bird-ID score · UNiaoer`
        : `${who}认鸟成绩 · UNiaoer`
      description = `${modeLabel} L${p.tier ?? '?'} · ${score}（${p.accuracy ?? 0}%）`
      const first = (p.items ?? []).find((it) => it.type === 'image' && (it.thumbUrl || it.mediaUrl))
      image = first ? (first.thumbUrl || first.mediaUrl || null) : null
    } catch {
      /* 载荷损坏：用默认文案 */
    }
  } else {
    title = 'UNiaoer · 链接不可用'
    description = '该分享已撤回或不存在'
  }

  const url = `${origin}/s/${encodeURIComponent(id)}`
  const metas = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
    image ? `<meta name="twitter:card" content="summary_large_image" />` : `<meta name="twitter:card" content="summary" />`,
    `<meta name="robots" content="noindex" id="uniaoer-robots-noindex" />`,
  ]
    .filter(Boolean)
    .join('\n    ')

  // 去掉模板里的默认 og:*（避免与注入重复）与旧 title，再统一插入 head 末尾
  const out = html
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, '')
    .replace(/<title>[^<]*<\/title>\s*/, '')
    .replace('</head>', `  ${metas}\n  </head>`)

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  return new Response(request.method === 'HEAD' ? null : out, { status: 200, headers })
}

// ---------- 028 公开统计看板（/api/stats/public）----------

/** 公开看板缓存 TTL：1 小时（用户 2026-10-09 要求"压力不大就一小时一次"） */
const PUBLIC_STATS_TTL = 3600
/** 看板使用的 Cache API key（与 /api/questions 的缓存桶分开，避免规则互相干扰） */
const PUBLIC_STATS_CACHE = 'uniaoer-api-stats'

/**
 * GET /api/stats/public —— 公开统计（无需密钥；**只输出聚合计数**，无任何个人/运行期信息）。
 *
 * 暴露原则（docs/028 §3.4）：
 *   · 公开：累计事件计数、近 N 日日序列、按类目/档位分布、徽章与称号**获取计数**。
 *   · 不公开：精确 IP、单次会话明细、分享者的个人数据、任何可关联个人的键。
 *   · 独立访客是"按日哈希去重"的数字（跨日不可关联），非精确人数（口径见 schema.sql）。
 *
 * 新鲜度：边缘缓存 1 小时（命中打 `x-stats-cache: HIT`），回源时按需聚合。
 * 回源成本：≤3 次小查询（聚合扫描 metrics_daily 近窗口 + 两个 DISTRIBUTION 分组），
 * 全部走主键/小表；日写入仅几十行，压力可忽略。
 */
async function handlePublicStats(env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const days = clampInt(url.searchParams.get('days'), 7, 90, 30)
  const cache = await caches.open(PUBLIC_STATS_CACHE)
  const cacheKey = new Request(`${url.origin}/api/stats/public?days=${days}`, { method: 'GET' })
  const hit = await cache.match(cacheKey)
  if (hit) {
    const cachedAt = Number(hit.headers.get('x-stats-cached-at') || 0)
    if (cachedAt > 0 && (Date.now() - cachedAt) / 1000 < PUBLIC_STATS_TTL) {
      const res = new Response(hit.body, hit)
      res.headers.set('x-stats-cache', 'HIT')
      return res
    }
  }

  const today = new Date()
  const since = new Date(today.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  try {
    const [series, byEvent, badges, titles] = await Promise.all([
      env.DB.prepare(
        'SELECT day, event, SUM(n) AS n FROM metrics_daily WHERE day >= ? GROUP BY day, event ORDER BY day',
      )
        .bind(since)
        .all<{ day: string; event: string; n: number }>(),
      env.DB.prepare('SELECT event, SUM(n) AS n FROM metrics_daily GROUP BY event')
        .all<{ event: string; n: number }>(),
      env.DB.prepare(
        "SELECT props, SUM(n) AS n FROM metrics_daily WHERE event = 'badge_earned' GROUP BY props ORDER BY n DESC",
      )
        .all<{ props: string; n: number }>(),
      env.DB.prepare(
        "SELECT props, SUM(n) AS n FROM metrics_daily WHERE event = 'title_earned' GROUP BY props ORDER BY n DESC",
      )
        .all<{ props: string; n: number }>(),
    ])

    const totals: Record<string, number> = {}
    for (const r of byEvent.results) totals[r.event] = r.n

    /** props 串 'a=b;c=d' → 对象 */
    const parseProps = (s: string): Record<string, string> =>
      Object.fromEntries(
        s
          .split(';')
          .filter(Boolean)
          .map((kv) => {
            const i = kv.indexOf('=')
            return i > 0 ? [kv.slice(0, i), kv.slice(i + 1)] : [kv, '']
          }),
      )

    const out = {
      generatedAt: new Date().toISOString(),
      days,
      since,
      /** 累计（自上线起，全时段） */
      totals,
      /** 近 N 日日序列：day × event */
      series: series.results,
      badges: badges.results.map((r) => ({ ...parseProps(r.props), n: r.n })),
      titles: titles.results.map((r) => ({ ...parseProps(r.props), n: r.n })),
      /** 口径说明（前端直接展示，避免"数字怎么来的"疑问） */
      notes: {
        visitor:
          '独立访客为按日去重的匿名计数（日盐哈希，IP/UA 不落库、跨日不可关联）；非精确人数。',
        scope: '仅统计本站匿名事件；成绩/档案仍只存在各自设备。',
      },
    }
    const res = json(out, {
      headers: {
        'cache-control': `public, max-age=${PUBLIC_STATS_TTL}`,
        'x-stats-cache': 'MISS',
        'x-stats-cached-at': String(Date.now()),
      },
    })
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return res
  } catch {
    // 只读聚合失败（如首次部署表尚未生效）：返回可用形状的空结构，不 5xx
    return json(
      {
        generatedAt: new Date().toISOString(),
        days,
        since,
        totals: {},
        series: [],
        badges: [],
        titles: [],
        notes: { visitor: '', scope: '' },
      },
      { headers: { 'cache-control': 'no-store', 'x-stats-cache': 'BYPASS' } },
    )
  }
}

function isAdmin(request: Request, env: Env): boolean {
  const key = request.headers.get('x-admin-key') ?? ''
  return Boolean(env.ADMIN_KEY) && key.length > 0 && key === env.ADMIN_KEY
}

/** 管理：全部报错（含未公开），供纠正 */
async function handleAdminList(env: Env, url: URL): Promise<Response> {
  const limit = clampInt(url.searchParams.get('limit'), 1, 200, 50)
  const offset = clampInt(url.searchParams.get('offset'), 0, 100000, 0)
  const status = str(url.searchParams.get('status'), 16)
  const where = status ? 'status = ?' : '1=1'
  const binds = status ? [status] : []
  const rows = await env.DB.prepare(
    `SELECT * FROM reports WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>()
  return json({ reports: rows.results })
}

/** 管理：改状态（纠正/驳回/发布） */
/**
 * 029 M3:管理动作。
 * - `{ status }`：常规状态流转（open/published/fixed/rejected）
 * - `{ action: 'quarantine', mediaKey?, mediaType?, mediaUrl? }`：把该报错涉及的素材加入质量隔离台账
 * - `{ action: 'unquarantine', mediaKey }`：解除隔离（素材已修复/替换）
 * 隔离是**管理方判定**，不自动生效；下次构建时由导出脚本落到题库（见 docs/029 §4）。
 */
async function handleAdminPatch(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readBody(request)
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'quarantine') {
    const row = await env.DB.prepare(
      'SELECT species_id, question_type, media_url, reason, note FROM reports WHERE id = ?',
    )
      .bind(id)
      .first<{ species_id: string | null; question_type: string | null; media_url: string | null }>()
    if (!row) return json({ error: 'not_found' }, { status: 404 })
    const speciesId = str(body.speciesId, 80) || row.species_id || ''
    const mediaType = (str(body.mediaType, 10) || row.question_type || 'image') === 'audio' ? 'audio' : 'image'
    const mediaUrl = str(body.mediaUrl, 500) || row.media_url || ''
    if (!speciesId || !mediaUrl) return json({ error: 'missing_media' }, { status: 400 })
    const key = `${speciesId}|${mediaType}|${mediaUrl}`
    const res = await env.DB.prepare(
      `INSERT INTO media_quarantine (media_key,species_id,media_type,media_url,report_id,note,created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(media_key) DO UPDATE SET resolved_at = NULL, report_id = excluded.report_id, note = excluded.note`,
    )
      .bind(key, speciesId, mediaType, mediaUrl, id, str(body.note, 300) || null, Date.now())
      .run()
    if (!res.success) return json({ error: 'quarantine_failed' }, { status: 500 })
    return json({ ok: true, id, action, mediaKey: key })
  }

  if (action === 'unquarantine') {
    const key = str(body.mediaKey, 500)
    if (!key) return json({ error: 'missing_media_key' }, { status: 400 })
    await env.DB.prepare('UPDATE media_quarantine SET resolved_at = ? WHERE media_key = ?')
      .bind(Date.now(), key)
      .run()
    return json({ ok: true, action, mediaKey: key })
  }

  const status = typeof body.status === 'string' ? body.status : ''
  if (!REPORT_STATUSES.has(status)) return json({ error: 'invalid_status' }, { status: 400 })
  const res = await env.DB.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, Date.now(), id)
    .run()
  if (!res.success) return json({ error: 'update_failed' }, { status: 500 })
  return json({ ok: true, id, status })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = request.method.toUpperCase()

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    try {
      // 035 分享页社交预览（2026-10-09）：/s/* 由本 Worker 接管，向 Pages 的 HTML 壳注入 og meta。
      // 放在最前：这是页面请求（非 /api），命中即返回。
      if ((method === 'GET' || method === 'HEAD') && path.startsWith('/s/')) {
        const m = path.match(/^\/s\/([A-Za-z0-9]{6,24})$/)
        if (m) return await handleSharePage(request, env, m[1]!)
        return Response.redirect(`${url.origin}/`, 302)
      }
      if (method === 'GET') {
        if (path === '/api/health') {
          return json({ ok: true, ts: Date.now(), hasXcKey: Boolean(env.XC_API_KEY) })
        }
        if (path === '/api/manifest') return await handleManifest(env)
        if (path === '/api/manifest-core') return await handleManifest(env, 'manifest-core.json')
        // 039 P1：粗定位（CF request.cf，四舍五入 0.05°；不落库/不进日志）
        if (path === '/api/geo') return handleGeo(request)
        if (path === '/api/questions') return await handleQuestionsCached(request, env, url, ctx)
        const mediaMatch = path.match(/^\/api\/media\/(.+)$/)
        if (mediaMatch) return await handleMedia(env, decodeURIComponent(mediaMatch[1]!))
        if (path === '/api/reports') return await handlePublicReports(env, url)
        // 035：分享读取（公开；不加边缘缓存——撤回需即时生效，D1 仅 1 行读）
        const shareGet = path.match(/^\/api\/shares\/([A-Za-z0-9]{6,24})$/)
        if (shareGet) return await handleGetShare(env, shareGet[1]!)
        // 028 匿名计量：按日聚合读取（管理）
        if (path === '/api/metrics/summary') return await handleMetricsSummary(request, env, url)
        // 028 公开统计看板（无需密钥；边缘缓存 1 小时）
        if (path === '/api/stats/public') return await handlePublicStats(env, ctx, url)
        // 029 M3:质量隔离台账（管理端读取,供 /admin 展示与导出脚本拉取）
        if (path === '/api/quarantine') {
          if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 })
          const rows = await env.DB.prepare(
            'SELECT * FROM media_quarantine ORDER BY created_at DESC LIMIT 500',
          ).all<Record<string, unknown>>()
          return json({ items: rows.results })
        }
        if (path === '/api/reports/admin') {
          if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 })
          return await handleAdminList(env, url)
        }
      }

      if (method === 'POST' && path === '/api/reports') {
        return await handleSubmitReport(request, env)
      }
      // 028 匿名计量上报（公开；白名单 + 内存限流；静默 204）
      if (method === 'POST' && path === '/api/metrics') {
        return await handleMetrics(request, env, ctx)
      }
      if (method === 'POST' && path === '/api/shares') {
        return await handleCreateShare(request, env)
      }
      // 035：分享页浏览计数（2026-10-09）
      const shareView = path.match(/^\/api\/shares\/([A-Za-z0-9]{6,24})\/view$/)
      if (method === 'POST' && shareView) {
        if (!rateAllowed(`v:${clientIp(request)}`, 120)) return new Response(null, { status: 202, headers: CORS })
        // 打开分享页也算"来过人"（POST 该方法即会建表计数）
        return await handleShareView(request, env, shareView[1]!)
      }
      // 035：撤回（凭管理令牌；软删）
      const shareDel = path.match(/^\/api\/shares\/([A-Za-z0-9]{6,24})$/)
      if (method === 'DELETE' && shareDel) {
        return await handleDeleteShare(request, env, shareDel[1]!)
      }
      const voteMatch = path.match(/^\/api\/reports\/([^/]+)\/vote$/)
      if (method === 'POST' && voteMatch) {
        return await handleVote(request, env, decodeURIComponent(voteMatch[1]!))
      }
      const reportMatch = path.match(/^\/api\/reports\/([^/]+)$/)
      if (method === 'PATCH' && reportMatch) {
        if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 })
        return await handleAdminPatch(request, env, decodeURIComponent(reportMatch[1]!))
      }

      return json({ error: 'not_found', path, method }, { status: 404 })
    } catch (err) {
      return json({ error: 'internal_error', message: (err as Error).message }, { status: 500 })
    }
  },
}
