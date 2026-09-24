import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaCard from '../MediaCard.vue'
import type { MediaAsset } from '@/types'

const audioAsset: MediaAsset = {
  id: 'a',
  speciesId: 'a',
  type: 'audio',
  url: 'https://x.test/a.mp3',
  license: 'CC-BY',
  licenseUrl: '',
  author: 'tester',
  source: 'Xeno-canto',
  sourceUrl: '',
}

describe('MediaCard 音频自动播放', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom 未实现 play()，打桩
    window.HTMLMediaElement.prototype.play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    window.HTMLMediaElement.prototype.pause = vi.fn<() => void>()
  })
  afterEach(() => vi.useRealTimers())

  it('未开启自动播放时不调用 play', async () => {
    mount(MediaCard, { props: { type: 'audio', media: audioAsset, autoplay: false } })
    await vi.advanceTimersByTimeAsync(3000)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('开启后延迟到点才播放', async () => {
    mount(MediaCard, {
      props: { type: 'audio', media: audioAsset, autoplay: true, autoplayDelay: 2000 },
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('延迟未到就卸载则不播放', async () => {
    const wrapper = mount(MediaCard, {
      props: { type: 'audio', media: audioAsset, autoplay: true, autoplayDelay: 2000 },
    })
    await vi.advanceTimersByTimeAsync(500)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })
})
