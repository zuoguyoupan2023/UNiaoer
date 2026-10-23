/**
 * 010 §i18n-0 / 2026-10-23：首次访问的默认语言探测。
 * 规则：列表里**出现中文就用中文**（不看顺序），否则出现英文用英文，都没有 → 中文兜底。
 */
import { describe, expect, it } from 'vitest'
import { detectLocale } from '../index'

describe('detectLocale（浏览器语言 → 站点默认语言）', () => {
  it('英文优先但仍会中文 → 中文（电脑无痕默认英文的修复）', () => {
    expect(detectLocale(['en-US', 'zh-CN'])).toBe('zh-CN')
  })

  it('纯中文列表 → 中文', () => {
    expect(detectLocale(['zh-CN', 'zh'])).toBe('zh-CN')
    expect(detectLocale(['zh-TW'])).toBe('zh-CN')
  })

  it('纯英文列表 → 英文', () => {
    expect(detectLocale(['en-US', 'en'])).toBe('en')
  })

  it('没有中文也没有英文 → 中文兜底', () => {
    expect(detectLocale(['ja-JP', 'ko-KR'])).toBe('zh-CN')
  })

  it('空列表 → 中文兜底', () => {
    expect(detectLocale([])).toBe('zh-CN')
  })
})
