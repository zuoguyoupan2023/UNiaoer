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
  bgImage?: ImageBitmap | null
  bgOffset?: { x: number; y: number }
}

const W = 1080
const H = 1440
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

/** 有底框：白底黑字（用于场景/照片背景） */
const PALETTE_BOXED = {
  dark: '#14342a',
  muted: '#5a7a6f',
  accent: '#2d6a4f',
  wrong: '#c1121f',
  box: 'rgba(255,255,255,0.82)' as string | null,
}
/** 无底框：白字直接铺在纯色渐变上 */
const PALETTE_PLAIN = {
  dark: '#ffffff',
  muted: 'rgba(255,255,255,0.82)',
  accent: '#e9b949',
  wrong: '#ffc2c7',
  box: null as string | null,
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

const GAP = 10
const PAD_X = 20
const PAD_Y = 12

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

  // 纯色背景：文字直接铺在渐变上（白字、无白底框）
  const plain = !hasImage && !!getBackground(opts.themeId).plain
  const P = plain ? PALETTE_PLAIN : PALETTE_BOXED
  const box = P.box

  ctx.textBaseline = 'alphabetic'

  // 顶部标题（无 emoji、无“鸟语识别”）
  drawSegments(ctx, [{ text: 'UNiaoer', color: P.dark, weight: 800, size: 56 }], W / 2, 118, 'center', box)
  drawSegments(ctx, [{ text: data.date, color: P.muted, weight: 400, size: 28 }], W / 2, 184, 'center', box)

  // 右上角模式标签
  ctx.font = `700 32px ${FONT}`
  const bw = ctx.measureText(data.modeLabel).width + 48
  const bx = W - 60 - bw
  const by = 60
  ctx.fillStyle = box ?? 'rgba(255,255,255,0.18)'
  roundRect(ctx, bx, by, bw, 60, 30)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = box ? P.dark : '#ffffff'
  ctx.fillText(data.modeLabel, bx + bw / 2, by + 41)

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
  drawSegments(
    ctx,
    [{ text: `正确率 ${data.accuracy}% · ${data.tierLabel}`, color: P.muted, weight: 500, size: 28 }],
    W / 2,
    950,
    'center',
    box,
  )

  // 错题回顾
  drawSegments(ctx, [{ text: '错题回顾', color: P.muted, weight: 600, size: 28 }], 110, 1080, 'left', box)
  const list = data.wrong.slice(0, 4)
  if (list.length === 0) {
    drawSegments(
      ctx,
      [{ text: '🎉 全对，没有错题', color: P.accent, weight: 400, size: 28 }],
      110,
      1140,
      'left',
      box,
    )
  } else {
    list.forEach((w, i) => {
      const mine = w.timedOut ? '超时未作答' : `认成了「${w.chosen ?? '—'}」`
      drawSegments(
        ctx,
        [
          { text: `${i + 1}. ${w.answer}`, color: P.dark, weight: 600, size: 27 },
          { text: mine, color: P.wrong, weight: 400, size: 25 },
        ],
        110,
        1140 + i * 58,
        'left',
        box,
      )
    })
  }

  // 页脚
  drawSegments(
    ctx,
    [{ text: '开源非商业 · 数据来源 iNaturalist / Xeno-canto', color: P.muted, weight: 400, size: 26 }],
    W / 2,
    H - 56,
    'center',
    box,
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
