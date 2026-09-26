import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildShuffledQueue, buildStartQueue, pickRandomTracks } from '../ambience'
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

describe('pickRandomTracks（地狱难度干扰音选取）', () => {
  const tracks = ['birds', 'crows', 'owl', 'seagulls', 'woodpecker']

  it('取 n 条且不重复', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickRandomTracks(tracks, 2)
      expect(picked).toHaveLength(2)
      expect(new Set(picked).size).toBe(2)
      expect(picked.every((t) => tracks.includes(t!))).toBe(true)
    }
  })

  it('n 超过总数时返回全部且不重复', () => {
    const picked = pickRandomTracks(tracks, 10)
    expect(picked).toHaveLength(5)
    expect(new Set(picked).size).toBe(5)
  })

  it('n 为 0 或负数返回空数组', () => {
    expect(pickRandomTracks(tracks, 0)).toEqual([])
    expect(pickRandomTracks(tracks, -1)).toEqual([])
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

describe('prewarmBirdTracks（音轨预热，R25）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('预热所有音轨且会话内只 fetch 一次', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('categories.json')) {
          return new Response(JSON.stringify(CATALOG), { status: 200 })
        }
        return new Response('mp3', { status: 200 })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const { loadBirdTracks, prewarmBirdTracks } = await import('../ambience')
    await loadBirdTracks()
    prewarmBirdTracks()
    prewarmBirdTracks()
    prewarmBirdTracks()
    await new Promise((r) => setTimeout(r, 10))
    const mp3Calls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('.mp3'))
    expect(mp3Calls).toHaveLength(2) // 目录里只有 birds + owl 是鸟叫
    const urls = mp3Calls.map((c) => String(c[0]))
    expect(new Set(urls).size).toBe(2)
    expect(urls.every((u) => !u.endsWith('categories.json'))).toBe(true)
  })
})

describe('buildStartQueue（背景音首发，R30）', () => {
  it('首发音（owl，体积最小）打头，其余乱序跟上', () => {
    const ids = ['animals/owl', 'animals/birds', 'animals/crows', 'animals/seagulls']
    for (let i = 0; i < 20; i++) {
      const q = buildStartQueue(ids)
      expect(q[0]).toBe('animals/owl')
      expect([...q].sort()).toEqual([...ids].sort())
    }
  })

  it('首发音被取消勾选时退化为纯乱序', () => {
    const ids = ['animals/birds', 'animals/crows']
    const q = buildStartQueue(ids)
    expect([...q].sort()).toEqual([...ids].sort())
  })

  it('不修改入参数组', () => {
    const ids = ['animals/owl', 'x', 'y']
    buildStartQueue(ids)
    expect(ids[0]).toBe('animals/owl')
  })
})
