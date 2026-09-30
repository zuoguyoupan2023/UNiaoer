import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { _resetBankCache, type Manifest } from '@/core/bank'
import FaqView from '../FaqView.vue'
import FaqDetailView from '../FaqDetailView.vue'

const manifest: Manifest = {
  generatedAt: '',
  policy: '',
  mediaMode: '',
  total: 2,
  stats: { withImage: 1, withAudio: 0 },
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
      notes: { titleZh: '甲说明', titleEn: 'Note A', bodyZh: '甲正文', bodyEn: 'Body A' },
      image: null,
      audio: null,
      images: [
        {
          speciesId: 'a',
          type: 'image',
          url: 'https://example.test/a.jpg',
          license: 'CC-BY',
          author: 'tester',
          source: 'iNaturalist',
          sourceUrl: 'https://example.test/a',
        },
      ],
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

const LinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/faq', component: FaqView },
      { path: '/faq/:speciesId', name: 'faq-detail', component: FaqDetailView },
    ],
  })
}

describe('答疑专栏（011 §9）', () => {
  beforeEach(() => {
    _resetBankCache()
    stubFetch()
  })

  it('/faq 只列出有 notes 的物种', async () => {
    const w = mount(FaqView, {
      global: { plugins: [makeRouter()], stubs: { RouterLink: LinkStub } },
    })
    await flushPromises()
    const items = w.findAll('.faq-item')
    expect(items).toHaveLength(1)
    expect(items[0]!.text()).toContain('甲鸟')
    expect(items[0]!.text()).toContain('甲说明')
  })

  it('/faq/:id 展示说明与素材署名', async () => {
    const router = makeRouter()
    await router.push('/faq/a')
    await router.isReady()
    const w = mount(FaqDetailView, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.find('.note .body').text()).toContain('甲正文')
    expect(w.find('.credits .attribution').text()).toContain('CC-BY')
  })

  it('未知物种显示 notFound', async () => {
    const router = makeRouter()
    await router.push('/faq/nope')
    await router.isReady()
    const w = mount(FaqDetailView, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.find('.not-found').exists()).toBe(true)
  })
})
