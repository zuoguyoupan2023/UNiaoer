/**
 * D5 自适应难度（006）：按最近若干轮的滚动正确率，建议升/降/保持档位。
 * 纯函数、无副作用，便于单测；是否采用由设置开关与 UI 决定。
 *
 * 规则（滚动窗口 5 轮，至少 3 轮才给建议）：
 * - 平均正确率 ≥ 90% → 升一档（上限 L5）
 * - 平均正确率 ≤ 50% → 降一档（下限 L1）
 * - 其余 → 保持
 * 只统计常规轮次（排除错题重练 source='wrong-practice'），并要求轮次模式（图/声）一致。
 */
import type { MediaType, Tier } from '@/types'
import type { RoundRecord } from './historyDb'

export interface TierSuggestion {
  tier: Tier
  change: 'up' | 'down' | 'stay'
  /** 参与统计的轮次数 */
  sample: number
  /** 滚动平均正确率（0–100）；样本为 0 时为 null */
  accuracy: number | null
}

export const ADAPTIVE_WINDOW = 5
export const ADAPTIVE_MIN_SAMPLE = 3
export const ADAPTIVE_UP = 90
export const ADAPTIVE_DOWN = 50
/** 自适应升档上限（045：不含 L6） */
const ADAPTIVE_MAX_TIER = 5

/** 最近 window 轮（同模式、非错题重练）的合计正确率与样本数 */
export function recentAccuracy(
  rounds: readonly RoundRecord[],
  mode: MediaType,
  window = ADAPTIVE_WINDOW,
): { accuracy: number | null; sample: number } {
  const list = rounds
    .filter((r) => r.mode === mode && r.source !== 'wrong-practice' && r.total > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, window)
  if (!list.length) return { accuracy: null, sample: 0 }
  const correct = list.reduce((n, r) => n + r.correct, 0)
  const total = list.reduce((n, r) => n + r.total, 0)
  return { accuracy: total ? Math.round((correct / total) * 100) : null, sample: list.length }
}

/** 依据滚动正确率给出建议档位（样本不足时保持 currentTier） */
export function suggestTier(
  rounds: readonly RoundRecord[],
  mode: MediaType,
  currentTier: Tier,
): TierSuggestion {
  const { accuracy, sample } = recentAccuracy(rounds, mode)
  if (sample < ADAPTIVE_MIN_SAMPLE || accuracy == null) {
    return { tier: currentTier, change: 'stay', sample, accuracy }
  }
  // 045：自适应升档**封顶 L5**——L6「非人级别」是另一种识别体系（选项只用学名），
  // 不能因为正确率高就自动把用户塞进去，只能手选。
  if (accuracy >= ADAPTIVE_UP && currentTier < ADAPTIVE_MAX_TIER) {
    return { tier: (currentTier + 1) as Tier, change: 'up', sample, accuracy }
  }
  if (accuracy <= ADAPTIVE_DOWN && currentTier > 1) {
    return { tier: (currentTier - 1) as Tier, change: 'down', sample, accuracy }
  }
  return { tier: currentTier, change: 'stay', sample, accuracy }
}
