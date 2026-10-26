/**
 * 092 记忆挑战鸟评语（docs/092 §4.2，2026-10-27 用户定稿）：
 * 唯一评价维度是正计时用时——从第一张翻开到最后一对配对成功。
 * 三档硬阈值常量（看图 40/60s、听音 70/100s），不随地区/常见度变；
 * 阈值本体在 difficulty.MEMORY_THRESHOLDS_MS（与盘面常量同处），本模块只做判定。
 * 纯函数、不依赖 Vue —— 可单测（memoryRating.spec.ts）。
 */
import type { MediaType, MemoryRating } from '@/types'
import { MEMORY_THRESHOLDS_MS } from './difficulty'

/**
 * 用时 → 评语档。
 * - genius / awesome：用时 ≤ 对应阈值（含边界，≤40s 即天才）；
 * - good：配完全部对即可给（无下限——"坚持做完就有肯定"）。
 */
export function memoryRatingFor(type: MediaType, elapsedMs: number): MemoryRating {
  const t = MEMORY_THRESHOLDS_MS[type]
  if (elapsedMs <= t.genius) return 'genius'
  if (elapsedMs <= t.awesome) return 'awesome'
  return 'good'
}

/**
 * 用时展示文本（结果页/海报共用）：≥60s 显示「m 分 s 秒」，否则「s.x 秒」。
 * 计时停止后才调用（完成后/复盘），不做实时递增。
 */
export function formatMemoryTime(elapsedMs: number): string {
  const totalSec = Math.max(0, elapsedMs) / 1000
  const tenth = Math.round(totalSec * 10) / 10
  // 0.1s 精度舍入到 60.0 及以上 → 进位成分钟形态（59.96s 显示 1′00″ 而非"60.0″"）
  if (tenth >= 60) {
    const m = Math.floor(Math.round(totalSec) / 60)
    const s = Math.round(totalSec) - m * 60
    return `${m}′${String(s).padStart(2, '0')}″`
  }
  return `${tenth.toFixed(1)}″`
}
