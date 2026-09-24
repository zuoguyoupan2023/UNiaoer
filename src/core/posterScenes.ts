/** 海报背景：极简意象场景（纯 Canvas 矢量绘制，无外部素材） */

export interface PosterBackground {
  id: string
  label: string
  swatch: string
  draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void
}

function sky(ctx: CanvasRenderingContext2D, W: number, H: number, pairs: [number, string][]) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  for (const [p, c] of pairs) g.addColorStop(p, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function sun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** 圆润山丘带 */
function hills(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  baseY: number,
  amp: number,
  color: string,
) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, H)
  ctx.lineTo(0, baseY)
  ctx.quadraticCurveTo(W * 0.22, baseY - amp, W * 0.45, baseY - amp * 0.2)
  ctx.quadraticCurveTo(W * 0.68, baseY + amp * 0.7, W, baseY - amp * 0.5)
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()
}

function conifer(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color
  const w = h * 0.5
  for (let i = 0; i < 3; i++) {
    const top = baseY - h + (h * i) / 3
    const bw = w * (0.55 + i * 0.22)
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x - bw / 2, top + h * 0.42)
    ctx.lineTo(x + bw / 2, top + h * 0.42)
    ctx.closePath()
    ctx.fill()
  }
}

function bush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.arc(x + r * 0.9, y + r * 0.15, r * 0.8, 0, Math.PI * 2)
  ctx.arc(x - r * 0.9, y + r * 0.2, r * 0.75, 0, Math.PI * 2)
  ctx.fill()
}

function birdV(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(2, s * 0.2)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - s, y)
  ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.7, x, y)
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.7, x + s, y)
  ctx.stroke()
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, s, 0, Math.PI * 2)
  ctx.arc(x + s, y + s * 0.2, s * 0.85, 0, Math.PI * 2)
  ctx.arc(x - s, y + s * 0.25, s * 0.8, 0, Math.PI * 2)
  ctx.fill()
}

function reeds(ctx: CanvasRenderingContext2D, W: number, H: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  for (let i = 0; i < 10; i++) {
    const x = (W / 10) * i + 20
    const h = 120 + ((i * 37) % 90)
    ctx.beginPath()
    ctx.moveTo(x, H)
    ctx.quadraticCurveTo(x + 12, H - h * 0.6, x + 4, H - h)
    ctx.stroke()
  }
}

function grassBlades(ctx: CanvasRenderingContext2D, W: number, H: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  for (let i = 0; i < 40; i++) {
    const x = (W / 40) * i + 6
    const h = 40 + ((i * 53) % 70)
    ctx.beginPath()
    ctx.moveTo(x, H)
    ctx.quadraticCurveTo(x + 10, H - h * 0.6, x + (i % 2 ? 16 : -8), H - h)
    ctx.stroke()
  }
}

export const POSTER_BACKGROUNDS: PosterBackground[] = [
  {
    id: 'forest',
    label: '山林',
    swatch: '#2d6a4f',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#bfe3d0'],
        [0.55, '#e7f4ec'],
        [1, '#d3ead9'],
      ])
      sun(ctx, W * 0.78, H * 0.16, 70, '#f6e6a8')
      hills(ctx, W, H, H * 0.42, 60, '#8fc7a6')
      hills(ctx, W, H, H * 0.56, 50, '#4e9b74')
      conifer(ctx, W * 0.16, H * 0.62, 180, '#2f6b4f')
      conifer(ctx, W * 0.26, H * 0.64, 130, '#357a58')
      conifer(ctx, W * 0.86, H * 0.63, 150, '#2f6b4f')
      hills(ctx, W, H, H * 0.72, 40, '#1f523b')
      birdV(ctx, W * 0.4, H * 0.2, 26, '#5a7a6f')
      birdV(ctx, W * 0.48, H * 0.15, 20, '#5a7a6f')
    },
  },
  {
    id: 'grassland',
    label: '草原',
    swatch: '#c9a227',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#fbe6b8'],
        [0.5, '#f7d98a'],
        [1, '#e9c46a'],
      ])
      sun(ctx, W * 0.24, H * 0.2, 90, '#f4a259')
      hills(ctx, W, H, H * 0.5, 70, '#c9b458')
      hills(ctx, W, H, H * 0.62, 55, '#a3a33c')
      hills(ctx, W, H, H * 0.74, 45, '#7d8c3a')
      grassBlades(ctx, W, H, '#6b7a30')
      birdV(ctx, W * 0.66, H * 0.16, 24, '#8a6d00')
      birdV(ctx, W * 0.74, H * 0.12, 18, '#8a6d00')
    },
  },
  {
    id: 'river',
    label: '河岸',
    swatch: '#2a7fb8',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#cfe8f5'],
        [0.5, '#e8f4fa'],
        [1, '#cfe8f5'],
      ])
      sun(ctx, W * 0.72, H * 0.16, 60, '#ffe9b0')
      hills(ctx, W, H, H * 0.5, 70, '#9fc7d6')
      hills(ctx, W, H, H * 0.6, 55, '#6aa8c4')
      ctx.fillStyle = '#8fd0e8'
      ctx.beginPath()
      ctx.moveTo(0, H * 0.68)
      ctx.quadraticCurveTo(W * 0.5, H * 0.6, W, H * 0.7)
      ctx.lineTo(W, H * 0.86)
      ctx.quadraticCurveTo(W * 0.5, H * 0.78, 0, H * 0.86)
      ctx.closePath()
      ctx.fill()
      reeds(ctx, W, H, '#3f7a52')
      birdV(ctx, W * 0.34, H * 0.14, 22, '#4a7f92')
    },
  },
  {
    id: 'bush',
    label: '灌木丛',
    swatch: '#3f7a52',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#dff0e0'],
        [0.6, '#eef7ea'],
        [1, '#d6e9d0'],
      ])
      sun(ctx, W * 0.8, H * 0.14, 55, '#f7edc0')
      bush(ctx, W * 0.25, H * 0.68, 120, '#5aa06f')
      bush(ctx, W * 0.62, H * 0.72, 150, '#3f7a52')
      bush(ctx, W * 0.9, H * 0.7, 110, '#4e8f61')
      ctx.fillStyle = '#c1121f'
      for (let i = 0; i < 12; i++) {
        const x = W * 0.5 + ((i * 97) % 260) - 130
        const y = H * 0.62 + ((i * 53) % 90)
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        ctx.fill()
      }
      // 栖枝小鸟
      ctx.fillStyle = '#14342a'
      ctx.beginPath()
      ctx.ellipse(W * 0.7, H * 0.5, 26, 20, -0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(W * 0.74, H * 0.47, 13, 0, Math.PI * 2)
      ctx.fill()
      birdV(ctx, W * 0.3, H * 0.2, 20, '#5a7a6f')
    },
  },
  {
    id: 'migratory',
    label: '候鸟',
    swatch: '#5b8fb9',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#a9cfe8'],
        [0.5, '#dcebf5'],
        [1, '#f3e9d2'],
      ])
      sun(ctx, W * 0.5, H * 0.62, 140, 'rgba(255,240,200,0.75)')
      cloud(ctx, W * 0.2, H * 0.18, 40, 'rgba(255,255,255,0.85)')
      cloud(ctx, W * 0.72, H * 0.26, 34, 'rgba(255,255,255,0.8)')
      const flocks: [number, number, number][] = [
        [0.28, 0.3, 26],
        [0.36, 0.24, 20],
        [0.44, 0.31, 22],
        [0.52, 0.22, 18],
        [0.6, 0.29, 24],
        [0.68, 0.2, 18],
        [0.76, 0.28, 20],
      ]
      for (const [fx, fy, s] of flocks) birdV(ctx, W * fx, H * fy, s, '#3a5a6a')
    },
  },
  {
    id: 'dusk',
    label: '暮色',
    swatch: '#6b4b8a',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#3b2a5a'],
        [0.45, '#9a5f86'],
        [0.7, '#e08a5a'],
        [1, '#f3c48a'],
      ])
      sun(ctx, W * 0.3, H * 0.62, 100, '#ffd98a')
      hills(ctx, W, H, H * 0.72, 60, '#2c2140')
      hills(ctx, W, H, H * 0.82, 45, '#1c152b')
      birdV(ctx, W * 0.6, H * 0.32, 24, '#f3d9b0')
      birdV(ctx, W * 0.68, H * 0.27, 18, '#f3d9b0')
      birdV(ctx, W * 0.76, H * 0.34, 20, '#f3d9b0')
    },
  },
  {
    id: 'mint',
    label: '薄荷纯色',
    swatch: '#40916c',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#1b4332'],
        [0.5, '#2d6a4f'],
        [1, '#40916c'],
      ])
    },
  },
  {
    id: 'graphite',
    label: '石墨纯色',
    swatch: '#232326',
    draw: (ctx, W, H) => {
      sky(ctx, W, H, [
        [0, '#0f0f10'],
        [0.5, '#232326'],
        [1, '#3a3a40'],
      ])
    },
  },
]

export function getBackground(id: string): PosterBackground {
  return POSTER_BACKGROUNDS.find((b) => b.id === id) ?? POSTER_BACKGROUNDS[0]!
}
