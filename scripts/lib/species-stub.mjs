/**
 * 定向重建时保全「只增字段」的纯函数（构建期与单测共用）。
 *
 * 背景（2026-10-29 三宝鸟事故）：`data/taxa.json` 不带 `taxonKey`（Avibase 概念键由
 * species-index 只增注入到完整层），而 `buildSpecies()` 每次都从 taxa.json 重建记录、
 * `taxonKey: sp.taxonKey ?? null` —— 于是每次按 SOP 定向修图都会**静默抹掉**该种的键，
 * 连带让性状层（按 taxonKey 挂载）丢条目。修复前已有 6 个种中招。
 *
 * 语义：新记录没算出 taxonKey 时，沿用上一版的；算出来了就以新值为准（允许上游纠正）。
 */
export function keepTaxonKey(next, prev) {
  if (!next) return prev?.taxonKey ?? null
  const own = next.taxonKey
  if (own) return own
  return prev?.taxonKey || null
}
