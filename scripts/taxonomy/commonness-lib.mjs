/**
 * 029 M0:常见度(commonness)合成 —— 纯函数。
 *
 * 三个信号 → log10 压缩 + 参考上限归一 → 加权分(0-1) → 五等分带映射档位(1 极常见 … 5 稀有)。
 * 参考上限取"到顶即封顶"的高位线(超过即视为满值),避免个别极值物种吃掉区分度
 * (实测 GBIF 最高 3,334 万条记录,全家燕级)。
 *
 * 口径说明(D-029-1,用户 2026-10-08 拍板):
 *   - GBIF 记录数有**采样努力偏差**(欧美 > 中国),只用于"全球稀有度",不当中国常见度;
 *     中国框架由 bank curated 值(manifest.commonness,人工)兜底。
 *   - XC 录音数兼作"音频池厚度"信号(录音很少的种,其听音题体验也差)。
 *   - 三个信号缺失任一:按**实际参与的信号**重归一权重(见 scoreSignals),不影响可用性。
 *
 * 实测信号分布(2026-10-08,全量):
 *   GBIF 记录数  p10=1  p50=32   p90=5,606    max=33,139,497
 *   XC 录音数    p10=0  p50=21   p90=152      max=9,653      (1,962 种为 0)
 *   分布国家数*  由 species-distribution.json 反演(249 国 / 11,065 种覆盖)
 *   *国家数分布随骨架导出,见 docs/029 M0 完成记录。
 */
export const SIGNAL_WEIGHTS = { gbifRecords: 0.4, countries: 0.3, xcRecordings: 0.3 }

/** 参考上限:log10 归一的封顶值(超过即 1)。 */
export const SIGNAL_CAPS = { gbifRecords: 1e7, countries: 249, xcRecordings: 1e4 }

/** log10(x+1) / log10(cap+1),clamp [0,1];缺失/非数/≤0 → 0。 */
export function logNorm(x, cap) {
  const v = Number(x)
  if (!Number.isFinite(v) || v <= 0) return 0
  const c = Number(cap)
  if (!Number.isFinite(c) || c <= 0) return 0
  return Math.min(1, Math.log10(v + 1) / Math.log10(c + 1))
}

/**
 * 信号 → 0-1 加权分。
 * 只对 `signals` 里**实际出现的键**计算,并按这些键的权重和归一:
 * 例:{ gbifRecords: 1e7 } → 1.0(唯一可用信号满值);{ gbifRecords: 1e7, countries: 0, xcRecordings: 0 } → 0.4。
 * 这样某个信号源缺失(如未下载 GBIF 记录)时不会把全体物种推向"稀有"。
 */
export function scoreSignals(signals, { weights = SIGNAL_WEIGHTS, caps = SIGNAL_CAPS } = {}) {
  let total = 0
  let wsum = 0
  for (const [name, weight] of Object.entries(weights)) {
    if (!(name in signals)) continue
    total += weight * logNorm(signals[name], caps[name])
    wsum += weight
  }
  if (wsum <= 0) return 0
  return Math.min(1, Math.max(0, total / wsum))
}

/**
 * 五等分带(score 越高越常见):
 *   (0.8, 1.0] → 1 极常见 · (0.6, 0.8] → 2 · (0.4, 0.6] → 3 · (0.2, 0.4] → 4 · [0, 0.2] → 5 稀有
 * 与 bank 现有 1-4 档同向(1=最常见,见 src/core/difficulty.ts),5 档为全球长尾新增。
 */
export function tierOf(score) {
  const s = Math.min(1, Math.max(0, Number(score) || 0))
  return Math.min(5, Math.max(1, Math.ceil((1 - s) * 5)))
}

/** GBIF occurrence 名 → 双名归一(属+种;丢弃作者引文/三名法尾巴,支持亚种记录并种)。 */
export function binomialName(s) {
  const parts = String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return parts.slice(0, 2).join(' ')
}
