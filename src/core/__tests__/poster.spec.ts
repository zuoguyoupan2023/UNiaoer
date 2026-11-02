import { describe, it, expect } from 'vitest'
import {
  buildWrongRows,
  drawPoster,
  posterFilename,
  posterSources,
  POSTER_WRONG_MAX,
  POSTER_W,
  POSTER_H,
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
function stubCanvas(): { canvas: HTMLCanvasElement; texts: string[]; drawn: { text: string; y: number }[] } {
  const texts: string[] = []
  /** 记录每次 fillText 的 y（布局断言用：同一行 = 同一 baseline） */
  const drawn: { text: string; y: number }[] = []
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
    fillText: (t: string, _x?: number, y?: number) => {
      texts.push(String(t))
      drawn.push({ text: String(t), y: Number(y ?? 0) })
    },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
  ctx.canvas = canvas
  return { canvas, texts, drawn }
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
    memoryPairsLine: (n: number) => i18n.global.t('poster.canvas.memoryPairs', { n }),
    bgCreditName: (name: string, sci: string) => i18n.global.t('poster.canvas.bgCredit', { name, sci }),
    sourceLine: (sources: string[]) => i18n.global.t('poster.canvas.sourceLine', { sources: sources.join(' / ') }),
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

describe('海报 · 画布尺寸（2026-11-02 改 9:16）', () => {
  it('1080×1920（9:16 竖屏满屏比例）', () => {
    expect(POSTER_W).toBe(1080)
    expect(POSTER_H).toBe(1920)
    expect(POSTER_W / POSTER_H).toBe(9 / 16)
  })

  it('drawPoster 实际把画布设成该尺寸', () => {
    const { canvas } = stubCanvas()
    drawPoster(canvas, posterData([]), { themeId: 'white' }, posterStrings())
    expect(canvas.width).toBe(POSTER_W)
    expect(canvas.height).toBe(POSTER_H)
  })
})

describe('海报 · 错题区行选取（F2）', () => {
  it('最多展示 10 条，左右各 5（9:16 画布扩容，一轮 10 题可全放下）', () => {
    expect(POSTER_WRONG_MAX).toBe(10)
  })

  it('≤10 条：全部展示，无占位', () => {
    const rows = buildWrongRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => wrong(`鸟${n}`)), '溢出')
    expect(rows).toHaveLength(10)
    expect(rows.some((r) => r.placeholder)).toBe(false)
    expect(rows[9]!.answer).toBe('鸟10')
  })

  it('>10 条：前 9 条 + 第 10 条占位', () => {
    const rows = buildWrongRows(
      Array.from({ length: 14 }, (_, i) => wrong(`鸟${i + 1}`)),
      '溢出',
    )
    expect(rows).toHaveLength(10)
    expect(rows.slice(0, 9).map((r) => r.answer)).toEqual([
      '鸟1',
      '鸟2',
      '鸟3',
      '鸟4',
      '鸟5',
      '鸟6',
      '鸟7',
      '鸟8',
      '鸟9',
    ])
    expect(rows[9]!.placeholder).toBe(true)
    expect(rows[9]!.answer).toBe('溢出')
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

describe('海报 · 文件名（2026-10-09）', () => {
  it('UNiaoer-Test_Share_yyyy-mm-dd-hh-mm.png（本地时间，零填充）', () => {
    const d = new Date(2026, 9, 9, 7, 5) // 2026-10-09 07:05
    expect(posterFilename(d)).toBe('UNiaoer-Test_Share_2026-10-09-07-05.png')
  })

  it('逐分钟唯一：同一分钟相同、跨分钟不同（避免大量同名文件）', () => {
    const a = posterFilename(new Date(2026, 9, 9, 7, 5, 10))
    const b = posterFilename(new Date(2026, 9, 9, 7, 5, 59))
    const c = posterFilename(new Date(2026, 9, 9, 7, 6, 0))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('海报 · 是否包含测试内容（2026-10-09）', () => {
  const data = posterData([{ answer: '家燕', chosen: '金腰燕', timedOut: false }])

  it('默认（includeResults 未指定）：画成绩、正确率与错题', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(canvas, data, { themeId: 'white' }, posterStrings())
    const joined = texts.join('\n')
    expect(joined).toContain('8') // 得分
    expect(joined).toContain('/10')
    expect(joined).toContain('1. 家燕') // 错题行
    expect(joined).toContain('认成了「金腰燕」')
    expect(joined).toContain(i18n.global.t('poster.canvas.wrongHeading'))
  })

  it('includeResults=false（2026-10-25 用户定）：隐藏错题详情，但**分数与题目范围照常显示**', () => {
    const { canvas, texts } = stubCanvas()
    const strings = posterStrings()
    drawPoster(canvas, data, { themeId: 'white', includeResults: false }, strings)
    const joined = texts.join('\n')
    // 品牌头仍在（UNiaoer + 日期/模式标签）
    expect(joined).toContain('UNiaoer')
    expect(joined).toContain('鸟图版')
    // 分数与标题保留（分享主体是成绩）
    expect(joined).toContain('/10')
    expect(joined).toContain(strings.answeredTitle)
    expect(joined).toContain(strings.accuracyLine)
    // 错题详情整块消失
    expect(joined).not.toContain('1. 家燕')
    expect(joined).not.toContain('认成了「金腰燕」')
    expect(joined).not.toContain(strings.wrongHeading)
  })

  it('题目范围与正确率**同一行**（接在「正确率 … · L6 半鸟人」后面，2026-10-25 用户定）', () => {
    const { canvas, drawn } = stubCanvas()
    const strings = posterStrings()
    drawPoster(
      canvas,
      { ...data, correct: 6, accuracy: 60, regionLabel: '中国 · 上海' },
      { themeId: 'white' },
      strings,
    )
    const acc = drawn.find((d) => d.text === strings.accuracyLine)
    const region = drawn.find((d) => d.text.includes('中国 · 上海'))
    expect(acc).toBeTruthy()
    expect(region).toBeTruthy()
    expect(region!.y).toBe(acc!.y) // 同一 baseline
    expect(region!.text.startsWith('· ')).toBe(true) // 以分隔符接在后面
  })

  it('题目范围（regionLabel）在海报上显示——含全球', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      { ...data, regionLabel: '中国 · 上海' },
      { themeId: 'white' },
      posterStrings(),
    )
    expect(texts.join('\n')).toContain('中国 · 上海')
    const g = stubCanvas()
    drawPoster(g.canvas, { ...data, regionLabel: '全球' }, { themeId: 'white' }, posterStrings())
    expect(g.texts.join('\n')).toContain('全球')
  })

  it('全对时含内容 → 画「全对了」；不含内容 → 标题仍画但错题区文案不出现', () => {
    const perfect = { ...posterData([]), correct: 10, accuracy: 100 }
    const withR = stubCanvas()
    drawPoster(withR.canvas, perfect, { themeId: 'white' }, posterStrings())
    expect(withR.texts.join('\n')).toContain(i18n.global.t('poster.canvas.perfect'))

    const withoutR = stubCanvas()
    drawPoster(withoutR.canvas, perfect, { themeId: 'white', includeResults: false }, posterStrings())
    // 标题保留（分数可见），只有错题区（含「全对了」）消失
    expect(withoutR.texts.join('\n')).toContain(i18n.global.t('poster.canvas.perfect'))
    expect(withoutR.texts.join('\n')).not.toContain(i18n.global.t('poster.canvas.allCorrect'))
    expect(withoutR.texts.join('\n')).not.toContain(i18n.global.t('poster.canvas.wrongHeading'))
  })
})

/**
 * 064：二维码可选（默认勾选）。
 * 取消勾选 → 生成完全不含二维码的图（部分平台会因二维码判定为导流而限流），
 * 此时改为画站点域名，方便他人搜索。
 */describe('海报 · 二维码可选（includeQr）', () => {
  it('默认（includeQr 未传）→ 画扫码提示', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(canvas, posterData([]), { themeId: 'white' }, posterStrings())
    expect(texts.join('\n')).toContain(posterStrings().scanCta)
  })

  it('includeQr:false → 不画扫码提示、**也不画域名（完全留白）**，品牌名不放大（2026-10-25 用户定）', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(canvas, posterData([]), { themeId: 'white', includeQr: false }, posterStrings())
    const joined = texts.join('\n')
    expect(joined).not.toContain(posterStrings().scanCta)
    expect(joined).not.toContain('uniaoer.com')
    // 品牌名恒为 56px（不再按 includeQr 放大到 88）
    const sizes = (canvas.getContext('2d') as unknown as { __sizes?: number[] }).__sizes ?? []
    expect(sizes).not.toContain(88)
  })
})

/**
 * 2026-11-02（用户定）：页脚「数据来源」只写**本轮实际用到的**来源——
 * 图像版只有 iNaturalist，音频版才写 Xeno-canto；两个来源都用则两个都写。
 */
describe('海报 · 数据来源按实际素材生成', () => {
  it('posterSources：去重、固定顺序、忽略空值', () => {
    expect(posterSources(['iNaturalist', 'iNaturalist'])).toEqual(['iNaturalist'])
    expect(posterSources(['Xeno-canto', 'iNaturalist'])).toEqual(['iNaturalist', 'Xeno-canto'])
    expect(posterSources([undefined, '', null])).toEqual([])
  })

  it('图像版（只有 iNaturalist）→ 页脚不出现 Xeno-canto', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      { ...posterData([]), sources: posterSources(['iNaturalist']) },
      { themeId: 'white' },
      posterStrings(),
    )
    const joined = texts.join('\n')
    expect(joined).toContain('iNaturalist')
    expect(joined).not.toContain('Xeno-canto')
  })

  it('音频版含两来源 → 两个都写', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      { ...posterData([]), sources: posterSources(['Xeno-canto', 'iNaturalist']) },
      { themeId: 'white' },
      posterStrings(),
    )
    const joined = texts.join('\n')
    expect(joined).toContain('iNaturalist')
    expect(joined).toContain('Xeno-canto')
  })

  it('无来源（旧记录）→ 整行不画', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(canvas, posterData([]), { themeId: 'white' }, posterStrings())
    expect(texts.join('\n')).not.toContain('数据来源')
  })
})

/**
 * 2026-11-02（用户定）：背景用了某张鸟图时，按 CC 规范必须画**作者 / 许可证 / 来源**，
 * 同时画这只鸟的**名字 + 学名**（中文海报中文名、英文海报英文名，都没有则只画学名）。
 */
describe('海报 · 背景图署名', () => {
  /** 假 ImageBitmap：只要 width/height 够 computeCover 用 */
  const bg = { width: 800, height: 600 } as unknown as ImageBitmap

  it('有背景图 + bgCredit → 画鸟名/学名/作者/许可证/来源', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      posterData([]),
      {
        themeId: 'white',
        bgImage: bg,
        bgCredit: { name: '白头鹎', sci: 'Pycnonotus sinensis', author: '葉子', license: 'CC0', source: 'iNaturalist' },
      },
      posterStrings(),
    )
    const joined = texts.join('\n')
    expect(joined).toContain('白头鹎（Pycnonotus sinensis）')
    expect(joined).toContain('葉子 · CC0 · iNaturalist')
  })

  it('没有名称时只画学名（不出现空括号）', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      posterData([]),
      { themeId: 'white', bgImage: bg, bgCredit: { sci: 'Pycnonotus sinensis', author: 'A', license: 'CC-BY' } },
      posterStrings(),
    )
    const joined = texts.join('\n')
    expect(joined).toContain('Pycnonotus sinensis')
    expect(joined).not.toContain('（）')
  })

  it('纯色/内置背景（无 bgImage）→ 不画署名', () => {
    const { canvas, texts } = stubCanvas()
    drawPoster(
      canvas,
      posterData([]),
      { themeId: 'white', bgCredit: { name: '白头鹎', sci: 'Pycnonotus sinensis', author: '葉子', license: 'CC0' } },
      posterStrings(),
    )
    expect(texts.join('\n')).not.toContain('Pycnonotus sinensis')
  })
})
