import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetBankCache,
  loadBank,
  speciesNameById,
  speciesNameByStoredName,
  speciesNoteById,
  speciesNoteText,
  speciesProfileById,
  speciesProfileText,
  type Manifest,
} from '../bank'

const manifest: Manifest = {
  generatedAt: '',
  policy: '',
  mediaMode: '',
  total: 2,
  stats: { withImage: 2, withAudio: 0 },
  species: [
    {
      id: 'a',
      nameZh: '甲鸟',
      nameEn: 'Bird A',
      nameSci: 'A avis',
      family: '甲科',
      commonness: 1,
      desc: '',
      location: '',
      habit: '',
      notes: { titleZh: '标题甲', titleEn: 'Title A', bodyZh: '正文甲', bodyEn: 'Body A' },
      profile: {
        group: 'waterbird',
        migration: 'winter',
        habitatZh: '湖泊',
        habitatEn: 'Lakes',
        habitZh: '潜水',
        habitEn: 'Dives',
        distribution: { count: 2, category: 'LC' },
      },
      image: null,
      audio: null,
    },
    {
      id: 'b',
      nameZh: '乙鸟',
      nameEn: 'Bird B',
      nameSci: 'B avis',
      family: '乙科',
      commonness: 1,
      desc: '',
      location: '',
      habit: '',
      image: null,
      audio: null,
    },
  ],
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

describe('speciesNameById / speciesNameByStoredName（015 #1 记录名按 locale 解析）', () => {
  beforeEach(async () => {
    _resetBankCache()
    stubFetch()
    await loadBank()
  })

  it('按 speciesId 解析：zh 用 nameZh，en 用 nameEn', () => {
    expect(speciesNameById('a', 'zh-CN')).toBe('甲鸟')
    expect(speciesNameById('a', 'en')).toBe('Bird A')
  })

  it('按存储名反查（旧记录无 chosenId 的错选名）：中文名/英文名都能命中', () => {
    expect(speciesNameByStoredName('甲鸟', 'en')).toBe('Bird A')
    expect(speciesNameByStoredName('甲鸟', 'zh-CN')).toBe('甲鸟')
    expect(speciesNameByStoredName('Bird B', 'zh-CN')).toBe('乙鸟')
    expect(speciesNameByStoredName('Bird B', 'en')).toBe('Bird B')
    expect(speciesNameByStoredName('A avis', 'en')).toBe('Bird A')
  })

  it('未知 id / 未知名字返回 undefined（调用方回退存储字符串）', () => {
    expect(speciesNameById('nope', 'en')).toBeUndefined()
    expect(speciesNameByStoredName('不存在的鸟', 'en')).toBeUndefined()
    expect(speciesNameByStoredName(null, 'en')).toBeUndefined()
  })
})

describe('speciesNoteById / speciesNoteText（011 §9 答疑专栏）', () => {
  beforeEach(async () => {
    _resetBankCache()
    stubFetch()
    await loadBank()
  })

  it('按 id 取说明；无说明物种/空 id 返回 undefined', () => {
    expect(speciesNoteById('a')?.titleZh).toBe('标题甲')
    expect(speciesNoteById('b')).toBeUndefined()
    expect(speciesNoteById(null)).toBeUndefined()
  })

  it('按 locale 取标题与正文', () => {
    expect(speciesNoteText(speciesNoteById('a'), 'zh-CN')).toEqual({
      title: '标题甲',
      body: '正文甲',
    })
    expect(speciesNoteText(speciesNoteById('a'), 'en')).toEqual({
      title: 'Title A',
      body: 'Body A',
    })
  })

  it('缺失语言字段回退另一语言；无说明返回 null', () => {
    expect(
      speciesNoteText({ titleZh: '仅中文', bodyZh: '正文', titleEn: '', bodyEn: '' }, 'en'),
    ).toEqual({ title: '仅中文', body: '正文' })
    expect(speciesNoteText(undefined, 'en')).toBeNull()
  })
})

describe('speciesProfileById / speciesProfileText（C1 物种档案）', () => {
  beforeEach(async () => {
    _resetBankCache()
    stubFetch()
    await loadBank()
  })

  it('按 id 取档案；无档案物种返回 undefined', () => {
    expect(speciesProfileById('a')?.group).toBe('waterbird')
    expect(speciesProfileById('b')).toBeUndefined()
    expect(speciesProfileById(null)).toBeUndefined()
  })

  it('生境/习性按 locale 取，缺英文回退中文', () => {
    const profile = speciesProfileById('a')
    expect(speciesProfileText(profile, 'zh-CN')).toEqual({ habitat: '湖泊', habit: '潜水' })
    expect(speciesProfileText(profile, 'en')).toEqual({ habitat: 'Lakes', habit: 'Dives' })
    expect(
      speciesProfileText({ habitatZh: '仅中文', habitEn: 'Only EN' }, 'en'),
    ).toEqual({ habitat: '仅中文', habit: 'Only EN' })
  })
})

describe('loadBank（B3：生产优先 /api/manifest，失败回退静态）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('生产：优先请求 /api/manifest', async () => {
    _resetBankCache()
    vi.stubEnv('PROD', true)
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(String(input))
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    await loadBank()
    expect(calls[0]).toContain('/api/manifest')
  })

  it('生产：/api/manifest 失败时回退到静态文件', async () => {
    _resetBankCache()
    vi.stubEnv('PROD', true)
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const u = String(input)
        calls.push(u)
        if (u.includes('/api/manifest')) {
          return new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } })
        }
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const m = await loadBank()
    expect(m.total).toBe(2)
    expect(calls.some((u) => u.includes('/api/manifest'))).toBe(true)
    expect(calls.some((u) => u.includes('data/manifest.json'))).toBe(true)
  })
})
