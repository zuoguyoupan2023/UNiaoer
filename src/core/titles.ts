/**
 * 称号体系（009）：轨道 → 阶梯 → 可佩戴。
 * 全部由本地数据实时派生（Stats + rounds），无新仓库；T7 物种之友由 rounds.items 聚合。
 * T0 段位的 levelScore 算法来自 008 §3：逐题加权（难度 × 模式 × 时间衰减）。
 */
import type { RoundRecord, Stats } from './historyDb'

export interface TitleLevel {
  threshold: number
  label: string
}

export interface TitleTrackDef {
  id: string
  name: string
  /** 轨道独特图标（lucide 名称，R37：称号墙/佩戴选择器/海报识别用） */
  icon: string
  metric: (s: Stats, rounds: RoundRecord[]) => number
  levels: TitleLevel[]
  /** 特殊轨道的称号文本（T7 物种之友带物种名）；缺省用 level.label */
  label?: (s: Stats, rounds: RoundRecord[]) => string
}

export interface EarnedTitle {
  trackId: string
  trackName: string
  /** 当前达到的最高级（≥1 才算获得） */
  level: number
  label: string
}

// ---- T0 段位：水平分（008 §3） ----

const TIER_FACTOR: Record<number, number> = { 1: 0.6, 2: 1.0, 3: 1.4, 4: 1.8, 5: 2.0 }
const MODE_FACTOR: Record<string, number> = { image: 1.0, audio: 1.2 }

/** 水平分 0–100：答对题的加权正确率，近 30 天权重高（反映"当前"水平） */
export function levelScore(rounds: RoundRecord[], now = Date.now()): number {
  let num = 0
  let den = 0
  for (const r of rounds) {
    const tf = TIER_FACTOR[r.tier] ?? 1
    const mf = MODE_FACTOR[r.mode] ?? 1
    const days = (now - r.at) / 86_400_000
    const decay = days <= 30 ? 1.2 : days <= 90 ? 1.0 : 0.6
    const w = tf * mf * decay
    for (const it of r.items) {
      den += w
      if (it.correct) num += 100 * w
    }
  }
  return den ? Math.round(num / den) : 0
}

/** 任一物种的最高答对次数 + 该物种名（T7 用） */
function topSpeciesCorrect(rounds: RoundRecord[]): { count: number; name: string } {
  const counts = new Map<string, { count: number; name: string }>()
  for (const r of rounds) {
    for (const it of r.items) {
      if (!it.correct) continue
      const cur = counts.get(it.speciesId)
      counts.set(it.speciesId, {
        count: (cur?.count ?? 0) + 1,
        name: it.answer,
      })
    }
  }
  let best = { count: 0, name: '' }
  for (const v of counts.values()) {
    if (v.count > best.count) best = v
  }
  return best
}

/** 称号轨道（数值避开徽章阈值，防同一事件双弹——见 009 §2.2） */
export const TITLE_TRACKS: TitleTrackDef[] = [
  {
    id: 'volume',
    icon: 'feather',
    name: '题量',
    metric: (s) => s.totalQuestions,
    levels: [
      { threshold: 250, label: '初试鸟语' },
      { threshold: 1000, label: '林间漫步者' },
      { threshold: 5000, label: '百鸟在心' },
    ],
  },
  {
    id: 'collection',
    icon: 'book-open',
    name: '物种图谱',
    metric: (s) => s.distinctSpecies,
    levels: [
      { threshold: 25, label: '点头之交' },
      { threshold: 50, label: '旧识满林' },
      { threshold: 100, label: '百鸟图谱' },
    ],
  },
  {
    id: 'streak',
    icon: 'flame',
    name: '连对',
    metric: (s) => s.bestStreak,
    levels: [
      { threshold: 10, label: '十连珠' },
      { threshold: 20, label: '稳如老鸟' },
      { threshold: 30, label: '一枪一个准' },
    ],
  },
  {
    id: 'perfect',
    icon: 'medal',
    name: '满分轮',
    metric: (s) => s.perfectRounds,
    levels: [
      { threshold: 3, label: '零失误' },
      { threshold: 10, label: '完美主义者' },
      { threshold: 30, label: '教科书级' },
    ],
  },
  {
    id: 'audio',
    icon: 'headphones',
    name: '听音专精',
    metric: (s) => s.audioRounds,
    levels: [
      { threshold: 10, label: '顺风耳' },
      { threshold: 30, label: '声谱图谱' },
      { threshold: 100, label: '听音辨鸟师' },
    ],
  },
  {
    id: 'hell',
    icon: 'skull',
    name: '地狱',
    metric: (s) => s.hellRounds,
    levels: [
      { threshold: 3, label: '炼狱归来' },
      { threshold: 10, label: '地狱常客' },
      { threshold: 30, label: '地狱教官' },
    ],
  },
  {
    id: 'rank',
    icon: 'crown',
    name: '水平段位',
    metric: (_s, rounds) => levelScore(rounds),
    // threshold 0 = 人人起步身份；段位跟随分数可升降
    levels: [
      { threshold: 0, label: '见习鸟人' },
      { threshold: 40, label: '入门鸟人' },
      { threshold: 60, label: '熟练鸟人' },
      { threshold: 75, label: '高手鸟人' },
      { threshold: 90, label: '鸟神' },
    ],
  },
  {
    id: 'species-friend',
    icon: 'heart-handshake',
    name: '物种之友',
    metric: (_s, rounds) => topSpeciesCorrect(rounds).count,
    label: (_s, rounds) => {
      const { count, name } = topSpeciesCorrect(rounds)
      if (count >= 50) return `${name}守护者`
      if (count >= 25) return `${name}挚友`
      if (count >= 10) return `${name}之友`
      return ''
    },
    levels: [
      { threshold: 10, label: '之友' },
      { threshold: 25, label: '挚友' },
      { threshold: 50, label: '守护者' },
    ],
  },
]

/** 当前各轨道达到的最高级 + 称号文本（level ≥1 才返回） */
export function evaluateTitles(stats: Stats, rounds: RoundRecord[]): EarnedTitle[] {
  const out: EarnedTitle[] = []
  for (const track of TITLE_TRACKS) {
    const value = track.metric(stats, rounds)
    let level = 0
    for (let i = 0; i < track.levels.length; i++) {
      if (value >= track.levels[i]!.threshold) level = i + 1
    }
    if (level < 1) continue
    const label = track.label ? track.label(stats, rounds) : track.levels[level - 1]!.label
    out.push({ trackId: track.id, trackName: track.name, level, label })
  }
  return out
}

/** 轨道某一级的称号文本（标记新解锁时用） */
export function titleLabelAt(
  track: TitleTrackDef,
  level: number,
  stats: Stats,
  rounds: RoundRecord[],
): string {
  return track.label ? track.label(stats, rounds) : track.levels[level - 1]!.label
}
