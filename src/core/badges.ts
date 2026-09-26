import type { RoundRecord, Stats } from './historyDb'

export type BadgeSeries = '入门' | '进阶' | '大师' | '隐藏'

export interface BadgeDef {
  id: string
  label: string
  icon: string
  desc: string
  series: BadgeSeries
  /** 隐藏徽章：未解锁时徽章墙显示 "???"（R28） */
  hidden?: boolean
  test: (s: Stats, rounds: RoundRecord[]) => boolean
}

// ---- 复合判定辅助（rounds 派生） ----

/** 按 at 排序后，最长连续满足 predicate 的轮数是否达到 n */
function consecutiveRounds(
  rounds: RoundRecord[],
  predicate: (r: RoundRecord) => boolean,
  n: number,
): boolean {
  const sorted = [...rounds].sort((a, b) => a.at - b.at)
  let run = 0
  let best = 0
  for (const r of sorted) {
    if (predicate(r)) {
      run++
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  return best >= n
}

/** L1–L5 每个难度都有满分轮（全档通关） */
function allTierPerfect(rounds: RoundRecord[]): boolean {
  const perfectTiers = new Set(
    rounds.filter((r) => r.total > 0 && r.correct === r.total).map((r) => r.tier),
  )
  return ([1, 2, 3, 4, 5] as const).every((t) => perfectTiers.has(t))
}

/** 同一物种累计错 3 次后首次答对（三顾茅庐） */
function tripleForgiven(rounds: RoundRecord[]): boolean {
  const sorted = [...rounds].sort((a, b) => a.at - b.at)
  const wrongCount = new Map<string, number>()
  for (const r of sorted) {
    for (const it of r.items) {
      if (it.correct) {
        if ((wrongCount.get(it.speciesId) ?? 0) >= 3) return true
      } else {
        wrongCount.set(it.speciesId, (wrongCount.get(it.speciesId) ?? 0) + 1)
      }
    }
  }
  return false
}

/** 全部物种都答对过至少一次（100 种，随题库扩充需同步阈值） */
const ALL_SPECIES_TOTAL = 100

/** 首批徽章体系（009）：入门 11 / 进阶 12 / 大师 6 / 隐藏 5，共 34 枚 */
export const BADGES: BadgeDef[] = [
  // ---------- 入门系列（快速正反馈） ----------
  {
    id: 'first-round',
    label: '首战告捷',
    icon: 'egg',
    desc: '完成第一轮答题',
    series: '入门',
    test: (s) => s.rounds >= 1,
  },
  {
    id: 'perfect',
    label: '满分达人',
    icon: 'badge-check',
    desc: '某一轮全部答对',
    series: '入门',
    test: (s) => s.perfectRounds >= 1,
  },
  {
    id: 'hundred',
    label: '百题斩',
    icon: 'target',
    desc: '累计答题 100 题',
    series: '入门',
    test: (s) => s.totalQuestions >= 100,
  },
  {
    id: 'listener',
    label: '听风者',
    icon: 'headphones',
    desc: '完成一轮听音认鸟',
    series: '入门',
    test: (s) => s.audioRounds >= 1,
  },
  {
    id: 'expert',
    label: '专家挑战',
    icon: 'brain',
    desc: '完成一轮 L4 专家难度',
    series: '入门',
    test: (s) => s.maxTier >= 4,
  },
  {
    id: 'beginner-birder',
    label: '鸟类入门',
    icon: 'book-open',
    desc: '累计认识 10 种鸟',
    series: '入门',
    test: (s) => s.distinctSpecies >= 10,
  },
  {
    id: 'streak',
    label: '连对达人',
    icon: 'flame',
    desc: '单轮连续答对 5 题',
    series: '入门',
    test: (s) => s.bestStreak >= 5,
  },
  {
    id: 'hell-first',
    label: '地狱首通',
    icon: 'skull',
    desc: '完成一局 L5 地狱难度',
    series: '入门',
    test: (s) => s.hellRounds >= 1,
  },
  {
    id: 'audio-perfect',
    label: '听音满分',
    icon: 'ear',
    desc: '听音版全部答对一轮',
    series: '入门',
    test: (s) => s.audioPerfectRounds >= 1,
  },
  {
    id: 'learned-revenge',
    label: '知耻后勇',
    icon: 'swords',
    desc: '错题重练轮全部答对',
    series: '入门',
    test: (s) => s.wrongPracticeRounds >= 1 && s.wrongPracticeCorrect >= 10,
  },
  {
    id: 'five-rounds',
    label: '初出茅庐',
    icon: 'footprints',
    desc: '完成 5 轮答题',
    series: '入门',
    test: (s) => s.rounds >= 5,
  },

  // ---------- 进阶系列（grind + 精度） ----------
  {
    id: 'thousand',
    label: '千题斩',
    icon: 'target',
    desc: '累计答题 1000 题',
    series: '进阶',
    test: (s) => s.totalQuestions >= 1000,
  },
  {
    id: 'veteran-fifty',
    label: '久经沙场',
    icon: 'shield',
    desc: '完成 50 轮答题',
    series: '进阶',
    test: (s) => s.rounds >= 50,
  },
  {
    id: 'collection-master',
    label: '图鉴大师',
    icon: 'book-open',
    desc: '累计认识 50 种鸟',
    series: '进阶',
    test: (s) => s.distinctSpecies >= 50,
  },
  {
    id: 'collection-all',
    label: '全图鉴',
    icon: 'crown',
    desc: `认识全部 ${ALL_SPECIES_TOTAL} 种鸟`,
    series: '进阶',
    test: (s) => s.distinctSpecies >= ALL_SPECIES_TOTAL,
  },
  {
    id: 'dual-perfect',
    label: '双料满分',
    icon: 'medal',
    desc: '看图、听音各有满分轮',
    series: '进阶',
    test: (s) => s.imagePerfectRounds >= 1 && s.audioPerfectRounds >= 1,
  },
  {
    id: 'stable-five',
    label: '稳定输出',
    icon: 'activity',
    desc: '连续 5 轮正确率 ≥80%',
    series: '进阶',
    test: (s, rounds) =>
      consecutiveRounds(rounds, (r) => r.total > 0 && r.accuracy >= 80, 5),
  },
  {
    id: 'audio-correct-200',
    label: '声入人心',
    icon: 'audio-lines',
    desc: '听音版累计答对 200 题',
    series: '进阶',
    test: (s) => s.audioCorrect >= 200,
  },
  {
    id: 'review-correct-30',
    label: '重练有成',
    icon: 'rotate-ccw',
    desc: '错题重练累计答对 30 题',
    series: '进阶',
    test: (s) => s.wrongPracticeCorrect >= 30,
  },
  {
    id: 'review-five',
    label: '复习家',
    icon: 'repeat',
    desc: '完成 5 轮错题重练',
    series: '进阶',
    test: (s) => s.wrongPracticeRounds >= 5,
  },
  {
    id: 'hell-ten',
    label: '炼狱十轮',
    icon: 'skull',
    desc: '完成 10 局 L5 地狱难度',
    series: '进阶',
    test: (s) => s.hellRounds >= 10,
  },
  {
    id: 'cross-streak-100',
    label: '百发百中',
    icon: 'crosshair',
    desc: '跨轮连续答对 100 题（中途无答错）',
    series: '进阶',
    test: (s) => s.maxCrossStreak >= 100,
  },
  {
    id: 'omniscient',
    label: '无所不知',
    icon: 'lightbulb',
    desc: `全部 ${ALL_SPECIES_TOTAL} 种鸟都答对过至少一次`,
    series: '进阶',
    test: (s) => s.distinctCorrect >= ALL_SPECIES_TOTAL,
  },

  // ---------- 大师系列（高门槛组合条件） ----------
  {
    id: 'all-tier-perfect',
    label: '全档通关',
    icon: 'crown',
    desc: 'L1–L5 每个难度都有满分轮',
    series: '大师',
    test: (s, rounds) => allTierPerfect(rounds),
  },
  {
    id: 'hell-perfect',
    label: '炼狱满分',
    icon: 'skull',
    desc: 'L5 地狱难度满分轮',
    series: '大师',
    test: (s) => s.hellPerfectRounds >= 1,
  },
  {
    id: 'perfect-three',
    label: '连续完美',
    icon: 'badge-check',
    desc: '连续 3 轮满分',
    series: '大师',
    test: (s, rounds) => consecutiveRounds(rounds, (r) => r.total > 0 && r.correct === r.total, 3),
  },
  {
    id: 'hell-coach',
    label: '地狱教官',
    icon: 'brain',
    desc: '完成 30 局 L5 且 L5 总正确率 ≥80%',
    series: '大师',
    test: (s) =>
      s.hellRounds >= 30 && s.hellQuestions > 0 && s.hellCorrect / s.hellQuestions >= 0.8,
  },
  {
    id: 'wrong-terminator',
    label: '错题终结者',
    icon: 'swords',
    desc: '曾经错过、如今错题本已空且累计答对 200 题',
    series: '大师',
    test: (s, rounds) =>
      s.wrongCount === 0 &&
      s.totalCorrect >= 200 &&
      rounds.some((r) => r.items.some((it) => !it.correct)),
  },
  {
    id: 'hundred-rounds',
    label: '老鸟百轮',
    icon: 'shield',
    desc: '完成 100 轮答题',
    series: '大师',
    test: (s) => s.rounds >= 100,
  },

  // ---------- 隐藏系列（彩蛋，不预告） ----------
  {
    id: 'night-owl',
    label: '夜枭猎手',
    icon: 'moon',
    desc: '深夜（23:00–1:00）完成一局答题',
    series: '隐藏',
    hidden: true,
    test: (s) => s.nightRound,
  },
  {
    id: 'lark',
    label: '闻鸡起舞',
    icon: 'sunrise',
    desc: '清晨（5:00–7:00）完成一局答题',
    series: '隐藏',
    hidden: true,
    test: (s) => s.dawnRound,
  },
  {
    id: 'escaped-quit',
    label: '浪子回头',
    icon: 'undo-2',
    desc: '点了退出又留下来，并把本轮全部答对',
    series: '隐藏',
    hidden: true,
    test: (s) => s.escapedQuitPerfect,
  },
  {
    id: 'triple-forgiven',
    label: '三顾茅庐',
    icon: 'heart-handshake',
    desc: '同一物种错 3 次后终于答对',
    series: '隐藏',
    hidden: true,
    test: (s, rounds) => tripleForgiven(rounds),
  },
  {
    id: 'phoenix',
    label: '百鸟朝凤',
    icon: 'crown',
    desc: '全图鉴 + 全档通关（集大成）',
    series: '隐藏',
    hidden: true,
    test: (s, rounds) => s.distinctSpecies >= ALL_SPECIES_TOTAL && allTierPerfect(rounds),
  },
]

/** 返回本次新获得的徽章（排除已获得的） */
export function evaluateBadges(
  stats: Stats,
  rounds: RoundRecord[],
  earnedIds: Set<string>,
): BadgeDef[] {
  return BADGES.filter((b) => !earnedIds.has(b.id) && b.test(stats, rounds))
}
