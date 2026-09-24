export interface PosterTheme {
  id: string
  label: string
  /** 背景渐变：0% / 50% / 100% */
  stops: [string, string, string]
  /** 预览色块用 */
  swatch: string
}

/** 海报配色主题（用户可选） */
export const POSTER_THEMES: PosterTheme[] = [
  { id: 'forest', label: '森林绿', stops: ['#1b4332', '#2d6a4f', '#40916c'], swatch: '#2d6a4f' },
  { id: 'ocean', label: '海洋蓝', stops: ['#0b2545', '#13315c', '#1b6ca8'], swatch: '#13315c' },
  { id: 'dusk', label: '暮色紫', stops: ['#2b1055', '#4b2e83', '#7b4397'], swatch: '#4b2e83' },
  { id: 'sunset', label: '暖阳橙', stops: ['#7a2e00', '#c05621', '#f6ad55'], swatch: '#c05621' },
  { id: 'graphite', label: '石墨黑', stops: ['#0f0f10', '#232326', '#3a3a40'], swatch: '#232326' },
  { id: 'sakura', label: '樱花粉', stops: ['#7a2942', '#c96b8a', '#f2b8c6'], swatch: '#c96b8a' },
]

export function getTheme(id: string): PosterTheme {
  return POSTER_THEMES.find((t) => t.id === id) ?? POSTER_THEMES[0]!
}
