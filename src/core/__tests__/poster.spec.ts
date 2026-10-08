import { describe, it, expect } from 'vitest'
import {
  buildWrongRows,
  drawPoster,
  POSTER_WRONG_MAX,
  DEFAULT_SITE_URL,
  type PosterData,
  type PosterStrings,
  type PosterWrong,
} from '../poster'
import { POSTER_BACKGROUNDS, getBackground } from '../posterScenes'
import { i18n } from '@/i18n'

function wrong(answer: string): PosterWrong {
  return { answer, chosen: '认错的', timedOut: false }
}

/**
 * 最小 canvas 2d 上下文替身（jsdom 不带 canvas 实现）。
 * 记录 fillText 文本，供"海报实际画了什么"的断言使用。
 */
function stubCanvas(): { canvas: HTMLCanvasElement; texts: string[] } {
  const texts: string[] = []
  const ctx = {
    canvas: null as unknown as HTMLCanvasElement,
    // 属性（画布代码会读写）
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    // 方法
    save() {},
    restore() {},
    scale() {},
    translate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    fill() {},
    stroke() {},
    fillRect() {},
    drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (t: string) => ({ width: String(t).length * 12 }),
    fillText: (t: string) => {
      texts.push(String(t))
    },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
  ctx.canvas = canvas
  return { canvas, texts }
}

/** 由 Vue 侧注入的 PosterStrings 等价物（用真实 i18n 语言包构造，含满屏文案） */
function posterStrings(): PosterStrings {
  return {
    roundLabel: i18n.global.t('poster.canvas.roundN', { n: 1 }),
    intro: i18n.global.t('poster.canvas.intro'),
    perfectTitle: i18n.global.t('poster.canvas.perfect'),
    answeredTitle: i18n.global.t('poster.canvas.answered'),
    accuracyLine: i18n.global.t('poster.canvas.accuracy', { acc: 80, tier: 'L1' }),
    wrongHeading: i18n.global.t('poster.canvas.wrongHeading'),
    allCorrect: i18n.global.t('poster.canvas.allCorrect'),
    overflow: i18n.global.t('poster.canvas.overflow'),
    timedOut: i18n.global.t('result.timedOut'),
    mistakenAs: (name: string) => i18n.global.t('poster.canvas.mistakenAs', { name }),
    sourceLine: i18n.global.t('poster.canvas.sourceLine'),
    scanCta: i18n.global.t('poster.canvas.scanCta'),
  }
}

function posterData(wrongRows: PosterWrong[]): PosterData {
  return {
    modeLabel: '鸟图版',
    tierLabel: 'L1',
    correct: 8,
    total: 10,
    accuracy: 80,
    date: '2026-10-08',
    wrong: wrongRows,
  }
}

/**
 * 回归：错题行「认成了「{name}」」曾渲染成空括号（2026-10-08，见 docs/034）。
 * 根因是文案经 i18n 的 t() **不带参**取值时，{name} 被当作插值变量替换成空串，
 * 画布侧再 replace('{name}', …) 永远匹配不到。此处锁死"画布上真的出现名字"。
 */
describe('海报 · 错题行文案（i18n 插值回归）', () => {
  it('t() 不带参会把 {name} 插值成空串（陷阱本身，勿改回字符串模板）', () => {
    i18n.global.locale.value = 'zh-CN'
    const noParam = i18n.global.t('poster.canvas.mistakenAs')
    expect(noParam).not.toContain('{name}')
    expect(noParam).toBe('认成了「」')
  })

  it('带参构造 → 画布实际画出错选名字', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      posterData([
        { answer: '家燕', chosen: '金腰燕', timedOut: false },
        { answer: '白鹡鸰', chosen: null, timedOut: true },
      ]),
      { themeId: 'white' },
      posterStrings(),
    )
    const joined = texts.join('\n')
    expect(joined).toContain('认成了「金腰燕」')
    expect(joined).not.toContain('认成了「」')
    expect(joined).toContain('1. 家燕')
    // 超时行仍走 timedOut 文案，不渲染错选
    expect(joined).toContain('超时未作答')
  })
})

describe('海报 · 错题区行选取（F2）', () => {
  it('最多展示 8 条，左右各 4', () => {
    expect(POSTER_WRONG_MAX).toBe(8)
  })

  it('≤8 条：全部展示，无占位', () => {
    const rows = buildWrongRows([1, 2, 3, 4, 5, 6, 7, 8].map((n) => wrong(`鸟${n}`)), '溢出')
    expect(rows).toHaveLength(8)
    expect(rows.some((r) => r.placeholder)).toBe(false)
    expect(rows[7]!.answer).toBe('鸟8')
  })

  it('>8 条：前 7 条 + 第 8 条占位', () => {
    const rows = buildWrongRows(
      Array.from({ length: 12 }, (_, i) => wrong(`鸟${i + 1}`)),
      '溢出',
    )
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
    expect(rows[7]!.answer).toBe('溢出')
  })

  it('0 条：空数组', () => {
    expect(buildWrongRows([], '溢出')).toHaveLength(0)
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
  it('默认指向官网地址（R35：正式域名 uniaoer.com）', () => {
    expect(DEFAULT_SITE_URL).toBe('https://uniaoer.com')
  })
})
