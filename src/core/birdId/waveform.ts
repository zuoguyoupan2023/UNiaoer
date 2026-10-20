/**
 * 音频波形峰值 —— 给识别页的「你的录音 / 该种叫声」并排对比用
 *
 * 只做一件事：把解码后的样本压成 N 个桶的峰值（每桶取绝对值的最大值），
 * 归一化到 0..1，交给 canvas 画对称柱状波形。
 *
 * 为什么不直接画原始样本：一首 30s / 48kHz 的录音是 144 万个点，
 * 一屏只有几百像素宽，逐点画既慢又只剩一团噪声；按像素取峰值才是
 * 播放器（audacity / 各类 voice memo）的做法。
 */

/** 默认桶数：桌面端一屏波形约 480 根柱子，放大后仍够细 */
export const WAVE_BUCKETS = 480

/**
 * 压缩成峰值序列（0..1）。
 *
 * - 空样本 → 全 0（调用方画一条中线）；
 * - 全静音（峰值 < 1e-6）→ 全 0，不做除法；
 * - 否则按本段最大值归一化：手机录的鸟叫往往很轻，不归一化在界面上就是一条直线。
 */
export function computePeaks(samples: Float32Array, buckets = WAVE_BUCKETS): Float32Array {
  const n = Math.max(1, Math.floor(buckets))
  const out = new Float32Array(n)
  const len = samples.length
  if (!len) return out

  const per = len / n
  let max = 0
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per)
    const end = Math.min(len, Math.max(start + 1, Math.floor((b + 1) * per)))
    let peak = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]!)
      if (v > peak) peak = v
    }
    out[b] = peak
    if (peak > max) max = peak
  }

  if (max > 1e-6) {
    for (let i = 0; i < n; i++) out[i] = out[i]! / max
  }
  return out
}
