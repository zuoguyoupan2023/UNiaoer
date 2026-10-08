/**
 * 031 D-031-2:拼音排序键单测(多音字 / 生僻字补丁 / 脏数据容错)。
 */
import { describe, expect, it } from 'vitest'
import { pinyinKey } from '../pinyin-key.mjs'

describe('pinyinKey', () => {
  it('常规鸟名:无声调小写拼音,ü 归一化为 v', () => {
    expect(pinyinKey('白头鹎')).toBe('baitoubei')
    expect(pinyinKey('普通翠鸟')).toBe('putongcuiniao')
    expect(pinyinKey('绿头鸭')).toBe('lvtouya')
  })

  it('多音字按整串上下文消歧（长尾 → cháng）', () => {
    expect(pinyinKey('银喉长尾山雀')).toBe('yinhouchangweishanque')
    expect(pinyinKey('长耳鸮')).toBe('changerxiao')
  })

  it('拼音库未收录的扩展区鸟名生僻字走人工补丁', () => {
    expect(pinyinKey('凤头䳍')).toBe('fengtougong')
    expect(pinyinKey('黑喉石䳭')).toBe('heihoushiji')
    expect(pinyinKey('朱䴉')).toBe('zhuhuan')
  })

  it('非汉字字符(空格/拉丁/零宽)自动跳过', () => {
    expect(pinyinKey('白眼褐鹎\u200c')).toBe('baiyanhebei')
    expect(pinyinKey('Western Warbling Vireo')).toBe('')
    expect(pinyinKey('')).toBe('')
    expect(pinyinKey(undefined)).toBe('')
  })

  it('仍无法读音的字回调上报并跳过(不抛异常)', () => {
    const unknown = []
    const key = pinyinKey('测试𱉐鸟', (chars) => unknown.push(...chars))
    expect(key).toBe('ceshiniao')
    expect(unknown).toEqual(['𱉐'])
  })
})
