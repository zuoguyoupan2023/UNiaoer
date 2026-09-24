/** 每轮成绩海报：纯 Canvas 绘制 → 导出 PNG（无依赖） */

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

export function renderPoster(data: PosterData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#1b4332')
  bg.addColorStop(0.5, '#2d6a4f')
  bg.addColorStop(1, '#40916c')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 顶部标题（去掉“鸟语识别”）
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 56px ${FONT}`
  ctx.fillText('🐦 UNiaoer', W / 2, 120)
  ctx.font = `400 28px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.fillText(data.date, W / 2, 172)

  // 右上角模式标签
  const badgeText = data.modeLabel
  ctx.font = `700 32px ${FONT}`
  const bw = ctx.measureText(badgeText).width + 48
  const bx = W - 60 - bw
  const by = 64
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  roundRect(ctx, bx, by, bw, 60, 30)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(badgeText, bx + bw / 2, by + 41)

  // 白色卡片
  const cardX = 90
  const cardY = 250
  const cardW = W - 180
  const cardH = 1010
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.fill()

  ctx.textAlign = 'center'

  // 第一行小字
  ctx.fillStyle = '#5a7a6f'
  ctx.font = `400 38px ${FONT}`
  ctx.fillText('你在认鸟测试中', W / 2, cardY + 150)

  // 大字：答对了！
  const perfect = data.total > 0 && data.correct === data.total
  ctx.fillStyle = '#14342a'
  ctx.font = `800 128px ${FONT}`
  ctx.fillText(perfect ? '全对了！' : '答对了！', W / 2, cardY + 320)

  // 分数：9 大字，/10 小字，整体居中
  const scoreBase = cardY + 520
  ctx.font = `800 200px ${FONT}`
  const numW = ctx.measureText(String(data.correct)).width
  ctx.font = `600 54px ${FONT}`
  const denW = ctx.measureText(`/${data.total}`).width
  let sx = W / 2 - (numW + denW + 12) / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = '#2d6a4f'
  ctx.font = `800 200px ${FONT}`
  ctx.fillText(String(data.correct), sx, scoreBase)
  sx += numW + 12
  ctx.fillStyle = '#5a7a6f'
  ctx.font = `600 54px ${FONT}`
  ctx.fillText(`/${data.total}`, sx, scoreBase)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#5a7a6f'
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(`正确率 ${data.accuracy}% · ${data.tierLabel}`, W / 2, cardY + 610)

  // 错题（更小、更靠下）
  const wrongTitleY = cardY + 730
  ctx.textAlign = 'left'
  ctx.fillStyle = '#9bb3a8'
  ctx.font = `600 28px ${FONT}`
  ctx.fillText('错题回顾', cardX + 64, wrongTitleY)

  const list = data.wrong.slice(0, 4)
  if (list.length === 0) {
    ctx.fillStyle = '#2d6a4f'
    ctx.font = `400 28px ${FONT}`
    ctx.fillText('🎉 全对，没有错题', cardX + 64, wrongTitleY + 54)
  } else {
    list.forEach((w, i) => {
      const y = wrongTitleY + 54 + i * 52
      ctx.fillStyle = '#14342a'
      ctx.font = `600 27px ${FONT}`
      ctx.fillText(`${i + 1}. ${w.answer}`, cardX + 64, y)
      ctx.fillStyle = '#c1121f'
      ctx.font = `400 25px ${FONT}`
      const mine = w.timedOut ? '超时未作答' : `认成了「${w.chosen ?? '—'}」`
      ctx.fillText(mine, cardX + 360, y)
    })
  }

  // 页脚
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = `400 26px ${FONT}`
  ctx.fillText('开源非商业 · 数据来源 iNaturalist / Xeno-canto', W / 2, H - 64)

  return canvas
}

/** 生成并下载海报 PNG */
export function downloadPoster(data: PosterData, filename = 'uniaoer-result.png'): Promise<void> {
  return new Promise((resolve) => {
    const canvas = renderPoster(data)
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
