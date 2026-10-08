/**
 * 029 M4:在线出题（fetchOnlinePool）单测——成功解析、失败降级、素材校验、超时。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOnlinePool } from '../onlinePool'

const target = {
  id: 'sp-1',
  nameZh: '目标鸟',
  nameSci: 'Targetus unus',
  family: 'F',
  commonness: 3,
  image: { url: 'https://m/1.webp', type: 'image' },
  audio: null,
}
const distractor = { id: 'sp-2', nameZh: '干扰鸟', nameSci: 'Otherus duo', family: 'F', commonness: 3 }

const okBody = { tier: 3, type: 'image', region: 'ALL', count: 1, species: [target], distractors: [distractor] }

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const u = String(input)
      calls.push(u)
      return impl(u)
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchOnlinePool', () => {
  it('成功：返回目标种与干扰项候选，URL 带档位/题型/数量', async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify(okBody), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const r = await fetchOnlinePool('image', 3, 'ALL', 10)
    expect(r?.species).toHaveLength(1)
    expect(r?.distractors).toHaveLength(1)
    expect(calls[0]).toContain('tier=3')
    expect(calls[0]).toContain('type=image')
    expect(calls[0]).not.toContain('region=') // ALL 不带 region 参数
  })

  it('地区：L1-L3 带 region，L4/L5 不带（与 D-029-2 一致）', async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify(okBody), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await fetchOnlinePool('image', 2, 'CN', 10)
    expect(calls[0]).toContain('region=CN')
    calls.length = 0
    await fetchOnlinePool('image', 4, 'CN', 10)
    expect(calls[0]).not.toContain('region=')
  })

  it('目标种缺对应素材 → 从候选剔除；全无素材 → null（回退本地）', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ species: [{ ...target, image: null }, target], distractors: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const r = await fetchOnlinePool('image', 3, 'ALL', 10)
    expect(r?.species).toHaveLength(1)

    stubFetch(
      () =>
        new Response(JSON.stringify({ species: [{ ...target, image: null }], distractors: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(await fetchOnlinePool('image', 3, 'ALL', 10)).toBeNull()
  })

  it('HTTP 错误 / 网络异常 / 非 JSON → null（离线能力不降级）', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    expect(await fetchOnlinePool('image', 3, 'ALL', 10)).toBeNull()

    stubFetch(() => {
      throw new Error('network down')
    })
    expect(await fetchOnlinePool('image', 3, 'ALL', 10)).toBeNull()

    stubFetch(() => new Response('<!DOCTYPE html>', { status: 200 }))
    expect(await fetchOnlinePool('image', 3, 'ALL', 10)).toBeNull()
  })

  it('空 species → null', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ species: [], distractors: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(await fetchOnlinePool('image', 3, 'ALL', 10)).toBeNull()
  })
})
