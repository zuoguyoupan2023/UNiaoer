/**
 * 029 M4 + 030 措施 3:在线出题（fetchOnlinePool）单测。
 * 覆盖:成功解析、请求参数归一、客户端缓存（命中/TTL/淘汰/清除）、失败降级、素材校验。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearClientPoolCache, fetchOnlinePool } from '../onlinePool'

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

/**
 * 按请求的 type 返回带**对应素材**的目标种：
 * 音频题的目标种必须有 audio（否则被 fetchOnlinePool 的素材校验过滤 → 返回 null，
 * 不写缓存）。此前测试用同一个 image-only 目标种请求 audio，正是因此误判为"缓存 bug"。
 */
const okResponse = (url = '') => {
  const isAudio = url.includes('type=audio')
  const sp = isAudio
    ? { ...target, image: null, audio: { url: 'https://m/1.mp3', type: 'audio' } }
    : target
  return new Response(JSON.stringify({ ...okBody, species: [sp] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchOnlinePool', () => {
  it('成功：返回目标种与干扰项候选，count 归一为 30', async () => {
    const calls = stubFetch((u) => okResponse(u))
    const r = await fetchOnlinePool('image', 3, 'ALL')
    expect(r?.species).toHaveLength(1)
    expect(r?.distractors).toHaveLength(1)
    expect(r?.from).toBe('network')
    expect(calls[0]).toContain('tier=3')
    expect(calls[0]).toContain('type=image')
    expect(calls[0]).toContain('count=50') // 措施 3：常量,收敛边缘缓存 key（072-a：30→50 修首轮短轮）
    expect(calls[0]).not.toContain('region=') // ALL 不带 region
  })

  it('地区：L1-L4 带 region，L5+ 不带（与 D-029-2 修订版一致，2026-10-24）', async () => {
    const calls = stubFetch((u) => okResponse(u))
    await fetchOnlinePool('image', 2, 'CN')
    expect(calls[0]).toContain('region=CN')
    clearClientPoolCache()
    calls.length = 0
    await fetchOnlinePool('image', 4, 'CN')
    expect(calls[0]).toContain('region=CN')
    clearClientPoolCache()
    calls.length = 0
    await fetchOnlinePool('image', 5, 'CN')
    expect(calls[0]).not.toContain('region=')
    clearClientPoolCache()
    calls.length = 0
    // 088 方案 B：L5+ 传洲码 → 带上；L1–L4 传洲码（跨档残留）→ 归一为全球
    await fetchOnlinePool('image', 5, 'ASIA')
    expect(calls[0]).toContain('region=ASIA')
    clearClientPoolCache()
    calls.length = 0
    await fetchOnlinePool('image', 2, 'ASIA')
    expect(calls[0]).not.toContain('region=')
  })

  it('措施 3：同键第二次调用命中客户端缓存（零网络）', async () => {
    const calls = stubFetch((u) => okResponse(u))
    await fetchOnlinePool('image', 3, 'ALL')
    expect(calls).toHaveLength(1)
    const second = await fetchOnlinePool('image', 3, 'ALL')
    expect(second?.from).toBe('client')
    expect(calls).toHaveLength(1) // 未再发请求
    expect(second?.species).toHaveLength(1)
  })

  it('措施 3：TTL 过期后重新请求', async () => {
    vi.useFakeTimers()
    const calls = stubFetch((u) => okResponse(u))
    await fetchOnlinePool('image', 3, 'ALL')
    expect(calls).toHaveLength(1)
    // 推进 11 分钟（TTL 10 分钟）
    vi.setSystemTime(Date.now() + 11 * 60_000)
    const again = await fetchOnlinePool('image', 3, 'ALL')
    expect(again?.from).toBe('network')
    expect(calls).toHaveLength(2)
  })

  it('措施 3：不同档位/题型/地区各自缓存（互不串味）', async () => {
    const calls = stubFetch((u) => okResponse(u))
    await fetchOnlinePool('image', 3, 'ALL')
    await fetchOnlinePool('audio', 3, 'ALL')
    await fetchOnlinePool('image', 4, 'ALL')
    expect(calls).toHaveLength(3)
    // 再各取一次：全部命中缓存
    await fetchOnlinePool('image', 3, 'ALL')
    await fetchOnlinePool('audio', 3, 'ALL')
    await fetchOnlinePool('image', 4, 'ALL')
    expect(calls).toHaveLength(3)
  })

  it('措施 3：缓存条目上限 16——超量淘汰最旧（072-a：30→50 后 24→16）', async () => {
    const calls = stubFetch((u) => okResponse(u))
    // 唯一键空间 = tier × type × 生效地区（region 仅 L1–L3 生效,见 D-029-2）：
    //   L1–L3: 3 档 × 2 题型 × 3 地区(ALL/CN/US) = 18
    //   L4–L5: 2 档 × 2 题型 × 1 地区(忽略 region) = 4   → 合计 22
    const combos: [('image' | 'audio'), 1 | 2 | 3 | 4 | 5, string][] = []
    for (const tier of [1, 2, 3] as const) {
      for (const type of ['image', 'audio'] as const) {
        for (const r of ['ALL', 'CN', 'US']) combos.push([type, tier, r])
      }
    }
    for (const tier of [4, 5] as const) {
      for (const type of ['image', 'audio'] as const) combos.push([type, tier, 'ALL'])
    }
    const uniq = new Map<string, [('image' | 'audio'), 1 | 2 | 3 | 4 | 5, string]>()
    for (const c of combos) {
      const effRegion = c[1] <= 3 ? c[2] : 'ALL'
      uniq.set(`${c[1]}:${c[0]}:${effRegion}`, c)
    }
    const keys = [...uniq.values()]
    expect(keys.length).toBe(22) // 键空间确为 22

    // 写满 22 个键：上限 16 → 淘汰最旧的 6 个，最终只留 16 条
    for (const [t, tier, r] of keys) await fetchOnlinePool(t, tier, r)
    expect(calls).toHaveLength(22)

    const stored = Object.keys(sessionStorage).filter((k) => k.startsWith('uniaoer.onlinePool.v3:'))
    expect(stored.length).toBe(16)
    expect(stored.length).toBeLessThanOrEqual(16)

    // 最近写入的 16 个仍在缓存里 → 再取一次不产生新请求
    for (const k of stored) {
      const [tierStr, type, region] = k.split(':').slice(1)
      await fetchOnlinePool(type as 'image' | 'audio', Number(tierStr) as 1 | 2 | 3 | 4 | 5, region ?? 'ALL')
    }
    expect(calls).toHaveLength(22)
  })

  it('clearClientPoolCache 清空后重新请求', async () => {
    const calls = stubFetch((u) => okResponse(u))
    await fetchOnlinePool('image', 3, 'ALL')
    clearClientPoolCache()
    await fetchOnlinePool('image', 3, 'ALL')
    expect(calls).toHaveLength(2)
  })

  it('目标种缺对应素材 → 从候选剔除；全无素材 → null（回退本地）', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ species: [{ ...target, image: null }, target], distractors: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const r = await fetchOnlinePool('image', 3, 'ALL')
    expect(r?.species).toHaveLength(1)
  })

  it('HTTP 错误 / 网络异常 / 非 JSON / 空 species → null（离线能力不降级）', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    expect(await fetchOnlinePool('image', 3, 'ALL')).toBeNull()

    stubFetch(() => {
      throw new Error('network down')
    })
    expect(await fetchOnlinePool('image', 3, 'ALL')).toBeNull()

    stubFetch(() => new Response('<!DOCTYPE html>', { status: 200 }))
    expect(await fetchOnlinePool('image', 3, 'ALL')).toBeNull()

    stubFetch(
      () =>
        new Response(JSON.stringify({ species: [], distractors: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(await fetchOnlinePool('image', 3, 'ALL')).toBeNull()
  })

  it('失败结果不写缓存（下次仍会尝试网络）', async () => {
    const calls = stubFetch(() => new Response('boom', { status: 500 }))
    await fetchOnlinePool('image', 3, 'ALL')
    await fetchOnlinePool('image', 3, 'ALL')
    expect(calls).toHaveLength(2)
  })
})
