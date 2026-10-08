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

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
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
    expect(open.some((d) => d.find('.cat-sp-link[href="/species/hirundo-rustica"]').exists())).toBe(true)
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
