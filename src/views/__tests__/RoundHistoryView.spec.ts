import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { RoundItem, RoundRecord } from '@/core/historyDb'

// 甲鸟带 5 图 5 音（五图五音画廊用）
const fakeSpecies = {
  id: 'sp-a',
  nameZh: '甲鸟',
  nameEn: 'Bird A',
  nameSci: 'A avis',
  family: '甲科',
  commonness: 1,
  desc: '',
  location: '',
  habit: '',
  image: null,
  audio: null,
  images: Array.from({ length: 5 }, (_, i) => ({
    speciesId: 'sp-a',
    type: 'image' as const,
    url: `https://img.test/a-${i}.jpg`,
    license: 'CC-BY',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  })),
  audios: Array.from({ length: 5 }, (_, i) => ({
    speciesId: 'sp-a',
    type: 'audio' as const,
    url: `https://audio.test/a-${i}.mp3`,
    license: 'CC-BY',
    author: 'tester',
    source: 'Xeno-canto',
    sourceUrl: '',
  })),
}

vi.mock('@/core/bank', () => ({
  loadBank: vi.fn<() => Promise<unknown>>(async () => ({})),
  speciesById: vi.fn<(id: string | null | undefined) => unknown>(
    (id) => (id === 'sp-a' ? fakeSpecies : undefined),
  ),
  speciesNameById: vi.fn<(id: string | null | undefined) => string | undefined>(
    (id) => (id === 'sp-a' ? '甲鸟' : id === 'sp-b' ? '乙鸟' : undefined),
  ),
  speciesNameByStoredName: vi.fn<(n: string | null | undefined) => string | undefined>(
    (n) => (n === '旧名鸟' ? '旧名鸟(en)' : undefined),
  ),
}))

vi.mock('@/core/historyDb', () => ({
  listRounds: vi.fn<() => Promise<RoundRecord[]>>(async () => records),
}))

/** 空状态里的 RouterLink 需要真实 router；测试里用 <a> 桩替代 */
const RouterLinkStub = { template: '<a><slot /></a>' }

function mountView() {
  return mount(RoundHistoryView, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

import RoundHistoryView from '../RoundHistoryView.vue'

function item(over: Partial<RoundItem>): RoundItem {
  return {
    speciesId: 'sp-a',
    answer: '甲鸟',
    sci: 'A avis',
    family: '鸫科',
    type: 'image',
    chosen: null,
    correct: true,
    timedOut: false,
    mediaUrl: 'https://img.test/a.jpg',
    source: 'iNaturalist',
    author: 'tester',
    license: 'CC-BY',
    ...over,
  }
}

function round(over: Partial<RoundRecord>): RoundRecord {
  return {
    id: 'r1',
    at: Date.now(),
    category: 'bird',
    mode: 'image',
    tier: 2,
    total: 2,
    correct: 2,
    accuracy: 100,
    durationMs: 65_000,
    items: [],
    ...over,
  }
}

const records: RoundRecord[] = [
  round({
    id: 'r-new',
    at: Date.now(),
    items: [
      item({ correct: true, chosen: '甲鸟', chosenId: 'sp-a' }),
      item({
        speciesId: 'sp-old',
        answer: '旧名鸟',
        correct: false,
        chosen: '旧名鸟',
        chosenId: undefined,
      }),
      item({ speciesId: 'sp-c', answer: '丙鸟', timedOut: true, chosen: null }),
    ],
  }),
  round({
    id: 'r-old',
    at: Date.now() - 86_400_000,
    mode: 'audio',
    tier: 5,
    source: 'wrong-practice',
    correct: 1,
    accuracy: 50,
    items: [item({ correct: true })],
  }),
]

describe('RoundHistoryView（E5 轮次复盘）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('倒序列出轮次：时间/模式/难度/得分/用时/错题重练角标', async () => {
    const wrapper = mountView()
    await flushPromises()

    const heads = wrapper.findAll('.round-head')
    expect(heads).toHaveLength(2)
    // 新轮在前（倒序）
    expect(heads[0]!.text()).toContain('2/2 · 100%')
    expect(heads[0]!.text()).toContain('1:05') // 用时 m:ss
    // 旧轮：听音 · L5 · 错题重练角标
    expect(heads[1]!.text()).toContain('听音')
    expect(heads[1]!.text()).toContain('L5')
    expect(heads[1]!.text()).toContain('错题重练')
  })

  it('点开某轮逐题回看：答案名/错选名按 locale 解析，超时占位，保留署名', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.items').exists()).toBe(false)
    await wrapper.findAll('.round-head')[0]!.trigger('click')

    const items = wrapper.findAll('.items .item')
    expect(items).toHaveLength(3)
    // 第 1 题：答对，speciesId 解析
    expect(items[0]!.text()).toContain('甲鸟')
    expect(items[0]!.text()).toContain('你的选择：甲鸟')
    // 第 2 题：旧记录无 chosenId → 存储名反查兜底
    expect(items[1]!.text()).toContain('旧名鸟')
    // 第 3 题：超时占位
    expect(items[2]!.text()).toContain('超时未作答')
    // 署名行保留（AGENTS 铁律 5）
    expect(items[0]!.find('.attribution').exists()).toBe(true)
    // 逐题附同种五图五音画廊：甲鸟（题库可查）→ 5 图 5 音；旧记录/超时题查不到 → 回退或隐藏
    const galleries = wrapper.findAll('.item-gallery')
    expect(galleries).toHaveLength(1) // 仅第 1 题展示（其余回退单素材 ≤1 自动隐藏）
    await galleries[0]!.find('.sg-toggle').trigger('click') // 画廊默认折叠，点开
    expect(galleries[0]!.findAll('.sg-thumb')).toHaveLength(5)
    expect(galleries[0]!.findAll('.sg-audio-row')).toHaveLength(5)
    // 手风琴：再点收起
    await wrapper.findAll('.round-head')[0]!.trigger('click')
    expect(wrapper.find('.items').exists()).toBe(false)
  })

  it('空列表显示引导；超过 20 轮分页', async () => {
    const { listRounds } = await import('@/core/historyDb')
    ;(listRounds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    const empty = mountView()
    await flushPromises()
    expect(empty.text()).toContain('还没有答题记录')

    const many = Array.from({ length: 25 }, (_, i) =>
      round({ id: `r-${i}`, at: Date.now() - i * 1000, items: [] }),
    )
    ;(listRounds as ReturnType<typeof vi.fn>).mockResolvedValueOnce(many)
    const paged = mountView()
    await flushPromises()
    expect(paged.findAll('.round-head')).toHaveLength(20)
    await paged.find('.more button').trigger('click')
    expect(paged.findAll('.round-head')).toHaveLength(25)
    expect(paged.find('.more').exists()).toBe(false)
  })
})
