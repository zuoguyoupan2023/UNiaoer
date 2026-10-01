import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { listPublicReportsMock } = vi.hoisted(() => ({
  listPublicReportsMock: vi.fn<
    (...args: unknown[]) => Promise<{ reports: unknown[]; total: number }>
  >(),
}))

vi.mock('@/core/reportsApi', () => ({
  listPublicReports: (...args: unknown[]) => listPublicReportsMock(...args),
}))

import { useReportsMetaStore } from '../reportsMeta'

describe('reportsMeta store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listPublicReportsMock.mockReset()
    vi.useFakeTimers()
  })

  it('有已发布条目时记录 total，导航入口显示', async () => {
    listPublicReportsMock.mockResolvedValue({ reports: [{ id: 'r1' }], total: 3 })
    const store = useReportsMetaStore()
    await store.refresh()
    expect(store.publishedCount).toBe(3)
  })

  it('拉取失败按 0 处理（后端不可用不显示入口）', async () => {
    listPublicReportsMock.mockRejectedValue(new Error('offline'))
    const store = useReportsMetaStore()
    await store.refresh()
    expect(store.publishedCount).toBe(0)
  })

  it('60s 内重复 refresh 节流，不重复请求', async () => {
    listPublicReportsMock.mockResolvedValue({ reports: [], total: 0 })
    const store = useReportsMetaStore()
    await store.refresh()
    await store.refresh()
    expect(listPublicReportsMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    await store.refresh()
    expect(listPublicReportsMock).toHaveBeenCalledTimes(2)
  })

  it('total 变化后再次刷新会更新计数', async () => {
    listPublicReportsMock.mockResolvedValueOnce({ reports: [{ id: 'r1' }], total: 1 })
    const store = useReportsMetaStore()
    await store.refresh()

    vi.advanceTimersByTime(60_000)
    listPublicReportsMock.mockResolvedValueOnce({ reports: [{ id: 'r1' }], total: 0 })
    await store.refresh()
    expect(store.publishedCount).toBe(0)
  })
})
