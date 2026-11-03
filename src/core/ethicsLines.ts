/**
 * 加载等待期的宣传语文案池（2026-11-03 用户定）。
 *
 * 每次进入加载态随机取一条，按界面语言显示中文或英文。
 * 不渲染任何标题、标签、编号。
 */

export interface EthicsLine {
  zh: string
  en: string
}

export const ETHICS_LINES: EthicsLine[] = [
  {
    zh: '不要诱拍！不要诱拍！不要诱拍！',
    en: 'No Baiting! No Baiting! No Baiting!',
  },
  {
    zh: '不要投喂！不要投喂！不要投喂！',
    en: 'No Feeding! No Feeding! No Feeding!',
  },
  {
    zh: '观鸟 ✓　拍鸟 ✓　打鸟 ✗',
    en: 'Birding ✓　Photography ✓　Hunting ✗',
  },
  {
    zh: '不要报点！',
    en: 'No Location Sharing!',
  },
  {
    zh: '保持距离，给鸟空间。',
    en: 'Keep your distance. Give birds space.',
  },
  {
    zh: '观察，不打扰。',
    en: 'Observe. Don’t disturb.',
  },
  {
    zh: '不要声诱，不要食诱。',
    en: 'No playback, no bait.',
  },
  {
    zh: '不要声诱，不要食诱。',
    en: 'No tape, no bait.',
  },
  {
    zh: '不留痕迹，不带走鸟。',
    en: 'Leave no trace, take no bird.',
  },
  {
    zh: '观鸟时永远以鸟为先。',
    en: 'The bird comes first. Always.',
  },
  {
    zh: '保护栖息地，就是保护鸟。',
    en: 'Protect the habitat, protect the bird.',
  },
]

let lastIdx = -1

/** 随机取一条（不与上次重复），按界面语言返回文本 */
export function pickEthicsLine(locale: string): string {
  if (!ETHICS_LINES.length) return ''
  let i = lastIdx
  if (ETHICS_LINES.length > 1) {
    for (let guard = 0; guard < 8; guard++) {
      i = Math.floor(Math.random() * ETHICS_LINES.length)
      if (i !== lastIdx) break
    }
    if (i === lastIdx) i = (lastIdx + 1) % ETHICS_LINES.length
  } else {
    i = 0
  }
  lastIdx = i
  const line = ETHICS_LINES[i]!
  return locale.startsWith('zh') ? line.zh : line.en
}
