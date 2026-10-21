import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useMediaQuery } from '../useMediaQuery'

type Listener = (e: MediaQueryListEvent) => void

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: initial,
    media: '(max-width: 640px)',
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  }
  const spy = vi.fn<() => MediaQueryList>(() => mql as unknown as MediaQueryList)
  vi.stubGlobal('matchMedia', spy)
  return { mql, listeners, spy }
}

const Host = defineComponent({
  setup() {
    const isMobile = useMediaQuery('(max-width: 640px)')
    return { isMobile }
  },
  template: '<p>{{ isMobile ? "mobile" : "desktop" }}</p>',
})

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('用初始 matches 值渲染，并跟随 change 事件更新', async () => {
    const { mql, listeners, spy } = mockMatchMedia(true)
    const wrapper = mount(Host)
    expect(spy).toHaveBeenCalledWith('(max-width: 640px)')
    expect(wrapper.text()).toBe('mobile')

    mql.matches = false
    listeners.forEach((cb) => cb({ matches: false } as MediaQueryListEvent))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('desktop')
    wrapper.unmount()
  })

  it('卸载时移除监听（不留全局泄漏）', () => {
    const { listeners } = mockMatchMedia(false)
    const wrapper = mount(Host)
    expect(listeners.size).toBe(1)
    wrapper.unmount()
    expect(listeners.size).toBe(0)
  })

  it('环境不支持 matchMedia 时安全降级为 false', () => {
    vi.stubGlobal('matchMedia', undefined)
    const wrapper = mount(Host)
    expect(wrapper.text()).toBe('desktop')
    wrapper.unmount()
  })
})
