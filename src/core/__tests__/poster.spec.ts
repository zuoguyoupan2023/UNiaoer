import { describe, it, expect } from 'vitest'
import {
  buildWrongRows,
  POSTER_WRONG_MAX,
  DEFAULT_SITE_URL,
  type PosterWrong,
} from '../poster'
import { POSTER_BACKGROUNDS, getBackground } from '../posterScenes'

function wrong(answer: string): PosterWrong {
  return { answer, chosen: '认错的', timedOut: false }
}

describe('海报 · 错题区行选取（F2）', () => {
  it('最多展示 8 条，左右各 4', () => {
    expect(POSTER_WRONG_MAX).toBe(8)
  })

  it('≤8 条：全部展示，无占位', () => {
    const rows = buildWrongRows([1, 2, 3, 4, 5, 6, 7, 8].map((n) => wrong(`鸟${n}`)))
    expect(rows).toHaveLength(8)
    expect(rows.some((r) => r.placeholder)).toBe(false)
    expect(rows[7]!.answer).toBe('鸟8')
  })

  it('>8 条：前 7 条 + 第 8 条占位', () => {
    const rows = buildWrongRows(Array.from({ length: 12 }, (_, i) => wrong(`鸟${i + 1}`)))
    expect(rows).toHaveLength(8)
    expect(rows.slice(0, 7).map((r) => r.answer)).toEqual([
      '鸟1',
      '鸟2',
      '鸟3',
      '鸟4',
      '鸟5',
      '鸟6',
      '鸟7',
    ])
    expect(rows[7]!.placeholder).toBe(true)
    expect(rows[7]!.answer).toBe('这里放不下了')
  })

  it('0 条：空数组', () => {
    expect(buildWrongRows([])).toHaveLength(0)
  })
})

describe('海报 · 背景（F1）', () => {
  it('新增纯白 / 纯黑，且纯白为浅色底', () => {
    const white = getBackground('white')
    const black = getBackground('black')
    expect(white.plain).toBe(true)
    expect(white.light).toBe(true)
    expect(black.plain).toBe(true)
    expect(black.light).toBeFalsy()
  })

  it('背景总数包含新风格', () => {
    const ids = POSTER_BACKGROUNDS.map((b) => b.id)
    expect(ids).toContain('white')
    expect(ids).toContain('black')
  })
})

describe('海报 · 官网二维码（F4）', () => {
  it('默认指向官网地址', () => {
    expect(DEFAULT_SITE_URL).toBe('https://uniaoer.pages.dev')
  })
})
