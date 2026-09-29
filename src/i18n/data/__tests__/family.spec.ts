import { describe, expect, it } from 'vitest'
import { FAMILY_EN, FAMILY_LATIN, familyDisplay } from '../family'

describe('familyDisplay（015 #2 拉丁名+本地名）', () => {
  it('zh：拉丁名+中文', () => {
    expect(familyDisplay('鸫科', 'zh-CN')).toBe('Turdidae | 鸫科')
  })

  it('en：拉丁名+英文', () => {
    expect(familyDisplay('鸫科', 'en')).toBe('Turdidae | Thrushes')
  })

  it('两张映射表覆盖同一批科', () => {
    expect(Object.keys(FAMILY_EN).sort()).toEqual(Object.keys(FAMILY_LATIN).sort())
  })

  it('未收录科回退中文原文', () => {
    expect(familyDisplay('不存在的科', 'en')).toBe('不存在的科')
    expect(familyDisplay('不存在的科', 'zh-CN')).toBe('不存在的科')
  })
})
