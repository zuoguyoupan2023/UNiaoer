/** 每轮成绩海报：背景（极简场景/照片）+ 每字段半透明白底框，导出 PNG */
import qrcode from 'qrcode-generator'
import { ICON_NODES, type IconNode } from './iconPaths'
import { getBackground } from './posterScenes'
import { cleanAuthor } from './licenseGuard'

export interface PosterWrong {
  answer: string
  chosen: string | null
  timedOut: boolean
}

export interface PosterData {
  modeLabel: string
  tierLabel: string
  /**
   * 2026-10-25 用户定：**题目范围**（地区），如「中国 · 上海」「全球」。
   * 「中国上海看图版 L7」与「全球版」是不同难度体验，海报必须体现。
   * 缺省（旧调用方）不画该行。
   */
  regionLabel?: string
  correct: number
  total: number
  accuracy: number
  date: string
  /** F3：本次 session 的轮次（>1 时海报显示「第 N 轮」） */
  round?: number
  /** F3：本次 session 的整体正确率（含本轮） */
  overallAccuracy?: number
  /** R30：佩戴的称号（有则显示在日期旁） */
  wornTitle?: string
  /** R31：佩戴的徽章（有则显示在日期旁） */
  wornBadge?: string
  /** R38：佩戴称号的独特图标（lucide 名称，canvas 绘制用） */
  wornTitleIcon?: string
  /** R38：佩戴徽章的独特图标 */
  wornBadgeIcon?: string
  /** R33：用户昵称（有则显示在日期前） */
  nickname?: string
  /**
   * 092 记忆挑战鸟（tier=8）：**用时 + 评语**替代分数/正确率/错题回顾。
   * time/rating 是调用方按 locale 拼好的展示文本（core 不 import i18n）；
   * 有该字段时正文区画 评语标题 + 大号用时 + 「N 对全配平」，不画错题行。
   */
  memory?: { time: string; rating: string; pairs: number }
  /**
   * 本轮**实际用到**的素材来源（去重，如 `['iNaturalist']` / `['Xeno-canto', 'iNaturalist']`）。
   * 页脚「数据来源」按它生成——图像版只有 iNaturalist，音频版才出现 Xeno-canto；
   * 缺省（旧调用方）不画该行，避免把没用的来源写上去。
   */
  sources?: string[]
  wrong: PosterWrong[]
}

/** 可选作背景的鸟图（携带该题答案，供缩略图标注；wrong 为 F6 预留） */
export interface PosterImage {
  url: string
  /** 缩略图（C2）：候选列表小图用，缺省回退 url */
  thumbUrl?: string
  /** 母版原分辨率（C2）：海报背景用它保证成图质量，缺省回退 url */
  xlUrl?: string
  answer: string
  sci?: string
  wrong?: boolean
  /** 物种 id（署名行按海报语言取「中文名 / 英文名」，缺名则只画学名） */
  speciesId?: string
  /** 作者（CC 署名要求；有背景照片时画在海报上） */
  author?: string
  /** 许可证（CC 署名要求） */
  license?: string
  /** 素材来源站点（iNaturalist / Xeno-canto） */
  source?: string
}

/** 背景图署名：CC 协议要求展示作者 / 许可证 / 来源；鸟名按海报语言 */
export interface PosterCredit {
  /** 鸟名（中文海报用中文名、英文海报用英文名；都没有则空） */
  name?: string
  sci?: string
  author?: string
  license?: string
  source?: string
}

/**
 * 海报界面文案（015 §6.4/i18n-4）：core 不 import i18n，由调用方（PosterEditor）
 * 由 PosterEditor 用 t() 按 locale **带参**构造后注入；本模块不再做占位符替换
 * （vue-i18n 已在 t() 阶段完成插值——不带参会把 {x} 变成空串，见 mistakenAs 注释）。
 */
export interface PosterStrings {
  /** 多轮时的轮次标签，如「第 2 轮」 */
  roundLabel: string
  /** 「在认鸟测试中」 */
  intro: string
  /** 满分主标题 */
  perfectTitle: string
  /** 非满分主标题 */
  answeredTitle: string
  /** 正确率行（含数字，调用方拼好） */
  accuracyLine: string
  /** 「错题回顾」 */
  wrongHeading: string
  /** 无错题提示 */
  allCorrect: string
  /** 错题超出 8 条时的占位文案 */
  overflow: string
  /** 「超时未作答」 */
  timedOut: string
  /**
   * 错选行文案：**必须带参构造**（名字 → 完整句子）。
   *
   * 为什么是函数而不是含 `{name}` 的字符串：这条文案经 vue-i18n 的 `t()` 取值，
   * 而 vue-i18n 会把 `{name}` 当**插值变量**——不带参调用时它被替换成空串
   * （实测 `t('poster.canvas.mistakenAs')` → `认成了「」`，占位符已不存在），
   * 画布侧再 `.replace('{name}', …)` 永远匹配不到 → 渲染出空括号。
   * 故插值交给 i18n 带参完成，画布侧不再做字符串替换（2026-10-08 修复，见 docs/034）。
   */
  mistakenAs: (name: string) => string
  /**
   * 092 记忆挑战鸟：记忆轮的副行「N 对全部配对成功」（带参构造，理由同 mistakenAs）。
   */
  memoryPairsLine: (pairs: number) => string
  /**
   * 背景图署名首行：鸟名 + 学名（带参构造，理由同 mistakenAs）。
   * 只有其中一项时不要调用它——调用方只传非空值，或直接用单项。
   */
  bgCreditName: (name: string, sci: string) => string
  /**
   * 页脚数据来源：**按实际用到的来源动态生成**（图像版只有 iNaturalist，
   * 音频版才有 Xeno-canto；两个来源都用则两个都写）。
   * 函数形态的理由同 mistakenAs：插值必须在 i18n 的 t() 里带参完成。
   */
  sourceLine: (sources: string[]) => string
  /** 二维码下方提示 */
  scanCta: string
}

export interface PosterOptions {
  /** 背景 id（见 posterScenes） */
  themeId: string
  bgImage?: ImageBitmap | null
  bgOffset?: { x: number; y: number }
  /**
   * 背景照片署名（CC 协议要求：作者 / 许可证 / 来源；同时画鸟名与学名）。
   * 仅在 `bgImage` 存在时绘制——纯色/内置场景背景不画。
   */
  bgCredit?: PosterCredit
  /** 右下角二维码指向的站点（占位文案/后续替换真码用） */
  qrUrl?: string
  /** 真二维码图（可选，提供后替代占位框） */
  qrImage?: ImageBitmap | null
  /**
   * 是否画本轮测试内容（成绩/正确率/错题回顾），默认 true。
   * 用户在海报弹层取消勾选「海报包含本组测试内容」时传 false —— 隐私取向：
   * 只留品牌头/日期/称号徽章/页脚与二维码，**不出现任何本轮成绩信息**（2026-10-09 用户要求）。
   */
  includeResults?: boolean
  /**
   * 是否画二维码，默认 true。
   * 用户可取消勾选「海报包含二维码」→ 生成**完全不含二维码**的图（部分平台会因二维码判定为
   * 广告/导流而限流）；此时品牌名放大，并在二维码位置改画站点域名，方便他人自行搜索。
   */
  includeQr?: boolean
}

/** 官网地址（二维码默认指向；正式域名确定后替换） */
/** 官网地址（二维码默认指向；R35：正式域名 uniaoer.com，已绑定 Pages） */
export const DEFAULT_SITE_URL = 'https://uniaoer.com'

/**
 * 海报错题区最多展示条数（左右各 5）。
 * 一轮最多 10 题（quiz 默认 `count: 10`），9:16 画布纵向足够 → 全对时 10 条都能放下；
 * 旧的 3:4 画布只能放 8 条（2026-11-02 随 9:16 一起扩容）。
 */
export const POSTER_WRONG_MAX = 10

/**
 * 本轮素材来源去重（2026-11-02 用户定）：页脚只写**实际用到的**来源。
 * 固定顺序 iNaturalist → Xeno-canto → 其它，保证同一轮多次生成/结果页与历史页一致。
 */
export function posterSources(list: (string | null | undefined)[]): string[] {
  const fixed = ['iNaturalist', 'Xeno-canto']
  const set = new Set(list.map((s) => s?.trim() || '').filter(Boolean))
  return [...fixed.filter((s) => set.has(s)), ...[...set].filter((s) => !fixed.includes(s)).sort()]
}

/** 海报错题行：真实错题，或"放不下了"占位行 */
export interface PosterWrongRow extends PosterWrong {
  placeholder?: boolean
}

/**
 * 选取用于海报展示的错题行（F2）：
 * - ≤8 条：全部展示
 * - >8 条：展示前 7 条，第 8 条替换为 overflowLabel（占位文案由调用方按 locale 提供）
 */
export function buildWrongRows(wrong: PosterWrong[], overflowLabel: string): PosterWrongRow[] {
  const overflow = wrong.length > POSTER_WRONG_MAX
  const kept = overflow ? wrong.slice(0, POSTER_WRONG_MAX - 1) : wrong.slice(0, POSTER_WRONG_MAX)
  const rows: PosterWrongRow[] = kept.map((w) => ({ ...w }))
  if (overflow) rows.push({ answer: overflowLabel, chosen: null, timedOut: false, placeholder: true })
  return rows
}

/**
 * 海报画布尺寸：**1080×1920（9:16）**。
 *
 * 2026-11-02 用户定：原 1080×1440（3:4）在手机上偏瘦长、信息挤在中段。
 * 9:16 是竖屏原生的满屏比例，纵向多出的 480px 用来放大分数主体、放宽行距，
 * 并把错题容量从 8 条提到 10 条（一轮最多 10 题，正好能全放下，左右各 5）。
 */
export const POSTER_W = 1080
export const POSTER_H = 1920
const W = POSTER_W
const H = POSTER_H
/**
 * 纵向版式（9:16）。旧 3:4 用零散绝对 y，改比例时无处下手；这里集中成一张表：
 * 头部 → 内容主块 → 错题区 → 底部署名/页脚，各段留白随画布加高而放大。
 * 换回其它比例时只改本表与 POSTER_H 即可。
 */
const L = {
  /** 品牌名 / 日期 / 称号胶囊 */
  brand: 170,
  date: 244,
  chipsTop: 280,
  /** 顶部左右角标签（模式 / 轮次） */
  cornerChipTop: 66,
  /** 含测试内容时的正文块 */
  intro: 590,
  title: 760,
  score: 1040,
  accuracy: 1170,
  wrongHeading: 1268,
  wrongTop: 1340,
  wrongRowGap: 74,
  /** 隐藏错题详情时的正文块（内容少 → 整体下移，避免上半空、下半挤） */
  introCompact: 860,
  titleCompact: 1030,
  scoreCompact: 1260,
  accuracyCompact: 1382,
} as const

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

interface Palette {
  dark: string
  muted: string
  accent: string
  wrong: string
  /** 字段底框颜色；null 表示无底框（纯色背景直接铺字） */
  box: string | null
  /** 模式标签胶囊：背景 / 文字 */
  chipBg: string
  chipText: string
}

/** 有底框：白底黑字（用于场景/照片背景） */
const PALETTE_BOXED: Palette = {
  dark: '#14342a',
  muted: '#5a7a6f',
  accent: '#2d6a4f',
  wrong: '#c1121f',
  box: 'rgba(255,255,255,0.82)',
  chipBg: 'rgba(255,255,255,0.82)',
  chipText: '#14342a',
}
/** 无底框·暗色纯色：白字直接铺在背景上 */
const PALETTE_PLAIN: Palette = {
  dark: '#ffffff',
  muted: 'rgba(255,255,255,0.82)',
  accent: '#e9b949',
  wrong: '#ffc2c7',
  box: null as string | null,
  chipBg: 'rgba(255,255,255,0.18)',
  chipText: '#ffffff',
}
/** 无底框·浅色纯色（纯白）：深字直接铺在背景上 */
const PALETTE_PLAIN_LIGHT: Palette = {
  dark: '#14181a',
  muted: 'rgba(20,24,26,0.6)',
  accent: '#2d6a4f',
  wrong: '#c1121f',
  box: null,
  chipBg: 'rgba(20,24,26,0.08)',
  chipText: '#14181a',
}

interface Seg {
  text: string
  color: string
  weight: number
  size: number
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 计算背景图 cover 布局（含平移），夹取到不留空白 */
export function computeCover(imgW: number, imgH: number, offset?: { x: number; y: number }) {
  const scale = Math.max(W / imgW, H / imgH)
  const dw = imgW * scale
  const dh = imgH * scale
  const x = Math.min(0, Math.max(W - dw, (W - dw) / 2 + (offset?.x ?? 0)))
  const y = Math.min(0, Math.max(H - dh, (H - dh) / 2 + (offset?.y ?? 0)))
  return { x, y, dw, dh }
}

/** 按给定字体把文本截断到 maxWidth 内（超出补 …） */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  size: number,
  maxWidth: number,
): string {
  ctx.font = `${weight} ${size}px ${FONT}`
  if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

const GAP = 10
const PAD_X = 14
const PAD_Y = 8

/** 画一组文字片段；有 box 时铺半透明白底框（白底黑字），无 box 时直接绘制（纯色背景） */
function drawSegments(
  ctx: CanvasRenderingContext2D,
  segs: Seg[],
  anchor: number,
  baseline: number,
  align: 'center' | 'left',
  box: string | null,
) {
  const widths = segs.map((s) => {
    ctx.font = `${s.weight} ${s.size}px ${FONT}`
    return ctx.measureText(s.text).width
  })
  const total = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, segs.length - 1)
  const maxSize = Math.max(...segs.map((s) => s.size))

  let startX: number
  if (box) {
    const boxW = total + PAD_X * 2
    const boxH = maxSize + PAD_Y * 2
    const boxX = align === 'center' ? anchor - boxW / 2 : anchor - PAD_X
    const boxY = baseline - maxSize * 0.78 - PAD_Y
    ctx.fillStyle = box
    roundRect(ctx, boxX, boxY, boxW, boxH, 16)
    ctx.fill()
    startX = align === 'center' ? boxX + PAD_X : anchor
  } else {
    startX = align === 'center' ? anchor - total / 2 : anchor
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let x = startX
  segs.forEach((s, i) => {
    ctx.font = `${s.weight} ${s.size}px ${FONT}`
    ctx.fillStyle = s.color
    ctx.fillText(s.text, x, baseline)
    x += widths[i]! + GAP
  })
}

/** F4：右下角官网二维码（可扫码；有自定义真码图则优先使用） */
const QR_SIZE = 170
const QR_MARGIN = 36
const QR_QUIET = 4
/**
 * 二维码底部预留高度：码下方还要画「扫码访问官网」一行。
 * 2026-11-02 发现该行基线固定在 `y + size + 22`，改 9:16 后仍按画布底边算 → 落到画布外被裁；
 * 现统一由 QR_BOTTOM_PAD 抬起来，并让页脚与它同基线（见 drawPoster 尾部）。
 */
const QR_BOTTOM_PAD = 56

function drawQrSlot(ctx: CanvasRenderingContext2D, P: Palette, opts: PosterOptions, strings: PosterStrings) {
  const size = QR_SIZE
  const x = W - QR_MARGIN - size
  const y = H - QR_BOTTOM_PAD - size

  // 用户取消勾选「包含二维码」→ **完全留白**（2026-10-25 用户定）：
  // 原先在二维码位置画 uniaoer.com 域名，但社媒多会因图中出现网址而限流/屏蔽，
  // 故不画任何内容（品牌名也不放大，避免形成"变相导流"观感）。
  if (opts.includeQr === false) return

  if (opts.qrImage) {
    ctx.drawImage(opts.qrImage, x, y, size, size)
  } else {
    const url = opts.qrUrl ?? DEFAULT_SITE_URL
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    const count = qr.getModuleCount()
    const cell = Math.max(1, Math.floor(size / (count + QR_QUIET * 2)))
    const qrPx = cell * count
    const qrX = x + Math.floor((size - qrPx) / 2)
    const qrY = y + Math.floor((size - qrPx) / 2)

    ctx.fillStyle = '#ffffff'
    roundRect(ctx, x, y, size, size, 12)
    ctx.fill()

    ctx.fillStyle = '#000000'
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) ctx.fillRect(qrX + col * cell, qrY + row * cell, cell, cell)
      }
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = P.muted
  ctx.font = `400 18px ${FONT}`
  ctx.fillText(strings.scanCta, x + size / 2, y + size + 22)
}

/** 星芒（称号胶囊图标，R37） */
function drawSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.quadraticCurveTo(cx, cy, cx + r, cy)
  ctx.quadraticCurveTo(cx, cy, cx, cy + r)
  ctx.quadraticCurveTo(cx, cy, cx - r, cy)
  ctx.quadraticCurveTo(cx, cy, cx, cy - r)
  ctx.fill()
}

/** 奖牌（徽章胶囊图标，R37） */
function drawMedal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/**
 * 在 canvas 上绘制 lucide 图标（R38）：24 viewBox 缩放到 size，描边风格与组件一致。
 * 返回 false 表示无该图标数据（调用方可走通用图形兜底）。
 */
function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  size: number,
  color: string,
): boolean {
  const nodes: IconNode[] | undefined = ICON_NODES[name]
  if (!nodes) return false
  const scale = size / 24
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  for (const [tag, attrs] of nodes) {
    ctx.beginPath()
    if (tag === 'path') {
      ctx.stroke(new Path2D(attrs.d ?? ''))
      continue
    }
    const num = (k: string) => Number(attrs[k] ?? 0)
    if (tag === 'circle') ctx.arc(num('cx'), num('cy'), num('r'), 0, Math.PI * 2)
    else if (tag === 'line') {
      ctx.moveTo(num('x1'), num('y1'))
      ctx.lineTo(num('x2'), num('y2'))
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pts = String(attrs.points ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number))
      pts.forEach(([px = 0, py = 0], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      if (tag === 'polygon') ctx.closePath()
    } else if (tag === 'rect') {
      ctx.rect(num('x'), num('y'), num('width'), num('height'))
    }
    ctx.stroke()
  }
  ctx.restore()
  return true
}

export function drawPoster(
  canvas: HTMLCanvasElement,
  data: PosterData,
  opts: PosterOptions,
  strings: PosterStrings,
): void {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const hasImage = !!opts.bgImage

  // 背景
  if (hasImage && opts.bgImage) {
    const { x, y, dw, dh } = computeCover(opts.bgImage.width, opts.bgImage.height, opts.bgOffset)
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(opts.bgImage, x, y, dw, dh)
  } else {
    getBackground(opts.themeId).draw(ctx, W, H)
  }

  // 背景框：仅"背景照片"启用；官方内置背景一律无框，按明暗选深/浅字色
  const bg = getBackground(opts.themeId)
  const P = hasImage ? PALETTE_BOXED : bg.light ? PALETTE_PLAIN_LIGHT : PALETTE_PLAIN
  const box = hasImage ? PALETTE_BOXED.box : null

  ctx.textBaseline = 'alphabetic'

  // 顶部标题（无 emoji、无“鸟语识别”）；昵称前缀 + 佩戴称号/徽章胶囊（R30–R33）
  // 2026-10-25：不含二维码的版本不再放大品牌名（避免社媒判为导流）
  const dateLine = [data.nickname ? `@${data.nickname}` : '', data.date].filter(Boolean).join(' · ')
  const brandSize = 64
  drawSegments(ctx, [{ text: 'UNiaoer', color: P.dark, weight: 800, size: brandSize }], W / 2, L.brand, 'center', box)
  drawSegments(ctx, [{ text: dateLine, color: P.muted, weight: 400, size: 30 }], W / 2, L.date, 'center', box)

  // 佩戴称号/徽章胶囊（R37 放大 + 图标）：无则不占位
  const chips: { label: string; icon: string; kind: 'title' | 'badge' }[] = []
  if (data.wornTitle)
    chips.push({ label: data.wornTitle, icon: data.wornTitleIcon ?? '', kind: 'title' })
  if (data.wornBadge)
    chips.push({ label: data.wornBadge, icon: data.wornBadgeIcon ?? '', kind: 'badge' })
  if (chips.length) {
    const chipText = 40
    const iconSlot = 52
    const padX = 34
    const gap = 24
    const ch = 84
    const cy = L.chipsTop
    ctx.font = `700 ${chipText}px ${FONT}`
    const widths = chips.map(
      (c) => padX * 2 + iconSlot + ctx.measureText(c.label).width,
    )
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1)
    let cx = (W - total) / 2
    for (let i = 0; i < chips.length; i++) {
      ctx.fillStyle = P.chipBg
      roundRect(ctx, cx, cy, widths[i]!, ch, 42)
      ctx.fill()
      const iconCx = cx + padX + 4
      const iconCy = cy + ch / 2 - 20
      const textColor = P.chipText
      // R38：绘制每枚称号/徽章的独特图标；无数据时退回通用图形
      if (!drawLucideIcon(ctx, chips[i]!.icon, iconCx, iconCy, 40, textColor)) {
        if (chips[i]!.kind === 'title') drawSparkle(ctx, iconCx + 20, iconCy + 20, 19, textColor)
        else drawMedal(ctx, iconCx + 20, iconCy + 20, 15, textColor)
      }
      ctx.fillStyle = P.chipText
      ctx.textAlign = 'left'
      ctx.font = `700 ${chipText}px ${FONT}`
      ctx.fillText(chips[i]!.label, cx + padX + iconSlot, cy + ch / 2 + chipText * 0.36)
      cx += widths[i]! + gap
    }
  }

  // 右上角模式标签
  ctx.font = `700 32px ${FONT}`
  const bw = ctx.measureText(data.modeLabel).width + 48
  const bx = W - 60 - bw
  const by = L.cornerChipTop
  ctx.fillStyle = P.chipBg
  roundRect(ctx, bx, by, bw, 60, 30)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = P.chipText
  ctx.fillText(data.modeLabel, bx + bw / 2, by + 41)

  // 左上角轮次标签（多轮 session 时，F3）
  if (data.round && data.round > 1) {
    const rt = strings.roundLabel
    ctx.font = `700 32px ${FONT}`
    const rw = ctx.measureText(rt).width + 48
    ctx.fillStyle = P.chipBg
    roundRect(ctx, 60, L.cornerChipTop, rw, 60, 30)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.fillStyle = P.chipText
    ctx.fillText(rt, 60 + rw / 2, L.cornerChipTop + 41)
  }

  // 本轮测试内容（成绩/正确率/错题）：取消勾选时整块不画（只留品牌面）
  if (opts.includeResults !== false) {
    // 错题行先算出来：**块内容量决定整块下移多少**——全对/错题少时若照旧贴顶部，
    // 下半屏会空出三四百像素（2026-11-02 截图实测）。这里把「内容底边到页脚还有多少」
    // 的一半补到顶部留白，全对时也不会头重脚轻。
    const wrongRows = data.memory ? [] : buildWrongRows(data.wrong, strings.overflow)
    const perCol = POSTER_WRONG_MAX / 2
    // 错题**两列**排布（x 左 60 / 右 560）→ 每列行数 = 总条数 ÷ 2。
    // 2026-11-02 曾误写成 ÷ perCol(=5)，只有 10 条时算出 2 行、居中位移虚高 175px，
    // 把第 5 行错题顶到右下角二维码上。
    const colRows = Math.max(1, Math.ceil(wrongRows.length / 2))
    const contentBottom = data.memory
      ? L.accuracy
      : wrongRows.length
        ? L.wrongTop + (colRows - 1) * L.wrongRowGap
        : L.wrongTop
    // 下移上限：**右列错题（x 560–1000）会撞上右下角二维码**，而二维码顶部在
    // H − QR_BOTTOM_PAD − QR_SIZE。故含二维码时以此为硬边界（2026-11-02 实测溢出）。
    let contentLimit = H - 70
    if (opts.includeQr !== false) contentLimit = Math.min(contentLimit, H - QR_BOTTOM_PAD - QR_SIZE - 30)
    // 有背景署名时还要再让出下方两行署名
    if (hasImage && opts.bgCredit) contentLimit = Math.min(contentLimit, H - QR_BOTTOM_PAD - 130)
    const dy = Math.min(200, Math.max(0, (contentLimit - contentBottom) / 2))

    /** 内容块内的纵向位置（dy 统一下移，保持块内相对间距不变） */
    const at = (v: number) => v + dy

    // 正文
    drawSegments(ctx, [{ text: strings.intro, color: P.muted, weight: 400, size: 42 }], W / 2, at(L.intro), 'center', box)
    if (data.memory) {
      // 092 记忆挑战鸟：**用时 + 评语**，不显示 0–100 分数（docs/092 §4.1/§8.4）——
      // 评语作主标题、大号用时替代 correct/total、副行「N 对全配平」；无错题区。
      drawSegments(
        ctx,
        [{ text: data.memory.rating, color: P.dark, weight: 800, size: 68 }],
        W / 2,
        at(L.title),
        'center',
        box,
      )
      drawSegments(
        ctx,
        [{ text: data.memory.time, color: P.accent, weight: 800, size: 180 }],
        W / 2,
        at(L.score),
        'center',
        box,
      )
      drawSegments(
        ctx,
        [
          // 游戏名称必须出现在海报上（2026-10-27 用户反馈：记忆轮原来只有用时，看不出是什么游戏）
          { text: data.tierLabel, color: P.dark, weight: 700, size: 30 },
          { text: ` · ${strings.memoryPairsLine(data.memory.pairs)}`, color: P.muted, weight: 500, size: 30 },
          ...(data.regionLabel
            ? [{ text: `· ${data.regionLabel}`, color: P.accent, weight: 700, size: 30 }]
            : []),
        ],
        W / 2,
        at(L.accuracy),
        'center',
        box,
      )
    } else {
      const perfect = data.total > 0 && data.correct === data.total
      drawSegments(
        ctx,
        [{ text: perfect ? strings.perfectTitle : strings.answeredTitle, color: P.dark, weight: 800, size: 68 }],
        W / 2,
        at(L.title),
        'center',
        box,
      )
      drawSegments(
        ctx,
        [
          { text: String(data.correct), color: P.accent, weight: 800, size: 180 },
          { text: `/${data.total}`, color: P.muted, weight: 600, size: 52 },
        ],
        W / 2,
        at(L.score),
        'center',
        box,
      )
      const accText = strings.accuracyLine
      // 2026-10-25 用户定：题目范围接在「正确率 … · L6 半鸟人」**后面**（同一行，换色区分），
      // 不再单独占上方一行——「中国上海看图版 L7」与「全球版」在此即可区分。
      drawSegments(
        ctx,
        [
          { text: accText, color: P.muted, weight: 500, size: 30 },
          ...(data.regionLabel
            ? [{ text: `· ${data.regionLabel}`, color: P.accent, weight: 700, size: 30 }]
            : []),
        ],
        W / 2,
        at(L.accuracy),
        'center',
        box,
      )

      // 错题回顾（F2：最多 10 条，左右各 5；超出则前 9 + 「这里放不下了」）
      drawSegments(
        ctx,
        [{ text: strings.wrongHeading, color: P.muted, weight: 600, size: 30 }],
        60,
        at(L.wrongHeading),
        'left',
        box,
      )
      if (wrongRows.length === 0) {
        drawSegments(
          ctx,
          [{ text: strings.allCorrect, color: P.accent, weight: 400, size: 30 }],
          60,
          at(L.wrongTop),
          'left',
          box,
        )
      } else {
        const colWidth = 440
        ctx.textAlign = 'left'
        wrongRows.forEach((w, i) => {
          const x = i < perCol ? 60 : 560
          const y = at(L.wrongTop) + (i % perCol) * L.wrongRowGap
          if (w.placeholder) {
            drawSegments(
              ctx,
              [{ text: `${i + 1}. ${strings.overflow}`, color: P.wrong, weight: 600, size: 27 }],
              x,
              y,
              'left',
              box,
            )
            return
          }
          const head = { text: `${i + 1}. ${w.answer}`, color: P.dark, weight: 600, size: 28 }
          const mineText = w.timedOut ? strings.timedOut : strings.mistakenAs(w.chosen ?? '—')
          ctx.font = `600 28px ${FONT}`
          const headW = ctx.measureText(head.text).width
          const mine = fitText(ctx, mineText, 400, 26, Math.max(60, colWidth - headW - GAP))
          drawSegments(ctx, [head, { text: mine, color: P.wrong, weight: 400, size: 26 }], x, y, 'left', box)
        })
      }
    }
  } else {
    // 2026-10-25 用户定：取消「包含本组测试内容」= 隐藏**详情**（错题回顾等），
    // 但**分数与题目范围照常显示**——成绩本身是分享主体，隐藏它反而失去海报意义。
    // 092 记忆轮：这里的"分数"就是用时（评语在 includeResults 时作主标题，这里一并显示）。
    // 无错题区 → 竖直方向仍有大段留白，同样按「内容底边到页脚的一半」上提居中。
    const compactBottom = L.accuracyCompact
    let compactLimit = H - 130
    if (opts.includeQr !== false) compactLimit = Math.min(compactLimit, H - QR_BOTTOM_PAD - QR_SIZE - 30)
    if (hasImage && opts.bgCredit) compactLimit = Math.min(compactLimit, H - QR_BOTTOM_PAD - 130)
    const cdy = Math.min(260, Math.max(0, (compactLimit - compactBottom) / 2))
    const cat = (v: number) => v + cdy

    drawSegments(
      ctx,
      [{ text: strings.intro, color: P.muted, weight: 400, size: 42 }],
      W / 2,
      cat(L.introCompact),
      'center',
      box,
    )
    if (data.memory) {
      drawSegments(
        ctx,
        [{ text: `${data.memory.rating} · ${data.memory.time}`, color: P.dark, weight: 800, size: 68 }],
        W / 2,
        cat(L.titleCompact),
        'center',
        box,
      )
      drawSegments(
        ctx,
        [
          { text: data.tierLabel, color: P.dark, weight: 700, size: 30 },
          { text: ` · ${strings.memoryPairsLine(data.memory.pairs)}`, color: P.muted, weight: 500, size: 30 },
          ...(data.regionLabel
            ? [{ text: `· ${data.regionLabel}`, color: P.accent, weight: 700, size: 30 }]
            : []),
        ],
        W / 2,
        cat(L.accuracyCompact),
        'center',
        box,
      )
    } else {
      const perfect = data.total > 0 && data.correct === data.total
      drawSegments(
        ctx,
        [{ text: perfect ? strings.perfectTitle : strings.answeredTitle, color: P.dark, weight: 800, size: 68 }],
        W / 2,
        cat(L.titleCompact),
        'center',
        box,
      )
      drawSegments(
        ctx,
        [
          { text: String(data.correct), color: P.accent, weight: 800, size: 180 },
          { text: `/${data.total}`, color: P.muted, weight: 600, size: 52 },
        ],
        W / 2,
        cat(L.scoreCompact),
        'center',
        box,
      )
      drawSegments(
        ctx,
        [
          { text: strings.accuracyLine, color: P.muted, weight: 500, size: 30 },
          ...(data.regionLabel
            ? [{ text: `· ${data.regionLabel}`, color: P.accent, weight: 700, size: 30 }]
            : []),
        ],
        W / 2,
        cat(L.accuracyCompact),
        'center',
        box,
      )
    }
  }

/**
 * 页脚（左对齐，给右下角二维码让位）。
 * 2026-11-02（用户定）：素材来源按**本轮实际用到的**动态生成——图像版只有 iNaturalist，
 * 音频版才有 Xeno-canto；两个来源都用则两个都写。取不到来源（旧记录）→ 整行不画。
 * 基线与二维码下方「扫码访问官网」完全同高，读起来是一条水平线。
 */
  const sources = data.sources ?? []
  // 旧记录可能没有 sources：此时用背景图自己的来源补上，保证 CC 要求的"来源"仍在图里
  // （新记录里它已包含在 sources 中，posterSources 会去重，不会重复出现）
  const footerSources =
    hasImage && opts.bgCredit?.source
      ? posterSources([...sources, opts.bgCredit.source])
      : sources
  // 不含二维码时整行可以铺满；含二维码必须给右下角的码让位（2026-11-02）
  const footerMaxW =
    opts.includeQr === false ? W - 120 : W - QR_MARGIN - QR_SIZE - 30 - 60 - PAD_X
  const footerBaseline = H - QR_BOTTOM_PAD + 22
  if (footerSources.length) {
    drawSegments(
      ctx,
      [
        {
          text: fitText(ctx, strings.sourceLine(footerSources), 400, 24, footerMaxW),
          color: P.muted,
          weight: 400,
          size: 24,
        },
      ],
      60,
      footerBaseline,
      'left',
      box,
    )
  }

  // 背景照片署名（CC 要求：鸟名 + 学名 + 作者 / 许可证 / 来源）
  if (hasImage && opts.bgCredit) drawBgCredit(ctx, P, box, opts.bgCredit, strings, footerMaxW)

  // 右下角二维码位（F4）
  drawQrSlot(ctx, P, opts, strings)
}

/**
 * 背景照片署名（2026-11-02 用户定）：CC 协议要求展示**作者 / 许可证 / 来源**；
 * 同时展示背景图那只鸟的**名字 + 学名**（中文海报显示中文名、英文海报显示英文名，
 * 都没有就只显示学名）。两行，左对齐叠在页脚数据来源上方。
 */
function drawBgCredit(
  ctx: CanvasRenderingContext2D,
  P: Palette,
  box: string | null,
  credit: PosterCredit,
  strings: PosterStrings,
  maxWidth: number,
) {
  // 第一行：鸟名 · 学名（两个都有走 i18n 组合；只有一个就单画）
  const name = credit.name?.trim() || ''
  const sci = credit.sci?.trim() || ''
  const nameLine = name && sci ? strings.bgCreditName(name, sci) : name || sci

  // 第二行：作者 · 许可证。
  //  · **不写来源站点**——页脚「数据来源」已经写了，同一张图上重复出现「iNaturalist」
  //    会显得啰嗦；CC 要求的"来源"由页脚那行承担。
  //  · 作者先过 cleanAuthor：manifest 里存的是 iNat attribution 全文
  //    （`(c) 名字, some rights reserved (CC BY-NC), uploaded by 名字`）。
  //    该函数同时剥掉重复的「上传者」——实测 1,946 条带上传者的记录里，
  //    上传者与创作者**无一例不同人**（2 例仅是 HTML 实体差异），
  //    故省略上传者不损失任何署名信息（2026-11-02 用户确认）。
  const authorName = cleanAuthor(credit.author)
  const metaLine = [authorName, credit.license]
    .map((x) => x?.trim() || '')
    .filter(Boolean)
    .join(' · ')

  // 署名块自底向上排：页脚 → 元数据行（可能多行）→ 鸟名行。
  // 每行白底框 = 字号 + 2×PAD_Y 高，故相邻基线要留够 42px 才不压框；
  // 元数据行数不固定（长机构名会折行），所以**按行数动态上推**鸟名行，
  // 否则折行会把鸟名盖住（2026-11-02 实测）。
  const footerBaseline = H - QR_BOTTOM_PAD + 22
  const metaLines = metaLine ? fitCreditLine(ctx, metaLine, maxWidth) : []
  // 元数据最后一行基线 = 页脚上方 42px；往上每行再退 30px
  const metaBottom = footerBaseline - 42
  const nameBaseline = metaBottom - (metaLines.length ? (metaLines.length - 1) * 30 + 42 : 42)

  if (nameLine) {
    const nl = shrinkToFit(ctx, nameLine, 600, 26, 18, maxWidth)
    drawSegments(
      ctx,
      [{ text: nl.text, color: P.dark, weight: 600, size: nl.size }],
      60,
      nameBaseline,
      'left',
      box,
    )
  }
  metaLines.forEach((ln, i) => {
    drawSegments(
      ctx,
      [{ text: ln.text, color: P.muted, weight: 400, size: ln.size }],
      60,
      metaBottom - (metaLines.length - 1 - i) * 30,
      'left',
      box,
    )
  })
}

/**
 * 署名行排版：单行放得下就缩字号（最小 16px）；仍超宽则按「作者 / 许可证」折成两行，
 * 必要时再按字符折。许可证必须完整可见（CC 要求），故绝不用省略号砍掉它。
 */
function fitCreditLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): { text: string; size: number }[] {
  const single = shrinkMaybe(ctx, text, 22, 16, maxWidth)
  if (single) return [{ text, size: single }]

  // 折行优先在「 · 」处断开（作者 · 许可证）
  const parts = text.split(' · ')
  const lines: string[] = []
  for (const p of parts) {
    if (!lines.length) lines.push(p)
    else if (ctx.measureText(`${lines[lines.length - 1]} · ${p}`).width <= maxWidth && lines.length === 1)
      lines[0] += ` · ${p}`
    else lines.push(p)
  }
  // 每行再确保放得下（超长机构名按字符硬折）
  const out: { text: string; size: number }[] = []
  for (const ln of lines.flatMap((l) => wrapByWidth(ctx, l, maxWidth))) {
    const size = shrinkMaybe(ctx, ln, 22, 16, maxWidth)
    out.push({ text: ln, size: size ?? 16 }) // 16px 下 wrapByWidth 已保证宽度
  }
  return out
}

/** 能放下就返回可用的最大字号，否则 null */
function shrinkMaybe(
  ctx: CanvasRenderingContext2D,
  text: string,
  max: number,
  min: number,
  maxWidth: number,
): number | null {
  for (let s = max; s >= min; s--) {
    ctx.font = `400 ${s}px ${FONT}`
    if (ctx.measureText(text).width <= maxWidth) return s
  }
  return null
}

/** 按字符折行（先按空格，超过宽度再逐字切），用于超长机构名 */
function wrapByWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  ctx.font = `400 16px ${FONT}`
  if (ctx.measureText(text).width <= maxWidth) return [text]
  const words = text.split(/(\s+)/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (ctx.measureText(cur + w).width <= maxWidth) {
      cur += w
      continue
    }
    if (cur) lines.push(cur.trim())
    cur = ''
    // 单个词本身就超宽 → 逐字切
    if (ctx.measureText(w).width > maxWidth) {
      let chunk = ''
      for (const ch of w) {
        if (ctx.measureText(chunk + ch).width > maxWidth) {
          lines.push(chunk)
          chunk = ch
        } else chunk += ch
      }
      cur = chunk
    } else cur = w
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines
}

/**
 * 缩小字号直到整行放得下（最小 minSize）；到最小仍超宽才用 fitText 截断。
 * 用于**鸟名行**（名字+学名），截断可接受；作者/许可证行走 fitCreditLine 折行，不截断。
 */
function shrinkToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  size: number,
  minSize: number,
  maxWidth: number,
): { text: string; size: number } {
  for (let s = size; s >= minSize; s--) {
    ctx.font = `${weight} ${s}px ${FONT}`
    if (ctx.measureText(text).width <= maxWidth) return { text, size: s }
  }
  return { text: fitText(ctx, text, weight, minSize, maxWidth), size: minSize }
}

export function renderPoster(
  data: PosterData,
  opts: PosterOptions,
  strings: PosterStrings,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawPoster(canvas, data, opts, strings)
  return canvas
}

/** 把 canvas 转成 PNG Blob；旧浏览器无 `toBlob` 时回退 `toDataURL` */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
      return
    }
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const bin = atob(dataUrl.split(',')[1] ?? '')
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      resolve(new Blob([bytes], { type: 'image/png' }))
    } catch {
      resolve(null)
    }
  })
}

/** 产出海报 PNG Blob（不触发下载，供弹层内预览/保存，见 006 F7） */
export function renderPosterBlob(
  data: PosterData,
  opts: PosterOptions,
  strings: PosterStrings,
): Promise<Blob | null> {
  return canvasToPngBlob(renderPoster(data, opts, strings))
}

/** 触发浏览器下载。用于保存已生成的 blob（不再自动关闭弹层） */
export function downloadBlob(blob: Blob, filename = posterFilename()): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 海报文件名：UNiaoer-Test_Share_<yyyy-mm-dd-hh-mm>.png（本地时间）。
 * 逐分钟唯一——避免"多次生成全叫 uniaoer-result.png"，文件堆一起没法区分（2026-10-09 用户要求）。
 */
export function posterFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}-${p(now.getMinutes())}`
  return `UNiaoer-Test_Share_${stamp}.png`
}

/** 生成并下载（保留旧接口，供一次性调用场景） */
export async function downloadPoster(
  data: PosterData,
  opts: PosterOptions,
  strings: PosterStrings,
  filename = posterFilename(),
): Promise<void> {
  const blob = await renderPosterBlob(data, opts, strings)
  if (blob) downloadBlob(blob, filename)
}

/**
 * 加载背景图。
 * 用 fetch(mode:'cors') + createImageBitmap，并加缓存旁路参数：
 * 避免命中此前 <img>（无 CORS）留下的"无 ACAO"缓存，导致 canvas 跨域失败。
 */
export async function loadImage(url: string): Promise<ImageBitmap> {
  const bust = url + (url.includes('?') ? '&' : '?') + '_cors=1'
  const res = await fetch(bust, { mode: 'cors', cache: 'reload' })
  if (!res.ok) throw new Error('image load failed HTTP ' + res.status)
  return await createImageBitmap(await res.blob())
}
