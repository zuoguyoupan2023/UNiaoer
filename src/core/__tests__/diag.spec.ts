import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { _resetDiagCache, apiBaseFor, diagApiBase, isDiag } from '../diag'

/** 改 location / hostname 后重算 */
function setUrl(url: string) {
  window.history.replaceState({}, '', url)
  _resetDiagCache()
}

describe('core/diag · 072-a 观测开关', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetDiagCache()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    _resetDiagCache()
  })

  it('默认关闭（普通用户完全不受影响）', () => {
    setUrl('/')
    expect(isDiag()).toBe(false)
  })

  it('?diag=1 打开并记住；?diag=0 关闭并清除', () => {
    setUrl('/?diag=1')
    expect(isDiag()).toBe(true)
    expect(localStorage.getItem('uniaoer.diag')).toBe('1')

    // 去掉参数后仍然开启（记住）
    setUrl('/quiz/image')
    expect(isDiag()).toBe(true)

    setUrl('/?diag=0')
    expect(isDiag()).toBe(false)
    expect(localStorage.getItem('uniaoer.diag')).toBeNull()
  })

  it('localStorage 里已有标记也生效（手机免每次带参数）', () => {
    localStorage.setItem('uniaoer.diag', '1')
    setUrl('/quiz/image')
    expect(isDiag()).toBe(true)
  })

  it('只有预览/本地环境才把 API 指到生产；生产域仍走同源', () => {
    // 纯函数：主机名 × 开关
    expect(apiBaseFor('uniaoer.com', true)).toBe('')
    expect(apiBaseFor('www.uniaoer.com', true)).toBe('')
    expect(apiBaseFor('abc123.uniaoer.pages.dev', true)).toBe('https://uniaoer.com')
    expect(apiBaseFor('localhost', true)).toBe('https://uniaoer.com')
    expect(apiBaseFor('127.0.0.1', true)).toBe('https://uniaoer.com')
    // 关闭诊断 → 任何域名都不改基址
    expect(apiBaseFor('abc123.uniaoer.pages.dev', false)).toBe('')
    expect(apiBaseFor('localhost', false)).toBe('')
  })

  it('关闭诊断时 diagApiBase 恒为空（不改变线上请求）', () => {
    setUrl('/quiz/image')
    expect(isDiag()).toBe(false)
    expect(diagApiBase()).toBe('')
  })
})
