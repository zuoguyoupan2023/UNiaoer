/**
 * `src/core/globalZone.ts`：全球出题区**一次性**开关的单测。
 *
 * 行为契约（2026-11-06 用户二次修订）：
 * · `?zone=global` → 本次访问允许全球，**不写 localStorage**
 * · 没有该参数 → 不允许
 * · 刷新/换 URL 即恢复（因为零持久化）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetGlobalZoneCache, isGlobalZoneEnabled } from '../globalZone'

function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`)
  _resetGlobalZoneCache()
}

beforeEach(() => {
  localStorage.clear()
  setSearch('')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isGlobalZoneEnabled（一次性）', () => {
  it('默认关闭', () => {
    expect(isGlobalZoneEnabled()).toBe(false)
  })

  it('?zone=global 本次允许', () => {
    setSearch('?zone=global')
    expect(isGlobalZoneEnabled()).toBe(true)
  })

  it('**不写 localStorage**（一次性，不留痕）', () => {
    setSearch('?zone=global')
    expect(isGlobalZoneEnabled()).toBe(true)
    // 关键契约：不能有任何持久化
    expect(localStorage.length).toBe(0)
    expect(localStorage.getItem('uniaoer.globalQuiz')).toBeNull()
  })

  it('去掉参数即恢复关闭（模拟下次正常访问）', () => {
    setSearch('?zone=global')
    expect(isGlobalZoneEnabled()).toBe(true)
    // 用户下次用普通链接打开
    setSearch('')
    expect(isGlobalZoneEnabled()).toBe(false)
  })

  it('即使 localStorage 里残留旧版的解锁标记，也不再生效', () => {
    // 旧版（记住解锁）会写这个键；新逻辑必须无视它
    localStorage.setItem('uniaoer.globalQuiz', '1')
    setSearch('')
    expect(isGlobalZoneEnabled()).toBe(false)
  })

  it('无法识别的参数值不生效', () => {
    setSearch('?zone=whatever')
    expect(isGlobalZoneEnabled()).toBe(false)
  })

  it('window 不存在时（SSR/测试环境）安全返回 false', () => {
    vi.stubGlobal('window', undefined)
    _resetGlobalZoneCache()
    expect(isGlobalZoneEnabled()).toBe(false)
  })
})
