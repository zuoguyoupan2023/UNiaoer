import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Manifest, BankSpecies } from '@/core/bank'

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function asset(id: string, url: string) {
  return {
    id,
    speciesId: id,
    type: 'image' as const,
    url,
    license: 'CC-BY',
    licenseUrl: '',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

function sp(id: string, nameZh: string, url: string): BankSpecies {
  return {
    id,
    nameZh,
    nameSci: `${id} sci`,
    family: '测试科',
    commonness: 1,
    desc: '',
    location: '',
    habit: '',
    image: asset(id, url),
    audio: asset(id, `${url}.mp3`),
  }
}

const manifest: Manifest = {
  generatedAt: '',
  policy: 'relaxed',
  mediaMode: 'remote',
  total: 3,
  stats: { withImage: 3, withAudio: 3 },
  species: [
    sp('a', '甲鸟', 'https://img.test/a.jpg'),
    sp('b', '乙鸟', 'https://img.test/b.jpg'),
    sp('c', '丙鸟', 'https://img.test/c.jpg'),
  ],
}

vi.mock('@/core/bank', () => ({
  loadBank: vi.fn<() => Promise<Manifest>>(async () => manifest),
}))

import QuizPlay from '../QuizPlay.vue'

describe('QuizPlay', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('切到下一题后，图片 src 会变化', async () => {
    const wrapper = mount(QuizPlay, { props: { type: 'image' } })

    // 先看到介绍页
    await vi.waitFor(() => expect(wrapper.find('.intro').exists()).toBe(true))
    const startBtn = wrapper.findAll('.intro button').find((b) => b.text().includes('开始答题'))
    expect(startBtn).toBeTruthy()
    await startBtn!.trigger('click')

    // 等待题库加载
    await vi.waitFor(() => expect(wrapper.find('img').exists()).toBe(true))

    const firstSrc = wrapper.find('img').attributes('src')
    expect(firstSrc).toBeTruthy()

    // 选一个答案 -> 出现“下一题”按钮
    await wrapper.findAll('.option')[0]!.trigger('click')
    const nextBtn = wrapper.findAll('button').find((b) => b.text().includes('下一题'))
    expect(nextBtn).toBeTruthy()
    await nextBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    const secondSrc = wrapper.find('img').attributes('src')
    expect(secondSrc).not.toBe(firstSrc)
  })
})
