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
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
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

  // 单表查询（内联媒体列）——每题只需 1 图 1 音，完整 5+5 由前端 assets 分片提供
  const sp = await env.DB.prepare(
    `SELECT * FROM species
     WHERE commonness IN (${placeholders}) AND ${playableCol} IS NOT NULL AND quiz_excluded = 0
     ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(...commonness, shortCodes ? Math.max(count * 8, 200) : count)
    .all<SpeciesRow>()

  let rows = sp.results
  if (shortCodes) {
    const set = new Set(shortCodes)
    rows = rows
      .filter((r) => {
        const key = r.taxon_key || ''
        const code = key.startsWith('avibase-') ? key.slice(8) : ''
        return code && set.has(code)
      })
      .slice(0, count)
  }

  const species = rows.map((r) => {
    const image = inlineImage(r)
    const audio = inlineAudio(r)
    return { ...toSpeciesBase(r), images: image ? [image] : [], audios: audio ? [audio] : [], image, audio }
  })

  // 029 M4:干扰项名字候选（无素材，仅选项用；小体积换选项多样性）
  const targetIds = new Set(species.map((s) => s.id))
  let distractors: Record<string, unknown>[] = []
  try {
    const d = await env.DB.prepare(
      `SELECT id,name_zh,name_sci,name_en,family,commonness
       FROM species WHERE commonness IN (${placeholders}) AND quiz_excluded = 0
       ORDER BY RANDOM() LIMIT ?`,
    )
      .bind(...commonness, 240)
      .all<Pick<SpeciesRow, 'id' | 'name_zh' | 'name_sci' | 'name_en' | 'family' | 'commonness'>>()
    distractors = d.results
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
        if (path === '/api/questions') return await handleQuestions(env, url)
        const mediaMatch = path.match(/^\/api\/media\/(.+)$/)
        if (mediaMatch) return await handleMedia(env, decodeURIComponent(mediaMatch[1]!))
        if (path === '/api/reports') return await handlePublicReports(env, url)
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
