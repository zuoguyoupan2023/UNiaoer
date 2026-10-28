import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetThumbsCache, audioUrlOf, loadThumbs, thumbUrlOf, type ThumbsIndex } from '@/core/thumbs'

const fixture: ThumbsIndex = {
  base: 'https://bird.wewalk.world/media/',
  thumb: {
    'pycnonotus-sinensis': 'image-1.thumb.webp',
    // 媒体纠错换槽位的真实案例：坏图停用后首图在 image-6
    'pica-serica': 'image-6.thumb.webp',
  },
  audio: {
    'pycnonotus-sinensis': 'audio-1.mp3',
    // 未转码直连源站的情形（37 种 .wav/.m4a）
    'astur-bicolor': 'audio-1.m4a',
  },
}

describe('thumbs（卡片缩略图/鸣声索引）', () => {
  beforeEach(() => {
    _resetThumbsCache()
  })

  it('按索引拼出准确 URL（含纠错后的非 1 槽位与非 mp3 音频）', () => {
    expect(thumbUrlOf(fixture, 'pycnonotus-sinensis')).toBe(
      'https://bird.wewalk.world/media/pycnonotus-sinensis/image-1.thumb.webp',
    )
    // 硬拼 image-1 会拼回已停用的坏图——必须用索引里的真实槽位
    expect(thumbUrlOf(fixture, 'pica-serica')).toBe(
      'https://bird.wewalk.world/media/pica-serica/image-6.thumb.webp',
    )
    expect(audioUrlOf(fixture, 'astur-bicolor')).toBe(
      'https://bird.wewalk.world/media/astur-bicolor/audio-1.m4a',
    )
  })

  it('无图/无音/索引未就绪/空 id → null', () => {
    expect(thumbUrlOf(fixture, 'no-such-bird')).toBeNull()
    expect(audioUrlOf(fixture, 'pica-serica')).toBeNull()
    expect(thumbUrlOf(null, 'pica-serica')).toBeNull()
    expect(thumbUrlOf(fixture, '')).toBeNull()
    expect(thumbUrlOf(fixture, undefined)).toBeNull()
  })

  it('loadThumbs 拉取 data/thumbs.json 并缓存', async () => {
    const fetchMock = vi.fn<() => Promise<{ ok: boolean; json: () => Promise<ThumbsIndex> }>>()
      .mockResolvedValue({ ok: true, json: async () => fixture })
    vi.stubGlobal('fetch', fetchMock)
    const first = await loadThumbs()
    expect(first?.thumb['pica-serica']).toBe('image-6.thumb.webp')
    await loadThumbs()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('data/thumbs.json'))
    vi.unstubAllGlobals()
  })

  it('加载失败返回 null，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    _resetThumbsCache()
    await expect(loadThumbs()).resolves.toBeNull()
    vi.unstubAllGlobals()
  })
})
