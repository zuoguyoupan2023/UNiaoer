/**
 * 028 匿名计量：白名单裁剪、开关短路、sendBeacon 发出体。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { track, trackSessionStart } from '../metrics'

describe('metrics.track（匿名计量上报）', () => {
  let sent: string[] = []
  beforeEach(() => {
    sent = []
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    // sendBeacon 桩：记录 body 文本
    vi.stubGlobal('navigator', {
      sendBeacon: (_url: string, blob: Blob) => {
        void blob.text().then((t) => sent.push(t))
        return true
      },
    })
  })

  it('白名单事件 + 枚举属性：按 key 排序裁剪后发出', async () => {
    track('quiz_complete', { tier: 2, mode: 'image' })
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toEqual({ e: 'quiz_complete', p: { mode: 'image', tier: '2' } })
  })

  it('越界属性被丢弃（事件本身仍计）', async () => {
    track('page_view', { category: 'not-a-category', extra: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    expect(JSON.parse(sent[0]!)).toEqual({ e: 'page_view' })
  })

  it('非白名单事件不上报', async () => {
    track('evil_event')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(0)
  })

  it('设置关闭 → 完全不上报', async () => {
    const settings = useSettingsStore()
    settings.metricsEnabled = false
    track('session_start')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(0)
  })

  it('session_start 每会话只计一次', async () => {
    trackSessionStart()
    trackSessionStart()
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toEqual({ e: 'session_start' })
  })
})
