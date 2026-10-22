import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  _resetRouteStatus,
  beginNavigation,
  endNavigation,
  handleRouteError,
  manualRetry,
  routeStatus,
} from '../routeStatus'

describe('core/routeStatus · 072-b 路由反馈与 chunk 失败恢复', () => {
  beforeEach(() => {
    _resetRouteStatus()
    vi.useRealTimers()
  })

  it('导航挂起 120ms 后显示进度条；结束后隐藏（快路由不闪烁）', async () => {
    vi.useFakeTimers()
    beginNavigation()
    expect(routeStatus.pending.value).toBe(false) // 立即：不显示
    vi.advanceTimersByTime(130)
    expect(routeStatus.pending.value).toBe(true)
    endNavigation()
    expect(routeStatus.pending.value).toBe(false)
  })

  it('120ms 内结束 → 从不显示', async () => {
    vi.useFakeTimers()
    beginNavigation()
    vi.advanceTimersByTime(50)
    endNavigation()
    vi.advanceTimersByTime(500)
    expect(routeStatus.pending.value).toBe(false)
  })

  it('chunk 失败 → 自动重试一次；重试成功则不出横幅', async () => {
    const retry = vi.fn<() => Promise<void>>(async () => undefined)
    handleRouteError('/quiz/image', retry)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledWith('/quiz/image')
    await Promise.resolve()
    expect(routeStatus.failed.value).toBe(false)
  })

  it('同一路径第二次失败 → 显示横幅（不死循环）', async () => {
    const retry = vi.fn<() => Promise<void>>(async () => undefined)
    handleRouteError('/quiz/image', retry)
    handleRouteError('/quiz/image', retry)
    expect(retry).toHaveBeenCalledTimes(1) // 只自动重试一次
    expect(routeStatus.failed.value).toBe(true)
  })

  it('自动重试被拒绝 → 显示横幅', async () => {
    const retry = vi.fn<() => Promise<void>>(async () => {
      throw new Error('chunk failed')
    })
    handleRouteError('/quiz/audio', retry)
    await Promise.resolve()
    await Promise.resolve()
    expect(routeStatus.failed.value).toBe(true)
  })

  it('手动重试不受自动重试次数限制', async () => {
    const retry = vi.fn<() => Promise<void>>(async () => undefined)
    handleRouteError('/quiz/image', retry)
    handleRouteError('/quiz/image', retry)
    expect(routeStatus.failed.value).toBe(true)
    manualRetry(retry)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(routeStatus.failed.value).toBe(false)
  })

  it('拿不到目标路径 → 直接显示横幅', () => {
    handleRouteError('', vi.fn<() => Promise<void>>(async () => undefined))
    expect(routeStatus.failed.value).toBe(true)
  })
})
