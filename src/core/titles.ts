/**
 * 称号体系（009）：轨道 → 阶梯 → 可佩戴。
 * 全部由本地数据实时派生（Stats + rounds），无新仓库；T7 物种之友由 rounds.items 聚合。
 * T0 段位的 levelScore 算法来自 008 §3：逐题加权（难度 × 模式 × 时间衰减）。
 */
import type { RoundRecord, Stats } from './historyDb'

export interface TitleLevel {
  threshold: number
  /** 级别称号语言包 key（titles.track.<track>.l<N>，渲染处 t()，015 §6.3） */
  labelKey: string
}

/** 称号文本 = 语言包 key + 插值参数（物种之友带物种名），组件用 t(text.key, text.params) 渲染 */
export interface TitleText {
  key: string
  params?: Record<string, string | number>
}

export interface TitleTrackDef {
  id: string
  /** 轨道名语言包 key */
  nameKey: string
  /** 轨道独特图标（lucide 名称，R37：称号墙/佩戴选择器/海报识别用） */
  icon: string
  metric: (s: Stats, rounds: RoundRecord[]) => number
  levels: TitleLevel[]
  /** 特殊轨道的称号文本（T7 物种之友带物种名）；缺省用 levels[level-1].labelKey */
  text?: (s: Stats, rounds: RoundRecord[]) => TitleText
}

export interface EarnedTitle {
  trackId: string
  trackNameKey: string
  /** 当前达到的最高级（≥1 才算获得） */
  level: number
  text: TitleText
}

// ---- T0 段位：水平分（008 §3） ----

const TIER_FACTOR: Record<number, number> = { 1: 0.6, 2: 1.0, 3: 1.4, 4: 1.8, 5: 2.0, 6: 2.2 }
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
    nameKey: 'titles.track.volume.name',
    metric: (s) => s.totalQuestions,
    levels: [
      { threshold: 250, labelKey: 'titles.track.volume.l1' },
      { threshold: 1000, labelKey: 'titles.track.volume.l2' },
      { threshold: 5000, labelKey: 'titles.track.volume.l3' },
    ],
  },
  {
    id: 'collection',
    icon: 'book-open',
    nameKey: 'titles.track.collection.name',
    metric: (s) => s.distinctSpecies,
    levels: [
      { threshold: 25, labelKey: 'titles.track.collection.l1' },
      { threshold: 50, labelKey: 'titles.track.collection.l2' },
      { threshold: 100, labelKey: 'titles.track.collection.l3' },
    ],
  },
  {
    id: 'streak',
    icon: 'flame',
    nameKey: 'titles.track.streak.name',
    metric: (s) => s.bestStreak,
    levels: [
      { threshold: 10, labelKey: 'titles.track.streak.l1' },
      { threshold: 20, labelKey: 'titles.track.streak.l2' },
      { threshold: 30, labelKey: 'titles.track.streak.l3' },
    ],
  },
  {
    id: 'perfect',
    icon: 'medal',
    nameKey: 'titles.track.perfect.name',
    metric: (s) => s.perfectRounds,
    levels: [
      { threshold: 3, labelKey: 'titles.track.perfect.l1' },
      { threshold: 10, labelKey: 'titles.track.perfect.l2' },
      { threshold: 30, labelKey: 'titles.track.perfect.l3' },
    ],
  },
  {
    id: 'audio',
    icon: 'headphones',
    nameKey: 'titles.track.audio.name',
    metric: (s) => s.audioRounds,
    levels: [
      { threshold: 10, labelKey: 'titles.track.audio.l1' },
      { threshold: 30, labelKey: 'titles.track.audio.l2' },
      { threshold: 100, labelKey: 'titles.track.audio.l3' },
    ],
  },
  {
    id: 'hell',
    icon: 'skull',
    nameKey: 'titles.track.hell.name',
    metric: (s) => s.hellRounds,
    levels: [
      { threshold: 3, labelKey: 'titles.track.hell.l1' },
      { threshold: 10, labelKey: 'titles.track.hell.l2' },
      { threshold: 30, labelKey: 'titles.track.hell.l3' },
    ],
  },
  {
    id: 'rank',
    icon: 'crown',
    nameKey: 'titles.track.rank.name',
    metric: (_s, rounds) => levelScore(rounds),
    // threshold 0 = 人人起步身份；段位跟随分数可升降
    levels: [
      { threshold: 0, labelKey: 'titles.track.rank.l1' },
      { threshold: 40, labelKey: 'titles.track.rank.l2' },
      { threshold: 60, labelKey: 'titles.track.rank.l3' },
      { threshold: 75, labelKey: 'titles.track.rank.l4' },
      { threshold: 90, labelKey: 'titles.track.rank.l5' },
    ],
  },
  {
    id: 'species-friend',
    icon: 'heart-handshake',
    nameKey: 'titles.track.speciesFriend.name',
    metric: (_s, rounds) => topSpeciesCorrect(rounds).count,
    text: (_s, rounds) => {
      const { count, name } = topSpeciesCorrect(rounds)
      if (count >= 50) return { key: 'titles.track.speciesFriend.guardian', params: { name } }
      if (count >= 25) return { key: 'titles.track.speciesFriend.close', params: { name } }
      return { key: 'titles.track.speciesFriend.friend', params: { name } }
    },
    levels: [
      { threshold: 10, labelKey: 'titles.track.speciesFriend.l1' },
      { threshold: 25, labelKey: 'titles.track.speciesFriend.l2' },
      { threshold: 50, labelKey: 'titles.track.speciesFriend.l3' },
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
    const text = track.text
      ? track.text(stats, rounds)
      : { key: track.levels[level - 1]!.labelKey }
    out.push({ trackId: track.id, trackNameKey: track.nameKey, level, text })
  }
  return out
}

/** 轨道某一级的称号文本（标记新解锁时用） */
export function titleTextAt(
  track: TitleTrackDef,
  level: number,
  stats: Stats,
  rounds: RoundRecord[],
): TitleText {
  return track.text ? track.text(stats, rounds) : { key: track.levels[level - 1]!.labelKey }
}
