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

/**
 * 行聚合 → { byCountry: { [ISO2]: Set<shortCode> }, skipped: { unknownName, badCountry } }
 * rows 元素容错:缺 scientificname/countrycode 的行按 skipped 计,不中断。
 */
export function aggregateCountryMatrix(rows, nameToCode) {
  const byCountry = new Map()
  const skipped = { unknownName: 0, badCountry: 0, deniedCountry: 0 }
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
    if (!byCountry.has(cc)) byCountry.set(cc, new Set())
    byCountry.get(cc).add(code)
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
