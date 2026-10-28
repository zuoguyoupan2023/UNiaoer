import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetMastery, isMastered, masteredCount, toggleMastered } from '@/core/mastery'

describe('mastery（预习熟记状态）', () => {
  beforeEach(() => {
    _resetMastery()
  })

  it('默认全部未熟记', () => {
    expect(isMastered('pycnonotus-sinensis')).toBe(false)
    expect(isMastered('')).toBe(false)
    expect(isMastered(undefined)).toBe(false)
    expect(masteredCount()).toBe(0)
  })

  it('toggle 后状态翻转并持久化到 localStorage', () => {
    expect(toggleMastered('pycnonotus-sinensis')).toBe(true)
    expect(isMastered('pycnonotus-sinensis')).toBe(true)
    expect(masteredCount()).toBe(1)
    // 写入 localStorage（模块内 KEY = birding.mastery.v1）
    const raw = localStorage.getItem('birding.mastery.v1')
    expect(JSON.parse(raw ?? '[]')).toEqual(['pycnonotus-sinensis'])

    expect(toggleMastered('pycnonotus-sinensis')).toBe(false)
    expect(isMastered('pycnonotus-sinensis')).toBe(false)
  })

  it('刷新（新模块实例，同一份 localStorage）后恢复', async () => {
    toggleMastered('pica-serica')
    // 模拟页面刷新：丢弃模块内存，但 localStorage 保留
    vi.resetModules()
    const fresh = await import('@/core/mastery')
    expect(fresh.isMastered('pica-serica')).toBe(true)
    expect(fresh.masteredCount()).toBe(1)
    _resetMastery()
  })

  it('localStorage 里的坏数据回退为空集合，不抛错', () => {
    localStorage.setItem('birding.mastery.v1', '{not json')
    // 不再调用 _resetMastery（会连 storage 一起清）：让模块从坏数据里读
    expect(masteredCount()).toBe(0)
    expect(isMastered('anything')).toBe(false)
  })

  it('非字符串条目被忽略', () => {
    _resetMastery()
    localStorage.setItem('birding.mastery.v1', JSON.stringify(['ok-id', 3, null]))
    expect(isMastered('ok-id')).toBe(true)
    expect(masteredCount()).toBe(1)
  })
})
