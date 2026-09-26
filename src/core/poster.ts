/** 每轮成绩海报：背景（极简场景/照片）+ 每字段半透明白底框，导出 PNG */
import qrcode from 'qrcode-generator'
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
export const DEFAULT_SITE_URL = 'https://uniaoer.pages.dev'

/** 海报错题区最多展示条数（左右各 4） */
export const POSTER_WRONG_MAX = 8

/** 海报错题行：真实错题，或"放不下了"占位行 */
export interface PosterWrongRow extends PosterWrong {
  placeholder?: boolean
}

/**
 * 选取用于海报展示的错题行（F2）：
 * - ≤8 条：全部展示
 * - >8 条：展示前 7 条，第 8 条替换为「这里放不下了」
 */
export function buildWrongRows(wrong: PosterWrong[]): PosterWrongRow[] {
  const overflow = wrong.length > POSTER_WRONG_MAX
  const kept = overflow ? wrong.slice(0, POSTER_WRONG_MAX - 1) : wrong.slice(0, POSTER_WRONG_MAX)
  const rows: PosterWrongRow[] = kept.map((w) => ({ ...w }))
  if (overflow) rows.push({ answer: '这里放不下了', chosen: null, timedOut: false, placeholder: true })
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

function drawQrSlot(ctx: CanvasRenderingContext2D, P: Palette, opts: PosterOptions) {
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
  ctx.fillText('扫码访问官网', x + size / 2, y + size + 22)
}

export function drawPoster(
  canvas: HTMLCanvasElement,
  data: PosterData,
  opts: PosterOptions,
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

  // 顶部标题（无 emoji、无“鸟语识别”）
  drawSegments(ctx, [{ text: 'UNiaoer', color: P.dark, weight: 800, size: 56 }], W / 2, 118, 'center', box)
  drawSegments(ctx, [{ text: data.date, color: P.muted, weight: 400, size: 28 }], W / 2, 184, 'center', box)

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
    const rt = `第 ${data.round} 轮`
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
  drawSegments(ctx, [{ text: '你在认鸟测试中', color: P.muted, weight: 400, size: 40 }], W / 2, 540, 'center', box)
  const perfect = data.total > 0 && data.correct === data.total
  drawSegments(
    ctx,
    [{ text: perfect ? '全对了！' : '答对了！', color: P.dark, weight: 800, size: 64 }],
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
  const accText =
    data.round && data.round > 1 && data.overallAccuracy !== undefined
      ? `正确率 ${data.accuracy}% · ${data.tierLabel} · 整体 ${data.overallAccuracy}%`
      : `正确率 ${data.accuracy}% · ${data.tierLabel}`
  drawSegments(
    ctx,
    [{ text: accText, color: P.muted, weight: 500, size: 28 }],
    W / 2,
    950,
    'center',
    box,
  )

  // 错题回顾（F2：最多 8 条，左右各 4；超出则前 7 + 「这里放不下了」）
  drawSegments(ctx, [{ text: '错题回顾', color: P.muted, weight: 600, size: 28 }], 60, 1010, 'left', box)
  const rows = buildWrongRows(data.wrong)
  if (rows.length === 0) {
    drawSegments(
      ctx,
      [{ text: '全对，没有错题', color: P.accent, weight: 400, size: 28 }],
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
          [{ text: `${i + 1}. 这里放不下了`, color: P.wrong, weight: 600, size: 25 }],
          x,
          y,
          'left',
          box,
        )
        return
      }
      const head = { text: `${i + 1}. ${w.answer}`, color: P.dark, weight: 600, size: 26 }
      const mineText = w.timedOut ? '超时未作答' : `认成了「${w.chosen ?? '—'}」`
      ctx.font = `600 26px ${FONT}`
      const headW = ctx.measureText(head.text).width
      const mine = fitText(ctx, mineText, 400, 24, Math.max(60, colWidth - headW - GAP))
      drawSegments(ctx, [head, { text: mine, color: P.wrong, weight: 400, size: 24 }], x, y, 'left', box)
    })
  }

  // 页脚（左对齐，给右下角二维码让位）
  drawSegments(
    ctx,
    [{ text: '数据来源 iNaturalist / Xeno-canto', color: P.muted, weight: 400, size: 24 }],
    60,
    H - 30,
    'left',
    box,
  )

  // 右下角二维码位（F4）
  drawQrSlot(ctx, P, opts)
}

export function renderPoster(data: PosterData, opts: PosterOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawPoster(canvas, data, opts)
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
export function renderPosterBlob(data: PosterData, opts: PosterOptions): Promise<Blob | null> {
  return canvasToPngBlob(renderPoster(data, opts))
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
  filename = 'uniaoer-result.png',
): Promise<void> {
  const blob = await renderPosterBlob(data, opts)
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
  if (!res.ok) throw new Error('图片加载失败 HTTP ' + res.status)
  return await createImageBitmap(await res.blob())
}
