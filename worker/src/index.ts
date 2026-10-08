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
const QUESTIONS_CACHE_VERSION = 2

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
 * 过滤链（与前端 029 M2 的 mergedSpecies 语义对齐）：
 *   档位 commonness → 可玩（playable_image/audio 按题型） → quiz_excluded=0 → 媒体 quiz_excluded=0
 *   地区（region=ISO2 且档位≤3 时）：经 species.taxon_key → 短码 与区系矩阵求交
 *     · 区系矩阵存在 R2（data/species-distribution.json）；缺失时**不过滤**（保可用性）
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

  // 地区过滤（仅 L1–L3；L4/L5 全球开放,与前端 D-029-2 一致）
  let shortCodes: string[] | null = null
  if (region !== 'ALL' && tier <= 3) {
    shortCodes = await regionShortCodes(env, region)
  }

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

  let rows = sp.results
  if (rows.length < need) {
    // 环形补齐：从区间起点的另一端再取（保证低 rnd 值的物种也有机会被抽到）
    const more = await env.DB.prepare(`SELECT * ${base} AND rnd < ? ORDER BY rnd LIMIT ?`)
      .bind(...commonness, startAt, need - rows.length)
      .all<SpeciesRow>()
    rows = rows.concat(more.results)
  }

  if (shortCodes) {
    const set = new Set(shortCodes)
    rows = rows
      .filter((r) => {
        const key = r.taxon_key || ''
        const code = key.startsWith('avibase-') ? key.slice(8) : ''
        return code && set.has(code)
      })
      .slice(0, count)
  } else {
    rows = rows.slice(0, count)
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
      const list = doc.byCountry?.[region]
      codes = Array.isArray(list) ? list : []
    }
  } catch {
    codes = null
  }
  regionCodesCache.set(region, { at: Date.now(), codes })
  return codes
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
    'SELECT id,created_at,mode,tier,total,correct,accuracy,nickname,payload,hidden FROM round_shares WHERE id = ?',
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
      if (method === 'GET') {
        if (path === '/api/health') {
          return json({ ok: true, ts: Date.now(), hasXcKey: Boolean(env.XC_API_KEY) })
        }
        if (path === '/api/manifest') return await handleManifest(env)
        if (path === '/api/manifest-core') return await handleManifest(env, 'manifest-core.json')
        if (path === '/api/questions') return await handleQuestionsCached(request, env, url, ctx)
        const mediaMatch = path.match(/^\/api\/media\/(.+)$/)
        if (mediaMatch) return await handleMedia(env, decodeURIComponent(mediaMatch[1]!))
        if (path === '/api/reports') return await handlePublicReports(env, url)
        // 035：分享读取（公开；不加边缘缓存——撤回需即时生效，D1 仅 1 行读）
        const shareGet = path.match(/^\/api\/shares\/([A-Za-z0-9]{6,24})$/)
        if (shareGet) return await handleGetShare(env, shareGet[1]!)
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
      if (method === 'POST' && path === '/api/shares') {
        return await handleCreateShare(request, env)
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
