import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildShuffledQueue } from '../ambience'

const CATALOG = {
  items: [
    {
      id: 'animals/birds',
      key: 'birds',
      category: 'animals',
      src: '/sounds/animals/birds.mp3',
      label: { en: 'Birds', 'zh-cn': '鸟鸣' },
    },
    {
      id: 'animals/owl',
      key: 'owl',
      category: 'animals',
      src: '/sounds/animals/owl.mp3',
      label: { en: 'Owl', 'zh-cn': '猫头鹰' },
    },
    {
      id: 'animals/cows',
      key: 'cows',
      category: 'animals',
      src: '/sounds/animals/cows.mp3',
      label: { en: 'Cows', 'zh-cn': '牛群' },
    },
    {
      id: 'noise/white-noise',
      key: 'white-noise',
      category: 'noise',
      src: '/sounds/noise/white-noise.mp3',
      label: { en: 'White Noise', 'zh-cn': '白噪声' },
    },
  ],
}

describe('buildShuffledQueue', () => {
  it('乱序后元素集合不变', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const q = buildShuffledQueue(ids)
    expect([...q].sort()).toEqual([...ids].sort())
  })

  it('队列长度 >1 时不与上一首相同开头', () => {
    for (let i = 0; i < 30; i++) {
      const q = buildShuffledQueue(['a', 'b', 'c'], 'a')
      expect(q[0]).not.toBe('a')
    }
  })

  it('单元素队列仍返回该元素', () => {
    expect(buildShuffledQueue(['x'], 'x')).toEqual(['x'])
  })

  it('不修改入参数组', () => {
    const ids = ['a', 'b', 'c']
    buildShuffledQueue(ids, 'a')
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('loadBirdTracks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules() // 模块内有目录缓存，每个用例取全新实例
  })

  it('只保留鸟叫音轨，label 与 URL 正确解析', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(CATALOG), { status: 200 })),
    )
    const { loadBirdTracks } = await import('../ambience')
    const tracks = await loadBirdTracks()
    expect(tracks.map((t) => t.id)).toEqual(['animals/birds', 'animals/owl'])
    expect(tracks[0]).toMatchObject({
      id: 'animals/birds',
      labelZh: '鸟鸣',
      labelEn: 'Birds',
      url: 'https://whitenoise.earthtrip.online/sounds/animals/birds.mp3',
    })
  })

  it('HTTP 非 2xx 时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    )
    const { loadBirdTracks } = await import('../ambience')
    await expect(loadBirdTracks()).rejects.toThrow('HTTP 503')
  })

  it('同一实例内目录有缓存（第二次调用不再请求）', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>(async () =>
      new Response(JSON.stringify(CATALOG), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { loadBirdTracks } = await import('../ambience')
    await loadBirdTracks()
    await loadBirdTracks()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
