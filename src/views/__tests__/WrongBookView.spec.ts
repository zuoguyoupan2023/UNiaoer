import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'

const img = (n: number) => ({
  speciesId: 'a',
  type: 'image' as const,
  url: `https://x/${n}.jpg`,
  thumbUrl: `https://x/${n}.thumb.jpg`,
  license: 'CC-BY',
  author: 't',
  source: 'iNaturalist',
  sourceUrl: '',
})

vi.mock('@/core/historyDb', () => ({
  getWrongBook: vi.fn<() => Promise<unknown[]>>(async () => [
    {
      speciesId: 'a',
      answer: '甲鸟',
      sci: 'A avis',
      family: '甲科',
      type: 'image',
      mediaUrl: 'https://x/wrong.jpg',
      source: 'iNaturalist',
      author: 'tester',
      license: 'CC-BY',
      wrongCount: 2,
      lastChosen: '乙',
      lastChosenId: 'b',
      lastAt: 1,
    },
  ]),
  listWrongHistory: vi.fn<() => Promise<unknown[]>>(async () => []),
  removeWrong: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  clearWrong: vi.fn<() => Promise<void>>(async () => undefined),
}))

vi.mock('@/core/bank', () => ({
  loadBank: vi.fn<() => Promise<unknown>>(async () => ({})),
  speciesById: vi.fn<(id: string) => { images: unknown[]; audios: unknown[] }>(() => ({
    images: [img(1), img(2)],
    audios: [],
  })),
  speciesNameById: vi.fn<(...args: unknown[]) => string | undefined>(() => undefined),
  speciesNameByStoredName: vi.fn<(...args: unknown[]) => string | undefined>(() => undefined),
}))

vi.mock('@/core/questionEngine', () => ({
  assetsOf: vi.fn<(sp: { images?: unknown[]; audios?: unknown[] }, type: string) => unknown[]>(
    (sp, type) => (type === 'image' ? (sp.images ?? []) : (sp.audios ?? [])),
  ),
}))

import WrongBookView from '../WrongBookView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/quiz/:mode', component: { template: '<div />' } },
    ],
  })
}

describe('错题本原题素材 + 同种画廊（回归）', () => {
  it('当前错题本显示原题图与同种其它图/音入口', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const w = mount(WrongBookView, { global: { plugins: [createPinia(), router] } })
    await flushPromises()
    expect(w.find('.thumb').attributes('src')).toBe('https://x/wrong.jpg')
    expect(w.find('.item-gallery .sg-toggle').exists()).toBe(true)
  })
})
