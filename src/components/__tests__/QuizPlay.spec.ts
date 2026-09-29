import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Manifest, BankSpecies } from '@/core/bank'

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn<() => Promise<void>>() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: pushMock,
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

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: vi.fn<() => Promise<Manifest>>(async () => manifest),
}))

import { useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
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
  beforeEach(() => {
    setActivePinia(createPinia())
    pushMock.mockClear()
  })

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

  it('D2：答对后 3s 自动下一题（默认答对自动，R43）', async () => {
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

      vi.advanceTimersByTime(2500)
      await flushPromises()
      expect(store.index).toBe(0) // 3s 未到

      vi.advanceTimersByTime(500)
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R43：自动切换=浮窗；取消本次后回落下方，且仅此时出现「不再自动切换」', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      const settings = useSettingsStore()

      const answer = store.current!.answer
      await wrapper.findAll('.option').find((b) => b.text().includes(answer))!.trigger('click')

      // 自动切换中：浮窗存在、下方无常驻反馈、「不再自动切换」不出现
      expect(wrapper.find('.correct-toast').exists()).toBe(true)
      expect(wrapper.find('.feedback').exists()).toBe(false)
      expect(wrapper.findAll('button').some((b) => b.text().includes('不再自动切换'))).toBe(false)
      const cancel = wrapper.findAll('button').find((b) => b.text().includes('取消切换'))
      expect(cancel).toBeTruthy()

      // 点「取消切换」：浮窗消失、下方常驻、出现「不再自动切换」
      await cancel!.trigger('click')
      expect(wrapper.find('.correct-toast').exists()).toBe(false)
      expect(wrapper.find('.feedback').exists()).toBe(true)
      const off = wrapper.findAll('button').find((b) => b.text().includes('不再自动切换'))
      expect(off).toBeTruthy()

      vi.advanceTimersByTime(5000)
      await flushPromises()
      expect(store.index).toBe(0) // 本次已取消

      // 彻底关闭 → 手动：出现「自动切换」
      await off!.trigger('click')
      expect(settings.autoNext).toBe('manual')
      const on = wrapper.findAll('button').find((b) => b.text().trim().includes('自动切换'))
      expect(on).toBeTruthy()

      // 手动点「自动切换」→ 恢复并开始倒计时
      await on!.trigger('click')
      expect(settings.autoNext).toBe('correct')
      vi.advanceTimersByTime(3000)
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R43：都自动模式下，错题 4s 自动切换', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      const settings = useSettingsStore()
      settings.autoNext = 'all'

      const q = store.current!
      const wrong = q.options.find((o) => o !== q.answer)!
      await wrapper.findAll('.option').find((b) => b.text().includes(wrong))!.trigger('click')

      const toast = wrapper.find('.correct-toast')
      expect(toast.exists()).toBe(true)
      expect(toast.classes()).toContain('is-wrong')

      vi.advanceTimersByTime(3500)
      await flushPromises()
      expect(store.index).toBe(0) // 4s 未到
      vi.advanceTimersByTime(500)
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R43：浮窗内含「下一题」，主按钮隐藏；点击浮窗可立即进入下一题', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      const answer = store.current!.answer
      await wrapper.findAll('.option').find((b) => b.text().includes(answer))!.trigger('click')

      expect(wrapper.find('.correct-toast').exists()).toBe(true)
      expect(wrapper.find('.actions').exists()).toBe(false) // 浮窗期间主按钮隐藏
      const toastBtn = wrapper.find('.correct-toast .ct-next')
      expect(toastBtn.exists()).toBe(true)
      expect(toastBtn.text()).toBe('下一题')

      await toastBtn.trigger('click')
      await flushPromises()
      expect(store.index).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R43：取消切换后主「下一题」按钮恢复显示', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      const answer = store.current!.answer
      await wrapper.findAll('.option').find((b) => b.text().includes(answer))!.trigger('click')
      expect(wrapper.find('.actions').exists()).toBe(false)

      const cancel = wrapper.findAll('button').find((b) => b.text().includes('取消切换'))
      await cancel!.trigger('click')
      expect(wrapper.find('.actions').exists()).toBe(true)
      expect(wrapper.find('.actions button').text()).toContain('下一题')
    } finally {
      vi.useRealTimers()
    }
  })

  it('最后一题按钮文案为「查看结果」', async () => {
    useQuizFakeTimers()
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startWithTier(wrapper, 'L1')
      const store = useQuizStore()
      const settings = useSettingsStore()
      settings.autoNext = 'manual'
      store.index = store.total - 1
      await wrapper.vm.$nextTick()
      vi.advanceTimersByTime(5000)
      await flushPromises()

      const q = store.current!
      await wrapper.findAll('.option').find((b) => b.text().includes(q.answer))!.trigger('click')
      expect(wrapper.find('.actions button').text()).toContain('查看结果')
    } finally {
      vi.useRealTimers()
    }
  })

  it('退出测试：已作答 1 题时确认后截断到 1 题并跳结果页', async () => {
    useQuizFakeTimers()
    try {
      window.confirm = vi.fn<() => boolean>(() => true)
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      await wrapper.findAll('.option')[0]!.trigger('click')

      const quitBtn = wrapper.findAll('button').find((b) => b.text().includes('退出'))
      expect(quitBtn).toBeTruthy()
      await quitBtn!.trigger('click')
      await flushPromises()

      expect(store.questions.length).toBe(1)
      expect(store.chosen.length).toBe(1)
      expect(store.answeredCount).toBe(1)
      expect(pushMock).toHaveBeenCalledWith('/result')
    } finally {
      vi.useRealTimers()
    }
  })

  it('退出测试：未作答时确认后不留记录并回首页', async () => {
    useQuizFakeTimers()
    try {
      window.confirm = vi.fn<() => boolean>(() => true)
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      expect(store.answeredCount).toBe(0)

      const quitBtn = wrapper.findAll('button').find((b) => b.text().includes('退出'))
      await quitBtn!.trigger('click')
      await flushPromises()

      expect(store.questions.length).toBe(0)
      expect(pushMock).toHaveBeenCalledWith('/')
    } finally {
      vi.useRealTimers()
    }
  })

  it('退出测试：确认框取消则继续答题', async () => {
    useQuizFakeTimers()
    try {
      window.confirm = vi.fn<() => boolean>(() => false)
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await startRevealed(wrapper, 'L1', 5000)
      const store = useQuizStore()
      await wrapper.findAll('.option')[0]!.trigger('click')

      const quitBtn = wrapper.findAll('button').find((b) => b.text().includes('退出'))
      await quitBtn!.trigger('click')
      await flushPromises()

      expect(store.questions.length).toBe(3) // mock 题库只有 3 种
      expect(pushMock).not.toHaveBeenCalledWith('/result')
      expect(pushMock).not.toHaveBeenCalledWith('/')
    } finally {
      vi.useRealTimers()
    }
  })
})
