/** 每轮成绩海报：纯 Canvas 绘制 → 导出 PNG（无依赖） */

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
  encouragement: string
}

const W = 1080
const H = 1440

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

  // 顶部标题
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.font = '700 56px -apple-system, "PingFang SC", sans-serif'
  ctx.fillText('🐦 UNiaoer · 鸟语识别', W / 2, 120)
  ctx.font = '400 30px -apple-system, "PingFang SC", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillText(`${data.modeLabel} · ${data.tierLabel} · ${data.date}`, W / 2, 172)

  // 白色卡片
  const cardX = 80
  const cardY = 240
  const cardW = W - 160
  const cardH = 1000
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, cardX, cardY, cardW, cardH, 40)
  ctx.fill()

  // 分数
  ctx.fillStyle = '#14342a'
  ctx.textAlign = 'center'
  ctx.font = '800 200px -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(String(data.correct), W / 2, cardY + 240)
  ctx.font = '600 48px -apple-system, "PingFang SC", sans-serif'
  ctx.fillStyle = '#5a7a6f'
  ctx.fillText(`/ ${data.total} 题`, W / 2, cardY + 310)

  // 正确率
  ctx.fillStyle = '#2d6a4f'
  ctx.font = '800 64px -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(`正确率 ${data.accuracy}%`, W / 2, cardY + 400)

  // 鼓励语
  ctx.fillStyle = '#14342a'
  ctx.font = '600 40px -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(data.encouragement, W / 2, cardY + 480)

  // 错题回顾
  ctx.textAlign = 'left'
  ctx.fillStyle = '#5a7a6f'
  ctx.font = '600 34px -apple-system, "PingFang SC", sans-serif'
  ctx.fillText('错题回顾', cardX + 60, cardY + 570)

  const list = data.wrong.slice(0, 4)
  if (list.length === 0) {
    ctx.fillStyle = '#2d6a4f'
    ctx.font = '400 34px -apple-system, "PingFang SC", sans-serif'
    ctx.fillText('🎉 全对！没有错题', cardX + 60, cardY + 640)
  } else {
    list.forEach((w, i) => {
      const y = cardY + 640 + i * 78
      ctx.fillStyle = '#14342a'
      ctx.font = '600 34px -apple-system, "PingFang SC", sans-serif'
      const mine = w.timedOut ? '超时未作答' : `认成了「${w.chosen ?? '—'}」`
      ctx.fillText(`${i + 1}. ${w.answer}`, cardX + 60, y)
      ctx.fillStyle = '#c1121f'
      ctx.font = '400 32px -apple-system, "PingFang SC", sans-serif'
      ctx.fillText(mine, cardX + 360, y)
    })
  }

  // 页脚
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '400 26px -apple-system, "PingFang SC", sans-serif'
  ctx.fillText('开源非商业 · 数据来源 iNaturalist / Xeno-canto', W / 2, H - 70)

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
