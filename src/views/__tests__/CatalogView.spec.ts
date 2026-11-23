/**
 * 031 D-031-2:/catalog 三态排序（分类序 / 拼音 / 常见度）+ 字母跳转。
 * 排序纯逻辑在 core/__tests__/catalog.spec.ts;此处验证视图接线（按钮、重排、锚点）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import CatalogView from '../CatalogView.vue'

const catalog = {
  generatedAt: 'test-fixture',
  counts: { total: 4, withImage: 4, withAudio: 4, orders: 2, families: 2 },
  orders: [
    {
      sci: 'Strigiformes',
      zh: '鸮形目',
      families: [
        {
          sci: 'Strigidae',
          species: [
            { id: 'bubo-bubo', sci: 'Bubo bubo', zh: '雕鸮', py: 'diaoxiao', cm: 3, image: true, audio: true },
            { id: 'athene-noctua', sci: 'Athene noctua', zh: '纵纹腹小鸮', py: 'zongwenfuxiaoxiao', cm: 1, image: true, audio: true },
          ],
        },
      ],
    },
    {
      sci: 'Passeriformes',
      zh: '雀形目',
      families: [
        {
          sci: 'Hirundinidae',
          species: [
            { id: 'hirundo-rustica', sci: 'Hirundo rustica', zh: '家燕', py: 'jiayan', cm: 4, image: true, audio: true },
            { id: 'delichon-dasypus', sci: 'Delichon dasypus', zh: '烟腹毛脚燕', py: 'yanfumaojiaoyan', cm: 1, image: true, audio: true },
          ],
        },
      ],
    },
  ],
}

/** thumbs 索引夹具：只给 bubo-bubo 一条首图/首音，其余种视为无素材 */
const thumbs = {
  schemaVersion: 1,
  base: 'https://media.test/media/',
  thumb: { 'bubo-bubo': 'image-1.thumb.webp' },
  audio: { 'bubo-bubo': 'audio-1.mp3' },
}

/** assets 分片夹具：bubo-bubo 首图带完整署名（展开时用来验证 AttributionLine 接线） */
const assetsBucket = {
  species: {
    'bubo-bubo': {
      images: [
        {
          speciesId: 'bubo-bubo',
          type: 'image',
          url: 'https://media.test/media/bubo-bubo/image-1.full.webp',
          thumbUrl: 'https://media.test/media/bubo-bubo/image-1.thumb.webp',
          license: 'CC BY-NC',
          author: 'Test Photographer',
          source: 'iNaturalist',
          sourceUrl: 'https://example.test/obs/1',
        },
      ],
      audios: [
        {
          speciesId: 'bubo-bubo',
          type: 'audio',
          url: 'https://media.test/media/bubo-bubo/audio-1.mp3',
          license: 'CC BY-SA',
          author: 'Test Recordist',
          source: 'Xeno-canto',
          sourceUrl: 'https://example.test/xc/1',
        },
      ],
    },
  },
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (url.includes('/data/thumbs.json')) return json(thumbs)
      if (url.includes('/data/assets/')) return json(assetsBucket)
      return json(catalog)
    }),
  )
}

const LinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/catalog', component: CatalogView },
      { path: '/species/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountView() {
  const w = mount(CatalogView, {
    global: { plugins: [makeRouter()], stubs: { RouterLink: LinkStub } },
  })
  await flushPromises()
  return w
}

/** 当前可见的目 → 种 id 序列（跳 html 结构断言，只关心顺序） */
function speciesOrder(w: Awaited<ReturnType<typeof mountView>>): string[] {
  return w.findAll('.cat-sp').map((el) => el.attributes('id')!.replace('cat-sp-', ''))
}

describe('/catalog 排序（031 D-031-2）', () => {
  beforeEach(() => {
    stubFetch()
  })

  it('默认分类序:目顺序不变,种为构建期顺序', async () => {
    const w = await mountView()
    expect(w.findAll('.cat-order-name').map((e) => e.text())).toEqual([
      '鸮形目 Strigiformes',
      '雀形目 Passeriformes',
    ])
    // 分类序下目内保持 catalog.json 原顺序（雕鸮 → 小鸮）
    expect(speciesOrder(w)).toEqual(['bubo-bubo', 'athene-noctua', 'hirundo-rustica', 'delichon-dasypus'])
    expect(w.find('.letter-bar').exists()).toBe(false)
  })

  it('切「拼音」:目内按拼音重排,出现字母跳转条（目层级保持不动）', async () => {
    const w = await mountView()
    const pinyinBtn = w.findAll('.sort-btn').find((b) => b.text() === '拼音')!
    await pinyinBtn.trigger('click')
    // 目顺序不变;目内:雕鸮 d < 纵纹腹小鸮 z、家燕 j < 烟腹毛脚燕 y
    expect(w.findAll('.cat-order-name').map((e) => e.text())).toEqual([
      '鸮形目 Strigiformes',
      '雀形目 Passeriformes',
    ])
    expect(speciesOrder(w)).toEqual(['bubo-bubo', 'athene-noctua', 'hirundo-rustica', 'delichon-dasypus'])
    const letters = w.findAll('.letter-btn').map((b) => b.text())
    expect(letters).toEqual(['D', 'J', 'Y', 'Z'])
  })

  it('切「常见度」:目内按档位升序（1 最常见在前）,目层级保持不动', async () => {
    const w = await mountView()
    const commonBtn = w.findAll('.sort-btn').find((b) => b.text() === '常见度')!
    await commonBtn.trigger('click')
    // 目内:小鸮 cm=1 先于 雕鸮 cm=3;烟腹毛脚燕 cm=1 先于 家燕 cm=4
    expect(speciesOrder(w)).toEqual(['athene-noctua', 'bubo-bubo', 'delichon-dasypus', 'hirundo-rustica'])
  })

  it('字母跳转:点 J 展开对应目与科并定位到该种', async () => {
    const w = await mountView()
    const pinyinBtn = w.findAll('.sort-btn').find((b) => b.text() === '拼音')!
    await pinyinBtn.trigger('click')
    const jBtn = w.findAll('.letter-btn').find((b) => b.text() === 'J')!
    await jBtn.trigger('click')
    await flushPromises()
    // 雀形目（家燕所在）已展开
    const open = w.findAll('details[open]')
    expect(open.length).toBeGreaterThan(0)
    expect(open.some((d) => d.find('#cat-sp-hirundo-rustica').exists())).toBe(true)
  })

  it('行内始终有详情按钮；点击名字就地展开素材、再点收起', async () => {
    const w = await mountView()
    // 名字是可展开按钮（不跳页），详情是旁边常驻的主按钮（docs/137 B 线，2026-11-23 改版）
    const row = w.find('#cat-sp-bubo-bubo .cat-sp-link')
    expect(row.element.tagName).toBe('BUTTON')
    expect(row.attributes('aria-expanded')).toBe('false')

    // 未展开也有详情按钮
    const detail = w.find('#cat-sp-bubo-bubo .cat-sp-detail')
    expect(detail.exists()).toBe(true)
    expect(detail.attributes('href')).toBe('/species/bubo-bubo')

    await row.trigger('click')
    await flushPromises()
    expect(w.find('#cat-sp-bubo-bubo .cat-sp-link').attributes('aria-expanded')).toBe('true')
    expect(w.find('#cat-pv-bubo-bubo').exists()).toBe(true)

    // 再点同一行收起（详情按钮仍在）
    await w.find('#cat-sp-bubo-bubo .cat-sp-link').trigger('click')
    await flushPromises()
    expect(w.find('#cat-pv-bubo-bubo').exists()).toBe(false)
    expect(w.find('#cat-sp-bubo-bubo .cat-sp-detail').exists()).toBe(true)
  })

  it('多张卡片可同时展开（比较多个种时不必来回收起）', async () => {
    const w = await mountView()
    await w.find('#cat-sp-bubo-bubo .cat-sp-link').trigger('click')
    await flushPromises()
    await w.find('#cat-sp-athene-noctua .cat-sp-link').trigger('click')
    await flushPromises()
    expect(w.find('#cat-pv-bubo-bubo').exists()).toBe(true)
    expect(w.find('#cat-pv-athene-noctua').exists()).toBe(true)
    // 各自独立收起
    await w.find('#cat-sp-bubo-bubo .cat-sp-link').trigger('click')
    await flushPromises()
    expect(w.find('#cat-pv-bubo-bubo').exists()).toBe(false)
    expect(w.find('#cat-pv-athene-noctua').exists()).toBe(true)
  })

  it('搜索命中不跨科时自动展开素材（无需逐点点开）', async () => {
    vi.useFakeTimers()
    try {
      const w = await mountView()
      await w.find('.cat-search').setValue('jiayan')
      vi.advanceTimersByTime(300)
      await flushPromises()
      // 只有 Hirundinidae 里的家燕命中 → 单科单种 → 自动展开
      expect(w.find('#cat-pv-hirundo-rustica').exists()).toBe(true)
      expect(w.find('#cat-sp-hirundo-rustica .cat-sp-detail').attributes('href')).toBe(
        '/species/hirundo-rustica',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('搜索命中跨科时保持点开才展开（不自动铺开）', async () => {
    vi.useFakeTimers()
    try {
      const w = await mountView()
      // 「a」在夹具里跨 Strigidae / Hirundinidae 两个科
      await w.find('.cat-search').setValue('a')
      vi.advanceTimersByTime(300)
      await flushPromises()
      expect(w.findAll('.cat-pv').length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('切回「分类序」:恢复原顺序并隐藏字母条', async () => {
    const w = await mountView()
    const btn = (label: string) => w.findAll('.sort-btn').find((b) => b.text() === label)!
    await btn('拼音').trigger('click')
    await btn('分类序').trigger('click')
    expect(speciesOrder(w)).toEqual(['bubo-bubo', 'athene-noctua', 'hirundo-rustica', 'delichon-dasypus'])
    expect(w.find('.letter-bar').exists()).toBe(false)
  })
})
