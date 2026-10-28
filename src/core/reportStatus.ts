/**
 * 064 我的报错：状态合成 + 素材比对（「我的报错」卡片与大众评审页共用）。
 *
 * 自动闭环信号：报错存的 media_url 若已不在该物种当前素材池 = 素材已被实质
 * 替换/下架（新图新文件名，旧 URL 自然消失）→ 无需人工标记即可判定「已处理」。
 * 例：用户报「绿头鸭图2 不对」→ 管理方替换素材 → 新构建上线后旧 URL 消失
 * → 用户打开「我的」即自动显示「已处理 · 素材已更新」并可直达物种页看新图。
 */
import { loadBank, loadSpeciesAssets, speciesById } from './bank'
import type { MediaAsset } from '@/types'
import type { ReportEntry } from './reportStore'

export type ReportMediaMatch =
  | { state: 'found' } // 素材仍在当前池（未动）
  | { state: 'media-missing' } // 物种在，该素材 URL 已不在其素材池（已替换/下架）
  | { state: 'species-missing' } // 物种已不在当前名录（下架/合并）
  | { state: 'unknown' } // 名录/分片不可用（离线等），不作判定

/** 纯函数：URL 是否命中素材池（精确 URL 或其多分辨率变体）——单测钉住 */
export function matchUrlInPool(pool: readonly MediaAsset[], url: string): boolean {
  return pool.some(
    (m) =>
      m.url === url || m.thumbUrl === url || m.avifUrl === url || m.xlUrl === url || m.originalUrl === url,
  )
}

/**
 * 报错素材 ↔ 当前素材库 比对。
 * 只有物种分片**加载成功**才拥有完整素材池；分片不可用时返回 unknown
 * （只拿核心首图比对会误报「素材已替换」——报错常指向第 2..5 条素材）。
 */
export async function matchReportMedia(
  speciesId: string | null | undefined,
  questionType: string | null | undefined,
  mediaUrl: string | null | undefined,
): Promise<ReportMediaMatch> {
  if (!speciesId || !mediaUrl) return { state: 'unknown' }
  await loadBank().catch(() => null)
  const sp = speciesById(speciesId)
  if (!sp) return { state: 'species-missing' }
  const shard = await loadSpeciesAssets(speciesId).catch(() => null)
  if (!shard) return { state: 'unknown' }
  const wantAudio = questionType === 'audio'
  const pool: MediaAsset[] = [...(wantAudio ? (shard.audios ?? []) : (shard.images ?? []))]
  for (const m of wantAudio ? [sp.audio, ...(sp.audios ?? [])] : [sp.image, ...(sp.images ?? [])]) {
    if (m) pool.push(m)
  }
  return matchUrlInPool(pool, mediaUrl) ? { state: 'found' } : { state: 'media-missing' }
}

/** 「我的报错」条目展示状态 */
export type MyReportDisplay =
  | 'local' // 未上传成功（等待补传）
  | 'open' // 已提交 · 待处理
  | 'published' // 评审中（已公开）
  | 'fixed' // 已处理（管理方标记）
  | 'rejected' // 未采纳
  | 'resolved-media' // 已处理 · 素材已更新（自动判定）
  | 'resolved-species' // 已处理 · 物种已调整（自动判定）

/**
 * 状态合成。优先级：本地未传 > 远端 fixed（明确修正）> 素材/物种消失
 * （客观事实，优先于主观评审结论）> published > rejected > open。
 */
export function resolveMyReportStatus(
  entry: Pick<ReportEntry, 'synced'> & { remoteStatus?: string | null },
  match?: ReportMediaMatch,
): MyReportDisplay {
  if (!entry.synced) return 'local'
  if (entry.remoteStatus === 'fixed') return 'fixed'
  if (match?.state === 'media-missing') return 'resolved-media'
  if (match?.state === 'species-missing') return 'resolved-species'
  if (entry.remoteStatus === 'published') return 'published'
  if (entry.remoteStatus === 'rejected') return 'rejected'
  return 'open'
}
