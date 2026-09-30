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
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
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
    return new Response(obj.text(), {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, { status: 405 })
    }

    try {
      if (path === '/api/health') {
        return json({ ok: true, ts: Date.now(), hasXcKey: Boolean(env.XC_API_KEY) })
      }
      if (path === '/api/manifest') {
        return await handleManifest(env)
      }
      if (path === '/api/questions') {
        return await handleQuestions(env, url)
      }
      const mediaMatch = path.match(/^\/api\/media\/(.+)$/)
      if (mediaMatch) {
        return await handleMedia(env, decodeURIComponent(mediaMatch[1]!))
      }
      return json({ error: 'not_found', path }, { status: 404 })
    } catch (err) {
      return json({ error: 'internal_error', message: (err as Error).message }, { status: 500 })
    }
  },
}
