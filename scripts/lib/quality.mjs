/**
 * 029 M3:质量降级的判定纯函数（构建期与单测共用）。
 *
 * 语义：某类型**有素材**但全部命中隔离清单 → 该物种降级（quizExcluded）。
 * 反例（**不算**降级）：
 *   · 完全无素材的种 —— 本就 playable=false，不是"降级"；
 *   · 只隔离了部分素材 —— 还有替补，构建期已换过（由 excludeUrls 机制保证）；
 *   · 清单为空。
 */
export function isDegraded(rec, banned) {
  const imgs = rec.images || (rec.image ? [rec.image] : [])
  const auds = rec.audios || (rec.audio ? [rec.audio] : [])
  if (!banned || banned.size === 0) return false
  const imageDead = imgs.length > 0 && imgs.every((m) => banned.has(m.url))
  const audioDead = auds.length > 0 && auds.every((m) => banned.has(m.url))
  return imageDead || audioDead
}
