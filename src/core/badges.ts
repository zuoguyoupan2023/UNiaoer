import type { RoundRecord, Stats } from './historyDb'

export type BadgeSeries = 'starter' | 'advanced' | 'master' | 'hidden'

export interface BadgeDef {
  id: string
  /** 名称/描述语言包 key（badges.<id>.label / .desc，渲染处 t()，015 §6.3） */
  labelKey: string
  icon: string
  descKey: string
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

/**
 * L6 非人级别满一轮（045）。
 * 单设一枚徽章，**不改** `all-tier-perfect`（L1–L5 全档通关）的语义——
 * 否则老用户的既有成就会在版本更新后被判为"未达成"。
 */
function nonHumanPerfect(rounds: RoundRecord[]): boolean {
  return rounds.some((r) => r.tier === 6 && r.total > 0 && r.correct === r.total)
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

/** 全部物种都答对过至少一次（100 种，随题库扩充需同步阈值）；desc 文案渲染时以 {n} 传入 */
export const ALL_SPECIES_TOTAL = 100

/** 首批徽章体系（009）：入门 11 / 进阶 12 / 大师 6 / 隐藏 5，共 34 枚 */
export const BADGES: BadgeDef[] = [
  // ---------- 入门系列（快速正反馈） ----------
  {
    id: 'first-round',
    labelKey: 'badges.firstRound.label',
    icon: 'egg',
    descKey: 'badges.firstRound.desc',
    series: 'starter',
    test: (s) => s.rounds >= 1,
  },
  {
    id: 'perfect',
    labelKey: 'badges.perfect.label',
    icon: 'badge-check',
    descKey: 'badges.perfect.desc',
    series: 'starter',
    test: (s) => s.perfectRounds >= 1,
  },
  {
    id: 'hundred',
    labelKey: 'badges.hundred.label',
    icon: 'target',
    descKey: 'badges.hundred.desc',
    series: 'starter',
    test: (s) => s.totalQuestions >= 100,
  },
  {
    id: 'listener',
    labelKey: 'badges.listener.label',
    icon: 'headphones',
    descKey: 'badges.listener.desc',
    series: 'starter',
    test: (s) => s.audioRounds >= 1,
  },
  {
    id: 'expert',
    labelKey: 'badges.expert.label',
    icon: 'brain',
    descKey: 'badges.expert.desc',
    series: 'starter',
    test: (s) => s.maxTier >= 4,
  },
  {
    id: 'beginner-birder',
    labelKey: 'badges.beginnerBirder.label',
    icon: 'book-open',
    descKey: 'badges.beginnerBirder.desc',
    series: 'starter',
    test: (s) => s.distinctSpecies >= 10,
  },
  {
    id: 'streak',
    labelKey: 'badges.streak.label',
    icon: 'flame',
    descKey: 'badges.streak.desc',
    series: 'starter',
    test: (s) => s.bestStreak >= 5,
  },
  {
    id: 'hell-first',
    labelKey: 'badges.hellFirst.label',
    icon: 'skull',
    descKey: 'badges.hellFirst.desc',
    series: 'starter',
    test: (s) => s.hellRounds >= 1,
  },
  {
    id: 'audio-perfect',
    labelKey: 'badges.audioPerfect.label',
    icon: 'ear',
    descKey: 'badges.audioPerfect.desc',
    series: 'starter',
    test: (s) => s.audioPerfectRounds >= 1,
  },
  {
    id: 'learned-revenge',
    labelKey: 'badges.learnedRevenge.label',
    icon: 'swords',
    descKey: 'badges.learnedRevenge.desc',
    series: 'starter',
    test: (s) => s.wrongPracticeRounds >= 1 && s.wrongPracticeCorrect >= 10,
  },
  {
    id: 'five-rounds',
    labelKey: 'badges.fiveRounds.label',
    icon: 'footprints',
    descKey: 'badges.fiveRounds.desc',
    series: 'starter',
    test: (s) => s.rounds >= 5,
  },

  // ---------- 进阶系列（grind + 精度） ----------
  {
    id: 'thousand',
    labelKey: 'badges.thousand.label',
    icon: 'target',
    descKey: 'badges.thousand.desc',
    series: 'advanced',
    test: (s) => s.totalQuestions >= 1000,
  },
  {
    id: 'veteran-fifty',
    labelKey: 'badges.veteranFifty.label',
    icon: 'shield',
    descKey: 'badges.veteranFifty.desc',
    series: 'advanced',
    test: (s) => s.rounds >= 50,
  },
  {
    id: 'collection-master',
    labelKey: 'badges.collectionMaster.label',
    icon: 'book-open',
    descKey: 'badges.collectionMaster.desc',
    series: 'advanced',
    test: (s) => s.distinctSpecies >= 50,
  },
  {
    id: 'collection-all',
    labelKey: 'badges.collectionAll.label',
    icon: 'crown',
    descKey: 'badges.collectionAll.desc',
    series: 'advanced',
    test: (s) => s.distinctSpecies >= ALL_SPECIES_TOTAL,
  },
  {
    id: 'dual-perfect',
    labelKey: 'badges.dualPerfect.label',
    icon: 'medal',
    descKey: 'badges.dualPerfect.desc',
    series: 'advanced',
    test: (s) => s.imagePerfectRounds >= 1 && s.audioPerfectRounds >= 1,
  },
  {
    id: 'stable-five',
    labelKey: 'badges.stableFive.label',
    icon: 'activity',
    descKey: 'badges.stableFive.desc',
    series: 'advanced',
    test: (s, rounds) =>
      consecutiveRounds(rounds, (r) => r.total > 0 && r.accuracy >= 80, 5),
  },
  {
    id: 'audio-correct-200',
    labelKey: 'badges.audioCorrect200.label',
    icon: 'audio-lines',
    descKey: 'badges.audioCorrect200.desc',
    series: 'advanced',
    test: (s) => s.audioCorrect >= 200,
  },
  {
    id: 'review-correct-30',
    labelKey: 'badges.reviewCorrect30.label',
    icon: 'rotate-ccw',
    descKey: 'badges.reviewCorrect30.desc',
    series: 'advanced',
    test: (s) => s.wrongPracticeCorrect >= 30,
  },
  {
    id: 'review-five',
    labelKey: 'badges.reviewFive.label',
    icon: 'repeat',
    descKey: 'badges.reviewFive.desc',
    series: 'advanced',
    test: (s) => s.wrongPracticeRounds >= 5,
  },
  {
    id: 'hell-ten',
    labelKey: 'badges.hellTen.label',
    icon: 'skull',
    descKey: 'badges.hellTen.desc',
    series: 'advanced',
    test: (s) => s.hellRounds >= 10,
  },
  {
    id: 'cross-streak-100',
    labelKey: 'badges.crossStreak100.label',
    icon: 'crosshair',
    descKey: 'badges.crossStreak100.desc',
    series: 'advanced',
    test: (s) => s.maxCrossStreak >= 100,
  },
  {
    id: 'omniscient',
    labelKey: 'badges.omniscient.label',
    icon: 'lightbulb',
    descKey: 'badges.omniscient.desc',
    series: 'advanced',
    test: (s) => s.distinctCorrect >= ALL_SPECIES_TOTAL,
  },

  // ---------- 大师系列（高门槛组合条件） ----------
  {
    id: 'all-tier-perfect',
    labelKey: 'badges.allTierPerfect.label',
    icon: 'crown',
    descKey: 'badges.allTierPerfect.desc',
    series: 'master',
    test: (s, rounds) => allTierPerfect(rounds),
  },
  {
    id: 'non-human-perfect',
    labelKey: 'badges.nonHumanPerfect.label',
    icon: 'skull',
    descKey: 'badges.nonHumanPerfect.desc',
    series: 'master',
    test: (s, rounds) => nonHumanPerfect(rounds),
  },
  {
    id: 'hell-perfect',
    labelKey: 'badges.hellPerfect.label',
    icon: 'skull',
    descKey: 'badges.hellPerfect.desc',
    series: 'master',
    test: (s) => s.hellPerfectRounds >= 1,
  },
  {
    id: 'perfect-three',
    labelKey: 'badges.perfectThree.label',
    icon: 'badge-check',
    descKey: 'badges.perfectThree.desc',
    series: 'master',
    test: (s, rounds) => consecutiveRounds(rounds, (r) => r.total > 0 && r.correct === r.total, 3),
  },
  {
    id: 'hell-coach',
    labelKey: 'badges.hellCoach.label',
    icon: 'brain',
    descKey: 'badges.hellCoach.desc',
    series: 'master',
    test: (s) =>
      s.hellRounds >= 30 && s.hellQuestions > 0 && s.hellCorrect / s.hellQuestions >= 0.8,
  },
  {
    id: 'wrong-terminator',
    labelKey: 'badges.wrongTerminator.label',
    icon: 'swords',
    descKey: 'badges.wrongTerminator.desc',
    series: 'master',
    test: (s, rounds) =>
      s.wrongCount === 0 &&
      s.totalCorrect >= 200 &&
      rounds.some((r) => r.items.some((it) => !it.correct)),
  },
  {
    id: 'hundred-rounds',
    labelKey: 'badges.hundredRounds.label',
    icon: 'shield',
    descKey: 'badges.hundredRounds.desc',
    series: 'master',
    test: (s) => s.rounds >= 100,
  },

  // ---------- 隐藏系列（彩蛋，不预告） ----------
  {
    id: 'night-owl',
    labelKey: 'badges.nightOwl.label',
    icon: 'moon',
    descKey: 'badges.nightOwl.desc',
    series: 'hidden',
    hidden: true,
    test: (s) => s.nightRound,
  },
  {
    id: 'lark',
    labelKey: 'badges.lark.label',
    icon: 'sunrise',
    descKey: 'badges.lark.desc',
    series: 'hidden',
    hidden: true,
    test: (s) => s.dawnRound,
  },
  {
    id: 'escaped-quit',
    labelKey: 'badges.escapedQuit.label',
    icon: 'undo-2',
    descKey: 'badges.escapedQuit.desc',
    series: 'hidden',
    hidden: true,
    test: (s) => s.escapedQuitPerfect,
  },
  {
    id: 'triple-forgiven',
    labelKey: 'badges.tripleForgiven.label',
    icon: 'heart-handshake',
    descKey: 'badges.tripleForgiven.desc',
    series: 'hidden',
    hidden: true,
    test: (s, rounds) => tripleForgiven(rounds),
  },
  {
    id: 'phoenix',
    labelKey: 'badges.phoenix.label',
    icon: 'crown',
    descKey: 'badges.phoenix.desc',
    series: 'hidden',
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
