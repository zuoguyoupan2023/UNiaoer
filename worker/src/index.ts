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
  name_zh: string
  name_sci: string
  name_en: string | null
  taxon_id: number | null
  family: string | null
  commonness: number
  rank_world: number | null
  rank_cn: number | null
  in_cn: number | null
  group_name: string | null
  migration: string | null
  iucn_category: string | null
  distribution_count: number | null
  desc: string | null
  location: string | null
  habit: string | null
}

interface MediaRow {
  id: string
  species_id: string
  type: 'image' | 'audio'
  url: string
  thumb_url: string | null
  xl_url: string | null
  avif_url: string | null
  original_url: string | null
  source_id: string | null
  license: string
  license_raw: string | null
  author: string
  source: string
  source_url: string | null
  quality: string | null
  transcode: number
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
    nameZh: r.name_zh,
    nameSci: r.name_sci,
    nameEn: r.name_en ?? undefined,
    taxonId: r.taxon_id ?? undefined,
    family: r.family ?? '',
    commonness: r.commonness,
    rankWorld: r.rank_world,
    rankCN: r.rank_cn,
    inCN: r.in_cn == null ? null : r.in_cn === 1,
    desc: r.desc ?? '',
    location: r.location ?? '',
    habit: r.habit ?? '',
    profile,
  }
}

function toMedia(m: MediaRow): Record<string, unknown> {
  return {
    id: m.id,
    speciesId: m.species_id,
    type: m.type,
    url: m.url,
    thumbUrl: m.thumb_url ?? undefined,
    xlUrl: m.xl_url ?? undefined,
    avifUrl: m.avif_url ?? undefined,
    originalUrl: m.original_url ?? undefined,
    sourceId: m.source_id ?? undefined,
    license: m.license,
    licenseRaw: m.license_raw ?? undefined,
    author: m.author,
    source: m.source,
    sourceUrl: m.source_url ?? undefined,
    quality: m.quality ?? undefined,
    transcode: m.transcode === 1,
  }
}

async function handleManifest(env: Env): Promise<Response> {
  // 1) 优先 R2 上的 data/manifest.json（若已上传）
  const obj = await env.MEDIA.get('data/manifest.json')
  if (obj) {
    return new Response(await obj.text(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
        ...CORS,
      },
    })
  }
  // 2) 回退 Pages 静态 manifest（始终与部署同步）
  const origin = env.MANIFEST_ORIGIN || 'https://uniaoer.com'
  const upstream = await fetch(`${origin}/data/manifest.json`, {
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

async function handleQuestions(env: Env, url: URL): Promise<Response> {
  const tier = clampInt(url.searchParams.get('tier'), 1, 5, 2)
  const type = url.searchParams.get('type') === 'audio' ? 'audio' : 'image'
  const count = clampInt(url.searchParams.get('count'), 1, 50, 10)

  const commonness = TIER_COMMONNESS[tier] ?? TIER_COMMONNESS[2]!
  const placeholders = commonness.map(() => '?').join(',')
  const sp = await env.DB.prepare(
    `SELECT id,name_zh,name_sci,name_en,taxon_id,family,commonness,rank_world,rank_cn,in_cn,group_name,migration,iucn_category,distribution_count,desc,location,habit
     FROM species WHERE commonness IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(...commonness, count)
    .all<SpeciesRow>()

  const ids = sp.results.map((r) => r.id)
  if (ids.length === 0) return json({ tier, type, count: 0, species: [] })

  const media = await env.DB.prepare(
    `SELECT id,species_id,type,url,thumb_url,xl_url,avif_url,original_url,source_id,license,license_raw,author,source,source_url,quality,transcode
     FROM media WHERE species_id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<MediaRow>()

  const byId = new Map<string, { images: ReturnType<typeof toMedia>[]; audios: ReturnType<typeof toMedia>[] }>()
  for (const m of media.results) {
    let bucket = byId.get(m.species_id)
    if (!bucket) {
      bucket = { images: [], audios: [] }
      byId.set(m.species_id, bucket)
    }
    if (m.type === 'image') bucket.images.push(toMedia(m))
    else bucket.audios.push(toMedia(m))
  }

  const species = sp.results.map((r) => {
    const bucket = byId.get(r.id) ?? { images: [], audios: [] }
    return {
      ...toSpeciesBase(r),
      images: bucket.images,
      audios: bucket.audios,
      image: bucket.images[0] ?? null,
      audio: bucket.audios[0] ?? null,
    }
  })

  return json({ tier, type, count: species.length, species })
}

async function handleMedia(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT url FROM media WHERE id = ?').bind(id).first<{ url: string }>()
  if (!row) return json({ error: 'not_found', id }, { status: 404 })
  return new Response(null, {
    status: 302,
    headers: {
      location: row.url,
      'cache-control': 'public, max-age=86400',
      ...CORS,
    },
  })
}

// ---------- B6 报错 / 大众评审 ----------

const REPORT_REASONS = new Set(['image', 'audio', 'answer', 'other'])
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

/** 公开列表：已发布 + 待评审（open/published），按时间倒序 */
async function handlePublicReports(env: Env, url: URL): Promise<Response> {
  const limit = clampInt(url.searchParams.get('limit'), 1, 50, 20)
  const offset = clampInt(url.searchParams.get('offset'), 0, 10000, 0)
  const species = str(url.searchParams.get('species'), 100)
  const where = species
    ? "status IN ('open','published') AND species_id = ?"
    : "status IN ('open','published')"
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
async function handleAdminPatch(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readBody(request)
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
        if (path === '/api/questions') return await handleQuestions(env, url)
        const mediaMatch = path.match(/^\/api\/media\/(.+)$/)
        if (mediaMatch) return await handleMedia(env, decodeURIComponent(mediaMatch[1]!))
        if (path === '/api/reports') return await handlePublicReports(env, url)
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
