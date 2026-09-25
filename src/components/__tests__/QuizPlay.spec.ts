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

/** 开始答题并推进到选项显示的时点 */
async function startRevealed(wrapper: VueWrapper, label: string, advanceMs: number) {
  await startWithTier(wrapper, label)
  vi.advanceTimersByTime(advanceMs)
  await flushPromises()
}

describe('QuizPlay', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('切到下一题后，图片 src 会变化', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      // L1：25s 限时，前 5s 隐藏选项
      await startRevealed(wrapper, 'L1', 5000)

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
    } finally {
      vi.useRealTimers()
    }
  })

  it('D1：L1 前 5s 隐藏选项，之后显示', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startWithTier(wrapper, 'L1')

      expect(wrapper.find('.options-hidden').exists()).toBe(true)
      expect(wrapper.findAll('.option')).toHaveLength(0)

      vi.advanceTimersByTime(4000) // 未到 5s
      await flushPromises()
      expect(wrapper.find('.options-hidden').exists()).toBe(true)

      vi.advanceTimersByTime(1000) // 到 5s
      await flushPromises()
      expect(wrapper.find('.options-hidden').exists()).toBe(false)
      expect(wrapper.findAll('.option').length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D1：L2 前 1/3 限时（20s → 约 6.67s）隐藏选项', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startWithTier(wrapper, 'L2')

      expect(wrapper.find('.options-hidden').exists()).toBe(true)

      vi.advanceTimersByTime(7000)
      await flushPromises()

      expect(wrapper.find('.options-hidden').exists()).toBe(false)
      expect(wrapper.findAll('.option').length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D3：答对后按 → 进入下一题', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      await wrapper.findAll('.option')[0]!.trigger('click')
      expect(store.answered).toBe(true)

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D3：答对后按空格进入下一题', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      await wrapper.findAll('.option')[0]!.trigger('click')
      expect(store.answered).toBe(true)

      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }))
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D3：左滑进入下一题', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      await wrapper.findAll('.option')[0]!.trigger('click')
      expect(store.answered).toBe(true)

      const card = wrapper.find('.card')
      await card.trigger('touchstart', { changedTouches: [{ clientX: 320, clientY: 200 }] })
      await card.trigger('touchend', { changedTouches: [{ clientX: 200, clientY: 208 }] })
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D2：答对后 2s 自动下一题（默认答对自动）', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)

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
