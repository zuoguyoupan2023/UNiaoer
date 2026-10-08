/**
 * 035 单轮成绩分享：payload 构造与本地台账（管理令牌）。
 *
 * 这是"首个上传用户数据"的功能（docs/035），payload 形状与丢弃规则必须锁死：
 *  · 缺 mediaUrl 的条目丢弃（分享页无法展示素材）；
 *  · total/correct 按**保留条目**重算（分享页数字自洽）；
 *  · 昵称可显式置 null（勾选隐藏，D-035-4）；
 *  · 管理令牌本地台账可增删查（撤回凭据，D-035-6）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetShareLedger,
  buildShareDraft,
  markShareRevoked,
  rememberShare,
  shareOfRound,
  shareUrlOf,
} from '../shareRound'
import type { RoundItem, RoundRecord } from '../historyDb'

function item(over: Partial<RoundItem> = {}): RoundItem {
  return {
    speciesId: 'pycnonotus-sinensis',
    answer: '白头鹎',
    sci: 'Pycnonotus sinensis',
    family: '鹎科',
    type: 'image',
    chosen: '白颊噪鹛',
    chosenId: 'pterorhinus-sannio',
    correct: false,
    timedOut: false,
    mediaUrl: 'https://bird.wewalk.world/media/pycnonotus-sinensis/image-1.full.webp',
    source: 'iNaturalist',
    author: 'tester',
    license: 'CC-BY-NC',
    ...over,
  }
}

function round(items: RoundItem[], over: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id: 'r-1',
    at: 1_759_900_000_000,
    category: 'bird',
    mode: 'image',
    tier: 2,
    total: items.length,
    correct: items.filter((i) => i.correct).length,
    accuracy: 0,
    durationMs: 183_000,
    items,
    ...over,
  }
}

describe('buildShareDraft（035 分享载荷）', () => {
  it('完整一轮 → 字段齐全 + 缩略图按 full→thumb 约定推导', () => {
    const d = buildShareDraft(round([item({ correct: true }), item({ type: 'audio' })]), {
      clientId: 'c-12345678',
      nickname: '小明',
      locale: 'zh-CN',
    })
    expect('error' in d).toBe(false)
    if ('error' in d) return
    expect(d.mode).toBe('image')
    expect(d.tier).toBe(2)
    expect(d.total).toBe(2)
    expect(d.correct).toBe(1)
    expect(d.nickname).toBe('小明')
    expect(d.locale).toBe('zh-CN')
    // 图题带缩略图；音频不带
    expect(d.items[0]!.thumbUrl).toBe(
      'https://bird.wewalk.world/media/pycnonotus-sinensis/image-1.thumb.webp',
    )
    expect(d.items[1]!.thumbUrl).toBeNull()
    // 署名三件套必须带出去（铁律 5）
    expect(d.items[0]!.author).toBe('tester')
    expect(d.items[0]!.license).toBe('CC-BY-NC')
    expect(d.items[0]!.source).toBe('iNaturalist')
  })

  it('缺 mediaUrl 的条目被丢弃，total/correct 按保留条目重算', () => {
    const d = buildShareDraft(
      round([
        item({ correct: true }),
        item({ mediaUrl: '', correct: false }), // 无素材 → 丢弃
        item({ correct: true, speciesId: 'other' }),
      ]),
      { clientId: 'c-12345678', nickname: null, locale: 'en' },
    )
    if ('error' in d) throw new Error('unexpected')
    expect(d.total).toBe(2)
    expect(d.correct).toBe(2)
    expect(d.items).toHaveLength(2)
  })

  it('勾选隐藏昵称 → nickname 为 null（D-035-4）', () => {
    const d = buildShareDraft(round([item()]), {
      clientId: 'c-12345678',
      nickname: null,
      locale: 'zh-CN',
    })
    if ('error' in d) throw new Error('unexpected')
    expect(d.nickname).toBeNull()
  })

  it('全部条目都无素材 → 报 noItems（不产生空分享）', () => {
    const d = buildShareDraft(round([item({ mediaUrl: '' })]), {
      clientId: 'c-12345678',
      nickname: null,
      locale: 'zh-CN',
    })
    expect(d).toEqual({ error: 'noItems' })
  })

  it('超时/未作答：chosen 为 null 时如实带出（分享页显示「超时未作答」）', () => {
    const d = buildShareDraft(round([item({ chosen: null, timedOut: true, correct: false })]), {
      clientId: 'c-12345678',
      nickname: null,
      locale: 'zh-CN',
    })
    if ('error' in d) throw new Error('unexpected')
    expect(d.items[0]!.chosen).toBeNull()
    expect(d.items[0]!.timedOut).toBe(true)
  })
})

describe('分享台账（管理令牌，D-035-6）', () => {
  beforeEach(() => _resetShareLedger())

  it('记录后可查（用于「已分享」标记与撤回入口）', () => {
    rememberShare({ roundId: 'r-1', shareId: 'Abc123def456', token: 'tok-1', at: 1 })
    const hit = shareOfRound('r-1')
    expect(hit?.shareId).toBe('Abc123def456')
    expect(hit?.token).toBe('tok-1')
  })

  it('撤回后不再视为已分享（但记录保留）', () => {
    rememberShare({ roundId: 'r-1', shareId: 'Abc123def456', token: 'tok-1', at: 1 })
    markShareRevoked('Abc123def456')
    expect(shareOfRound('r-1')).toBeUndefined()
  })

  it('同一轮重新分享 → 取最新一条（旧记录被覆盖）', () => {
    rememberShare({ roundId: 'r-1', shareId: 'OLD000000000', token: 'tok-old', at: 1 })
    rememberShare({ roundId: 'r-1', shareId: 'NEW000000000', token: 'tok-new', at: 2 })
    expect(shareOfRound('r-1')?.shareId).toBe('NEW000000000')
  })

  it('shareUrlOf 用当前 origin 拼 /s/:id', () => {
    expect(shareUrlOf('Abc123')).toContain('/s/Abc123')
  })
})
