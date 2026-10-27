/**
 * 092 记忆挑战鸟评语（docs/092 §4.2，2026-10-27 用户改定）：
 * 唯一评价维度是正计时用时——从第一张翻开到最后一对配对成功。
 * 阈值按**盘面**取（大盘 60/90s、小盘 30/60s），看图与听音共用同一套；
 * 阈值本体在 difficulty.MEMORY_BOARDS，本模块只做判定。
 * 纯函数、不依赖 Vue —— 可单测（memoryRating.spec.ts）。
 */
import type { MemoryRating } from '@/types'
import { MEMORY_BOARDS, MEMORY_DEFAULT_BOARD } from './difficulty'

/** 对数 → 盘面定义（未知对数回退标准盘，旧记录/异常输入不报错） */
function boardOf(pairs?: number) {
  return (
    Object.values(MEMORY_BOARDS).find((b) => b.pairs === pairs) ?? MEMORY_BOARDS[MEMORY_DEFAULT_BOARD]
  )
}

/**
 * 用时 → 评语档（阈值按**盘面对数**取——大盘 12 对与缩小盘 6 对是两套阈值）。
 * - genius / awesome：用时 ≤ 对应阈值（含边界，大盘 ≤60s 即天才）；
 * - good：配完全部对即可给（无下限——"坚持做完就有肯定"）。
 */
export function memoryRatingFor(
  elapsedMs: number,
  pairs: number = MEMORY_BOARDS[MEMORY_DEFAULT_BOARD].pairs,
): MemoryRating {
  const board = boardOf(pairs)
  if (elapsedMs <= board.geniusMs) return 'genius'
  if (elapsedMs <= board.awesomeMs) return 'awesome'
  return 'good'
}

/**
 * 盘面 → 两档阈值的**秒数**（结果页「离下一档还差多少秒」提示用）。
 * pairs 缺省 = 标准盘（与 memoryRatingFor 同则）。
 */
export function memoryThresholdSec(pairs?: number): { genius: number; awesome: number } {
  const board = boardOf(pairs)
  return { genius: Math.round(board.geniusMs / 1000), awesome: Math.round(board.awesomeMs / 1000) }
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
