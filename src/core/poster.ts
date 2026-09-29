/** 每轮成绩海报：背景（极简场景/照片）+ 每字段半透明白底框，导出 PNG */
import qrcode from 'qrcode-generator'
import { ICON_NODES, type IconNode } from './iconPaths'
import { getBackground } from './posterScenes'

export interface PosterWrong {
  answer: string
  chosen: string | null
  timedOut: boolean
}

export interface PosterData {
  modeLabel: string
  tierLabel: string
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
}

/**
 * 海报界面文案（015 §6.4/i18n-4）：core 不 import i18n，由调用方（PosterEditor）
 * 用 t() 按 locale 构造后注入；带 {n}/{name} 占位的模板在绘制时替换。
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
  /** 错选模板，含 {name} 占位 */
  mistakenAs: string
  /** 页脚数据来源 */
  sourceLine: string
  /** 二维码下方提示 */
  scanCta: string
}

export interface PosterOptions {
  /** 背景 id（见 posterScenes） */
  themeId: string
  bgImage?: ImageBitmap | null
  bgOffset?: { x: number; y: number }
  /** 右下角二维码指向的站点（占位文案/后续替换真码用） */
  qrUrl?: string
  /** 真二维码图（可选，提供后替代占位框） */
  qrImage?: ImageBitmap | null
}

/** 官网地址（二维码默认指向；正式域名确定后替换） */
/** 官网地址（二维码默认指向；R35：正式域名 uniaoer.com，已绑定 Pages） */
export const DEFAULT_SITE_URL = 'https://uniaoer.com'

/** 海报错题区最多展示条数（左右各 4） */
export const POSTER_WRONG_MAX = 8

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

const W = 1080
const H = 1440
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

function drawQrSlot(ctx: CanvasRenderingContext2D, P: Palette, opts: PosterOptions, strings: PosterStrings) {
  const size = QR_SIZE
  const x = W - QR_MARGIN - size
  const y = H - QR_MARGIN - size

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
  const dateLine = [data.nickname ? `@${data.nickname}` : '', data.date].filter(Boolean).join(' · ')
  drawSegments(ctx, [{ text: 'UNiaoer', color: P.dark, weight: 800, size: 56 }], W / 2, 118, 'center', box)
  drawSegments(ctx, [{ text: dateLine, color: P.muted, weight: 400, size: 28 }], W / 2, 184, 'center', box)

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
    const cy = 208
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
  const by = 60
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
    roundRect(ctx, 60, 60, rw, 60, 30)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.fillStyle = P.chipText
    ctx.fillText(rt, 60 + rw / 2, 101)
  }

  // 正文
  drawSegments(ctx, [{ text: strings.intro, color: P.muted, weight: 400, size: 40 }], W / 2, 540, 'center', box)
  const perfect = data.total > 0 && data.correct === data.total
  drawSegments(
    ctx,
    [{ text: perfect ? strings.perfectTitle : strings.answeredTitle, color: P.dark, weight: 800, size: 64 }],
    W / 2,
    650,
    'center',
    box,
  )
  drawSegments(
    ctx,
    [
      { text: String(data.correct), color: P.accent, weight: 800, size: 150 },
      { text: `/${data.total}`, color: P.muted, weight: 600, size: 44 },
    ],
    W / 2,
    860,
    'center',
    box,
  )
  const accText = strings.accuracyLine
  drawSegments(
    ctx,
    [{ text: accText, color: P.muted, weight: 500, size: 28 }],
    W / 2,
    950,
    'center',
    box,
  )

  // 错题回顾（F2：最多 8 条，左右各 4；超出则前 7 + 「这里放不下了」）
  drawSegments(ctx, [{ text: strings.wrongHeading, color: P.muted, weight: 600, size: 28 }], 60, 1010, 'left', box)
  const rows = buildWrongRows(data.wrong, strings.overflow)
  if (rows.length === 0) {
    drawSegments(
      ctx,
      [{ text: strings.allCorrect, color: P.accent, weight: 400, size: 28 }],
      60,
      1070,
      'left',
      box,
    )
  } else {
    const colWidth = 440
    const rowGap = 48
    const top = 1058
    ctx.textAlign = 'left'
    rows.forEach((w, i) => {
      const x = i < POSTER_WRONG_MAX / 2 ? 60 : 560
      const y = top + (i % (POSTER_WRONG_MAX / 2)) * rowGap
      if (w.placeholder) {
        drawSegments(
          ctx,
          [{ text: `${i + 1}. ${strings.overflow}`, color: P.wrong, weight: 600, size: 25 }],
          x,
          y,
          'left',
          box,
        )
        return
      }
      const head = { text: `${i + 1}. ${w.answer}`, color: P.dark, weight: 600, size: 26 }
      const mineText = w.timedOut
        ? strings.timedOut
        : strings.mistakenAs.replace('{name}', w.chosen ?? '—')
      ctx.font = `600 26px ${FONT}`
      const headW = ctx.measureText(head.text).width
      const mine = fitText(ctx, mineText, 400, 24, Math.max(60, colWidth - headW - GAP))
      drawSegments(ctx, [head, { text: mine, color: P.wrong, weight: 400, size: 24 }], x, y, 'left', box)
    })
  }

  // 页脚（左对齐，给右下角二维码让位）
  drawSegments(
    ctx,
    [{ text: strings.sourceLine, color: P.muted, weight: 400, size: 24 }],
    60,
    H - 30,
    'left',
    box,
  )

  // 右下角二维码位（F4）
  drawQrSlot(ctx, P, opts, strings)
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
export function downloadBlob(blob: Blob, filename = 'uniaoer-result.png'): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 生成并下载（保留旧接口，供一次性调用场景） */
export async function downloadPoster(
  data: PosterData,
  opts: PosterOptions,
  strings: PosterStrings,
  filename = 'uniaoer-result.png',
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
