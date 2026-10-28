import { describe, expect, it } from 'vitest'
import { matchUrlInPool, resolveMyReportStatus, type ReportMediaMatch } from '../reportStatus'
import type { MediaAsset } from '@/types'

function asset(over: Partial<MediaAsset> = {}): MediaAsset {
  return {
    speciesId: 'anas-platyrhynchos',
    type: 'image',
    url: 'https://bird.wewalk.world/media/anas-platyrhynchos/image-1.full.webp',
    license: 'CC-BY',
    author: 'a',
    source: 'iNaturalist',
    sourceUrl: 'https://example.org/1',
    ...over,
  }
}

describe('matchUrlInPool（064 素材比对纯函数）', () => {
  const pool = [
    asset(),
    asset({
      url: 'https://bird.wewalk.world/media/anas-platyrhynchos/image-2.full.webp',
      thumbUrl: 'https://bird.wewalk.world/media/anas-platyrhynchos/image-2.thumb.webp',
      originalUrl: 'https://inaturalist.org/photos/999/large.jpg',
    }),
  ]

  it('精确 URL 命中', () => {
    expect(matchUrlInPool(pool, pool[0]!.url)).toBe(true)
  })

  it('多分辨率变体（缩略图/原图）也算仍在池内', () => {
    expect(matchUrlInPool(pool, pool[1]!.thumbUrl!)).toBe(true)
    expect(matchUrlInPool(pool, pool[1]!.originalUrl!)).toBe(true)
  })

  it('不在池内 = 已替换/下架', () => {
    expect(matchUrlInPool(pool, 'https://bird.wewalk.world/media/anas-platyrhynchos/image-9.full.webp')).toBe(false)
  })
})

describe('resolveMyReportStatus（064 状态合成优先级）', () => {
  const base = { synced: true }

  it('未上传成功 = 待上传（最高优先）', () => {
    expect(resolveMyReportStatus({ synced: false }, { state: 'media-missing' })).toBe('local')
  })

  it('远端已修正 = 已处理（明确标记优先于推断）', () => {
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'fixed' }, { state: 'media-missing' })).toBe('fixed')
  })

  it('素材不在当前池 = 已处理·素材已更新（自动闭环信号）', () => {
    const match: ReportMediaMatch = { state: 'media-missing' }
    expect(resolveMyReportStatus(base, match)).toBe('resolved-media')
  })

  it('物种不在当前名录 = 已处理·物种已调整', () => {
    expect(resolveMyReportStatus(base, { state: 'species-missing' })).toBe('resolved-species')
  })

  it('素材仍在 + 远端状态照常透出', () => {
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'published' }, { state: 'found' })).toBe('published')
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'rejected' }, { state: 'found' })).toBe('rejected')
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'open' }, { state: 'found' })).toBe('open')
  })

  it('客观事实（素材消失）优先于评审中/未采纳', () => {
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'published' }, { state: 'media-missing' })).toBe(
      'resolved-media',
    )
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'rejected' }, { state: 'species-missing' })).toBe(
      'resolved-species',
    )
  })

  it('比对不可用（unknown）时按远端状态显示，不误判已处理', () => {
    expect(resolveMyReportStatus({ ...base, remoteStatus: 'open' }, { state: 'unknown' })).toBe('open')
    expect(resolveMyReportStatus(base)).toBe('open')
  })
})
