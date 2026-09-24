/** 每轮成绩海报：纯 Canvas 绘制（主题 / 背景图 / 平移），导出 PNG（无依赖） */
import { getTheme } from './posterThemes'

export interface PosterWrong {
  answer: string
  chosen: string | null
  timedOut: boolean
}

export interface PosterData {
  /** 右上角模式标签，如「鸟图版」「鸟声版」 */
  modeLabel: string
  tierLabel: string
  correct: number
  total: number
  accuracy: number
  date: string
  wrong: PosterWrong[]
}

export interface PosterOptions {
  themeId: string
  bgImage?: HTMLImageElement | null
  bgOffset?: { x: number; y: number }
}

const W = 1080
const H = 1440
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

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

/** 计算背景图 cover 布局（含平移），并夹取到不留空白 */
export function computeCover(
  imgW: number,
  imgH: number,
  offset?: { x: number; y: number },
) {
  const scale = Math.max(W / imgW, H / imgH)
  const dw = imgW * scale
  const dh = imgH * scale
  const x = Math.min(0, Math.max(W - dw, (W - dw) / 2 + (offset?.x ?? 0)))
  const y = Math.min(0, Math.max(H - dh, (H - dh) / 2 + (offset?.y ?? 0)))
  return { x, y, dw, dh }
}

/** 把海报画到指定 canvas 上 */
export function drawPoster(
  canvas: HTMLCanvasElement,
  data: PosterData,
  opts: PosterOptions,
): void {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const theme = getTheme(opts.themeId)
  const hasImage = !!opts.bgImage

  // 背景
  if (hasImage && opts.bgImage) {
    const { x, y, dw, dh } = computeCover(opts.bgImage.width, opts.bgImage.height, opts.bgOffset)
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(opts.bgImage, x, y, dw, dh)
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, theme.stops[0])
    bg.addColorStop(0.5, theme.stops[1])
    bg.addColorStop(1, theme.stops[2])
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
  }

  const panelAlpha = hasImage ? 0.74 : 1
  const panelFill = hasImage ? `rgba(255,255,255,${panelAlpha})` : '#ffffff'

  ctx.textBaseline = 'alphabetic'

  // 顶部标题（去掉 emoji 与“鸟语识别”）
  if (hasImage) {
    drawLabel(ctx, 'UNiaoer', W / 2, 118, 56, true)
    drawLabel(ctx, data.date, W / 2, 174, 28, false)
  } else {
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 56px ${FONT}`
    ctx.fillText('UNiaoer', W / 2, 118)
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = `400 28px ${FONT}`
    ctx.fillText(data.date, W / 2, 174)
  }

  // 右上角模式标签
  const badgeText = data.modeLabel
  ctx.font = `700 32px ${FONT}`
  const bw = ctx.measureText(badgeText).width + 48
  const bx = W - 60 - bw
  const by = 64
  ctx.fillStyle = hasImage ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.18)'
  roundRect(ctx, bx, by, bw, 60, 30)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = hasImage ? '#14342a' : '#ffffff'
  ctx.fillText(badgeText, bx + bw / 2, by + 41)

  // 内容面板
  const cardX = 90
  const cardY = 250
  const cardW = W - 180
  const cardH = 1010
  ctx.fillStyle = panelFill
  roundRect(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.fill()

  ctx.textAlign = 'center'
  const dark = '#14342a'
  const muted = '#5a7a6f'

  // 第一行小字
  ctx.fillStyle = muted
  ctx.font = `400 40px ${FONT}`
  ctx.fillText('你在认鸟测试中', W / 2, cardY + 150)

  // 第二行：比第一行大一点
  const perfect = data.total > 0 && data.correct === data.total
  ctx.fillStyle = dark
  ctx.font = `800 64px ${FONT}`
  ctx.fillText(perfect ? '全对了！' : '答对了！', W / 2, cardY + 250)

  // 分数：9 大字，/10 小字，整体居中
  const scoreBase = cardY + 420
  ctx.font = `800 150px ${FONT}`
  const numW = ctx.measureText(String(data.correct)).width
  ctx.font = `600 44px ${FONT}`
  const denW = ctx.measureText(`/${data.total}`).width
  let sx = W / 2 - (numW + denW + 10) / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.stops[1]
  ctx.font = `800 150px ${FONT}`
  ctx.fillText(String(data.correct), sx, scoreBase)
  sx += numW + 10
  ctx.fillStyle = muted
  ctx.font = `600 44px ${FONT}`
  ctx.fillText(`/${data.total}`, sx, scoreBase)

  ctx.textAlign = 'center'
  ctx.fillStyle = muted
  ctx.font = `500 28px ${FONT}`
  ctx.fillText(`正确率 ${data.accuracy}% · ${data.tierLabel}`, W / 2, cardY + 500)

  // 错题（更小、更靠下）
  const wrongTitleY = cardY + 640
  ctx.textAlign = 'left'
  ctx.fillStyle = '#9bb3a8'
  ctx.font = `600 28px ${FONT}`
  ctx.fillText('错题回顾', cardX + 64, wrongTitleY)

  const list = data.wrong.slice(0, 4)
  if (list.length === 0) {
    ctx.fillStyle = theme.stops[1]
    ctx.font = `400 28px ${FONT}`
    ctx.fillText('🎉 全对，没有错题', cardX + 64, wrongTitleY + 54)
  } else {
    list.forEach((w, i) => {
      const y = wrongTitleY + 54 + i * 52
      ctx.fillStyle = dark
      ctx.font = `600 27px ${FONT}`
      ctx.fillText(`${i + 1}. ${w.answer}`, cardX + 64, y)
      ctx.fillStyle = '#c1121f'
      ctx.font = `400 25px ${FONT}`
      const mine = w.timedOut ? '超时未作答' : `认成了「${w.chosen ?? '—'}」`
      ctx.fillText(mine, cardX + 360, y)
    })
  }

  // 页脚
  if (hasImage) {
    drawLabel(ctx, '开源非商业 · 数据来源 iNaturalist / Xeno-canto', W / 2, H - 58, 26, false)
  } else {
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = `400 26px ${FONT}`
    ctx.fillText('开源非商业 · 数据来源 iNaturalist / Xeno-canto', W / 2, H - 64)
  }
}

/** 在背景图上给文字加半透明白色背景框（保证白底黑字） */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  baseline: number,
  size: number,
  bold: boolean,
) {
  ctx.font = `${bold ? 800 : 400} ${size}px ${FONT}`
  const tw = ctx.measureText(text).width
  const padX = 22
  const padY = 14
  const bw = tw + padX * 2
  const bh = size + padY * 2
  const bx = cx - bw / 2
  const by = baseline - size - padY + 6
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  roundRect(ctx, bx, by, bw, bh, 16)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#14342a'
  ctx.fillText(text, cx, baseline)
}

export function renderPoster(data: PosterData, opts: PosterOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  drawPoster(canvas, data, opts)
  return canvas
}

/** 生成并下载海报 PNG */
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

/** 加载背景图（跨域图片需 CORS 才能导出 canvas） */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败：' + url))
    img.src = url
  })
}
