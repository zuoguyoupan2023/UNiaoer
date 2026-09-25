import type { Stats } from './historyDb'

export interface BadgeDef {
  id: string
  label: string
  emoji: string
  desc: string
  test: (s: Stats) => boolean
}

/** 首批徽章（纯规则，基于统计派生） */
export const BADGES: BadgeDef[] = [
  {
    id: 'first-round',
    label: '首战告捷',
    emoji: '🐣',
    desc: '完成第一轮答题',
    test: (s) => s.rounds >= 1,
  },
  {
    id: 'perfect',
    label: '满分达人',
    emoji: '💯',
    desc: '某一轮全部答对',
    test: (s) => s.perfectRounds >= 1,
  },
  {
    id: 'hundred',
    label: '百题斩',
    emoji: '🎯',
    desc: '累计答题 100 题',
    test: (s) => s.totalQuestions >= 100,
  },
  {
    id: 'listener',
    label: '听风者',
    emoji: '🎧',
    desc: '完成一轮听音认鸟',
    test: (s) => s.audioRounds >= 1,
  },
  {
    id: 'expert',
    label: '专家挑战',
    emoji: '🧠',
    desc: '完成一轮 L4 专家难度',
    test: (s) => s.maxTier >= 4,
  },
  {
    id: 'beginner-birder',
    label: '鸟类入门',
    emoji: '📖',
    desc: '累计认识 10 种鸟',
    test: (s) => s.distinctSpecies >= 10,
  },
  {
    id: 'streak',
    label: '连对达人',
    emoji: '🔥',
    desc: '单轮连续答对 5 题',
    test: (s) => s.bestStreak >= 5,
  },
]

/** 返回本次新获得的徽章（排除已获得的） */
export function evaluateBadges(stats: Stats, earnedIds: Set<string>): BadgeDef[] {
  return BADGES.filter((b) => !earnedIds.has(b.id) && b.test(stats))
}
