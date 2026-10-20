/**
 * 多窗分数聚合 —— BirdNET 一段录音会切成多个 3s 窗，需要合成一个分数。
 *
 * 2026-10-20 实测（40 条 R2 样本，按 commonness 分层）：
 *   median  top-1 45.0% / top-3 52.5%，命中样本里还有 2 条置信度 <10%
 *   p75     top-1 50.0% / top-3 55.0%，命中样本置信度均 ≥10%
 *   max     top-1 47.5% / top-3 52.5%
 *
 * 原因：20~30s 录音里鸟叫往往只占 1~2 个窗，中位数会把那几个窗的高分抹平；
 * 75 分位保留“确实叫过”的证据，又比 max 更抗单窗噪声。
 *
 * 这里用**线性插值**，与 NumPy `np.percentile(..., 75)` 对齐。
 */
export function percentileSorted(sorted: readonly number[], q = 0.75): number {
  if (!sorted.length) return 0
  if (sorted.length === 1) return sorted[0] ?? 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a
  return a + (b - a) * (pos - lo)
}
