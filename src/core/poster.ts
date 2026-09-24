/** 每轮成绩海报：背景（极简场景/照片）+ 每字段半透明白底框，导出 PNG */
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
  wrong: PosterWrong[]
}

export interface PosterOptions {
  /** 背景 id（见 posterScenes） */
  themeId: string
  bgImage?: HTMLImageElement | null
  bgOffset?: { x: number; y: number }
}

const W = 1080
const H = 1440
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
const DARK = '#14342a'
const MUTED = '#5a7a6f'
const ACCENT = '#2d6a4f'
const WRONG = '#c1121f'
const BOX = 'rgba(255,255,255,0.82)'

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

const GAP = 10
const PAD_X = 20
const PAD_Y = 12

/** 画一组文字片段，并在其下方铺半透明白底框（保证白底黑字） */
function drawSegments(
  ctx: CanvasRenderingContext2D,
  segs: Seg[],
  anchor: number,
  baseline: number,
  align: 'center' | 'left',
) {
  const widths = segs.map((s) => {
    ctx.font = `${s.weight} ${s.size}px ${FONT}`
    return ctx.measureText(s.text).width
  })
  const total = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, segs.length - 1)
  const maxSize = Math.max(...segs.map((s) => s.size))
  const boxW = total + PAD_X * 2
  const boxH = maxSize + PAD_Y * 2
  const boxX = align === 'center' ? anchor - boxW / 2 : anchor - PAD_X
  const boxY = baseline - maxSize * 0.78 - PAD_Y

  ctx.fillStyle = BOX
  roundRect(ctx, boxX, boxY, boxW, boxH, 16)
  ctx.fill()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let x = align === 'center' ? boxX + PAD_X : anchor
  segs.forEach((s, i) => {
    ctx.font = `${s.weight} ${s.size}px ${FONT}`
    ctx.fillStyle = s.color
    ctx.fillText(s.text, x, baseline)
    x += widths[i]! + GAP
  })
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

  ctx.textBaseline = 'alphabetic'

  // 顶部标题（无 emoji、无“鸟语识别”）
  drawSegments(ctx, [{ text: 'UNiaoer', color: DARK, weight: 800, size: 56 }], W / 2, 118, 'center')
  drawSegments(ctx, [{ text: data.date, color: MUTED, weight: 400, size: 28 }], W / 2, 184, 'center')

  // 右上角模式标签
  ctx.font = `700 32px ${FONT}`
  const bw = ctx.measureText(data.modeLabel).width + 48
  const bx = W - 60 - bw
  const by = 60
  ctx.fillStyle = BOX
  roundRect(ctx, bx, by, bw, 60, 30)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = DARK
  ctx.fillText(data.modeLabel, bx + bw / 2, by + 41)

  // 正文（居中，逐字段白底框）
  drawSegments(
    ctx,
    [{ text: '你在认鸟测试中', color: MUTED, weight: 400, size: 40 }],
    W / 2,
    540,
    'center',
  )
  const perfect = data.total > 0 && data.correct === data.total
  drawSegments(
    ctx,
    [{ text: perfect ? '全对了！' : '答对了！', color: DARK, weight: 800, size: 64 }],
    W / 2,
    650,
    'center',
  )
  drawSegments(
    ctx,
    [
      { text: String(data.correct), color: ACCENT, weight: 800, size: 150 },
      { text: `/${data.total}`, color: MUTED, weight: 600, size: 44 },
    ],
    W / 2,
    860,
    'center',
  )
  drawSegments(
    ctx,
    [{ text: `正确率 ${data.accuracy}% · ${data.tierLabel}`, color: MUTED, weight: 500, size: 28 }],
    W / 2,
    950,
    'center',
  )

  // 错题回顾（左对齐，逐行白底框）
  drawSegments(ctx, [{ text: '错题回顾', color: MUTED, weight: 600, size: 28 }], 110, 1080, 'left')
  const list = data.wrong.slice(0, 4)
  if (list.length === 0) {
    drawSegments(ctx, [{ text: '🎉 全对，没有错题', color: ACCENT, weight: 400, size: 28 }], 110, 1140, 'left')
  } else {
    list.forEach((w, i) => {
      const mine = w.timedOut ? '超时未作答' : `认成了「${w.chosen ?? '—'}」`
      drawSegments(
        ctx,
        [
          { text: `${i + 1}. ${w.answer}`, color: DARK, weight: 600, size: 27 },
          { text: mine, color: WRONG, weight: 400, size: 25 },
        ],
        110,
        1140 + i * 58,
        'left',
      )
    })
  }

  // 页脚
  drawSegments(
    ctx,
    [{ text: '开源非商业 · 数据来源 iNaturalist / Xeno-canto', color: MUTED, weight: 400, size: 26 }],
    W / 2,
    H - 56,
    'center',
  )
}

export function renderPoster(data: PosterData, opts: PosterOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawPoster(canvas, data, opts)
  return canvas
}

export function downloadPoster(
  data: PosterData,
  opts: PosterOptions,
  filename = 'uniaoer-result.png',
): Promise<void> {
  return new Promise((resolve) => {
    const canvas = renderPoster(data, opts)
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve()
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      resolve()
    }, 'image/png')
  })
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败：' + url))
    img.src = url
  })
}
