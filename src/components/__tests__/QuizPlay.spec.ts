import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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

import { useQuizStore } from '@/stores/quiz'
import QuizPlay from '../QuizPlay.vue'

/** 让 flushPromises 的 setImmediate 保持真实，仅伪造计时相关 */
function useQuizFakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
}

async function startWithTier(wrapper: VueWrapper, label: string) {
  await flushPromises()
  const tierBtn = wrapper.findAll('.tier').find((b) => b.text().includes(label))
  expect(tierBtn).toBeTruthy()
  await tierBtn!.trigger('click')
  const startBtn = wrapper.findAll('.intro button').find((b) => b.text().includes('开始答题'))
  expect(startBtn).toBeTruthy()
  await startBtn!.trigger('click')
  await flushPromises()
}

describe('QuizPlay', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('切到下一题后，图片 src 会变化', async () => {
    const wrapper = mount(QuizPlay, { props: { type: 'image' } })

    // 选 L1：不限时，选项立即可见
    await startWithTier(wrapper, 'L1')
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

  it('D1：限时题前 1/3 隐藏选项，之后显示', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })

      // 默认 L2：20s 限时
      await startWithTier(wrapper, 'L2')

      expect(wrapper.find('.options-hidden').exists()).toBe(true)
      expect(wrapper.findAll('.option')).toHaveLength(0)

      vi.advanceTimersByTime(7000) // 超过 20s 的 1/3
      await flushPromises()

      expect(wrapper.find('.options-hidden').exists()).toBe(false)
      expect(wrapper.findAll('.option').length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D1：不限时题不隐藏选项', async () => {
    const wrapper = mount(QuizPlay, { props: { type: 'image' } })
    await startWithTier(wrapper, 'L1')
    expect(wrapper.find('.options-hidden').exists()).toBe(false)
    expect(wrapper.findAll('.option').length).toBeGreaterThan(0)
  })

  it('D2：答对后 2s 自动下一题（默认答对自动）', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startWithTier(wrapper, 'L1')

      const store = useQuizStore()
      const answer = store.current!.answer
      const option = wrapper.findAll('.option').find((b) => b.text().includes(answer))
      expect(option).toBeTruthy()
      await option!.trigger('click')
      expect(store.index).toBe(0)

      vi.advanceTimersByTime(2000)
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
