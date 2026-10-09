/**
 * 025 M1(P1-c):全球国家矩阵聚合纯函数(不碰网络/文件系统,可单测)。
 * 输入:GBIF SQL 行([{scientificname, countrycode, n}])+ 骨架学名→短码映射(键=normBinomial);
 * 输出:按国倒排的 AviList 短码集合。口径与省级矩阵一致(class='Aves' 观测,含引入种群;
 * presence 不带 count);行学名统一过 normBinomial(去作者/亚种并种),未收录学名/非法国家码显式丢弃并计数。
 */
import { normBinomial } from './verify-provinces-lib.mjs'
import { COUNTRY_DENY } from './config.mjs'

/** AviList 短码 = AvibaseID 去 'avibase-' 前缀(8 位字母数字,产物体积减半) */
export function shortCode(taxonKey) {
  const s = String(taxonKey || '')
  if (!s.startsWith('avibase-')) throw new Error(`distribution-global: 非法 taxonKey ${taxonKey || '(空)'}`)
  const code = s.slice('avibase-'.length)
  if (!/^[A-Z0-9]{6,10}$/.test(code)) throw new Error(`distribution-global: 非法 AvibaseID ${taxonKey}`)
  return code
}

const CC_RE = /^[A-Z]{2}$/

/** 默认"孤证地板"：单条记录（n<2）多为迷鸟/笼养逃逸/误认，不进地区矩阵（docs/036 §10） */
export const DEFAULT_MIN_RECORDS = 2

/**
 * 行聚合 → { byCountry: { [ISO2]: Set<shortCode> }, skipped: { unknownName, badCountry, deniedCountry, lowRecords } }
 * rows 元素容错:缺 scientificname/countrycode 的行按 skipped 计,不中断。
 *
 * `options.minRecords`（默认 2）= 孤证地板：同一 (国家,物种) 的多行先按记录数**合并**，
 * 合计 < 地板则丢弃。依据：中国境内 1 条记录的"长尾鹦鹉/美洲鸵鸟"等笼养逃逸噪声
 * 曾进入题库候选（实测 2026-10-09，见 docs/036 §10 / docs/038 §7）。
 */
export function aggregateCountryMatrix(rows, nameToCode, options = {}) {
  const minRecords = Number.isFinite(options.minRecords)
    ? Math.max(1, Math.trunc(options.minRecords))
    : DEFAULT_MIN_RECORDS
  // cc → Map<shortCode, n>：先累计再过滤（同一物种的亚种/作者注记行会被 normBinomial 合并）
  const counts = new Map()
  const skipped = { unknownName: 0, badCountry: 0, deniedCountry: 0, lowRecords: 0 }
  for (const r of rows || []) {
    const code = nameToCode.get(normBinomial(r?.scientificname))
    if (!code) {
      skipped.unknownName++
      continue
    }
    const cc = String(r?.countrycode || '').trim().toUpperCase()
    if (!CC_RE.test(cc)) {
      skipped.badCountry++
      continue
    }
    if (COUNTRY_DENY.has(cc)) {
      // 025 M1:ZZ(GBIF 未知桶)/XK(科索沃,铁律 6)/XZ(非国家码)——丢弃不归属
      skipped.deniedCountry++
      continue
    }
    let m = counts.get(cc)
    if (!m) counts.set(cc, (m = new Map()))
    m.set(code, (m.get(code) || 0) + (Number(r?.n) || 0))
  }
  const byCountry = new Map()
  for (const [cc, m] of counts) {
    const set = new Set()
    for (const [code, n] of m) {
      if (n >= minRecords) set.add(code)
      else skipped.lowRecords++
    }
    if (set.size) byCountry.set(cc, set)
  }
  return { byCountry, skipped }
}

/**
 * Map → 产物对象:国家按物种数降序、同数按码序;短码数组升序。
 */
export function toByCountryObject(byCountry) {
  const out = {}
  const sorted = [...byCountry.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
  for (const [cc, set] of sorted) out[cc] = [...set].sort()
  return out
}
