/**
 * 073 P0：把「地区正确率」的扁平行（region → n/mean）整理成
 * **国家级比较 + 同国内部的省级比较**。
 *
 * 分组规则（与 AGENTS 铁律 6 / 用户 2026-10-22 定）：
 *   · `CN-11`      → 国家 CN，省 CN-11
 *   · `CN`         → 国家 CN（只选到国家，没有省）
 *   · `US-CA`      → 国家 US，省 US-CA
 *   · `HK/MO/TW`   → **国家 CN，省 HK/MO/TW**（港澳台按「中国香港/中国澳门/中国台湾」，
 *                    放进中国内部做省级排序，**不参与国家级排序**）
 *   · `ALL` / 空   → 未指定（单列，不进任何比较）
 *
 * 为什么放在前端：当前只给 `/admin` 观察用（服务端只返回扁平行）。
 * 将来公开到 `/stats` 时可原样复用这套分组（静态 SPA 自己分组，payload 只有几十行）。
 */

export interface RegionCell {
  region: string
  n: number
  mean: number
  bands?: Record<string, number>
  tiers?: Record<string, number>
}

export interface ProvinceRow {
  code: string
  n: number
  mean: number
}

export interface CountryRow {
  code: string
  n: number
  mean: number
  /** 该国做过省级选择的地区（含 CN 的港澳台），按正确率降序 */
  provinces: ProvinceRow[]
}

export interface GroupedRegionStats {
  /** 国家级比较（不含港澳台独立成国） */
  countries: CountryRow[]
  /** 只选了「全球」的轮次（不进任何比较） */
  unspecified: { n: number; mean: number } | null
}

/** 港澳台：归属中国、做省级（铁律 6 的固定显示名在 i18n `region.regions.*`） */
const CN_SAR = new Set(['HK', 'MO', 'TW'])

/** 地区码 → { 国家码, 省级码（'' = 只选到国家）}；`ALL` 返回 null */
export function splitRegion(code: string): { country: string; province: string } | null {
  const v = String(code || '').trim().toUpperCase()
  if (!v || v === 'ALL') return null
  const [cc, ...rest] = v.split('-')
  if (!cc || cc.length !== 2) return null
  const prov = rest.join('-')
  if (prov) return { country: cc, province: v }
  if (CN_SAR.has(cc)) return { country: 'CN', province: cc }
  return { country: cc, province: '' }
}

/** 按 (n, mean) 合并：加权平均，避免把已取整的均值再简单平均 */
function mergeInto(map: Map<string, { n: number; weighted: number }>, key: string, cell: RegionCell) {
  const cur = map.get(key) ?? { n: 0, weighted: 0 }
  cur.n += cell.n
  cur.weighted += cell.mean * cell.n
  map.set(key, cur)
}

const meanOf = (n: number, weighted: number) => (n > 0 ? Math.round(weighted / n) : 0)

/**
 * 扁平行 → 两级结构。
 * 排序：正确率降序、轮次数降序（**不做最小轮数剔除**，用户 2026-10-22 明确要求先不剔；
 * 前端每行都显示 n，样本多少由读者自己判断）。
 */
export function groupRegions(rows: readonly RegionCell[]): GroupedRegionStats {
  const countries = new Map<string, { n: number; weighted: number }>()
  const provinces = new Map<string, Map<string, { n: number; weighted: number }>>()
  let unN = 0
  let unW = 0

  for (const cell of rows) {
    const split = splitRegion(cell.region)
    if (!split) {
      unN += cell.n
      unW += cell.mean * cell.n
      continue
    }
    mergeInto(countries, split.country, cell)
    if (split.province) {
      let m = provinces.get(split.country)
      if (!m) {
        m = new Map()
        provinces.set(split.country, m)
      }
      mergeInto(m, split.province, cell)
    }
  }

  const byMeanThenN = <T extends { n: number; mean: number }>(a: T, b: T) =>
    b.mean - a.mean || b.n - a.n

  const list: CountryRow[] = [...countries.entries()]
    .map(([code, c]) => ({
      code,
      n: c.n,
      mean: meanOf(c.n, c.weighted),
      provinces: [...(provinces.get(code) ?? new Map()).entries()]
        .map(([pcode, p]) => ({ code: pcode, n: p.n, mean: meanOf(p.n, p.weighted) }))
        .sort(byMeanThenN),
    }))
    .sort(byMeanThenN)

  return {
    countries: list,
    unspecified: unN > 0 ? { n: unN, mean: meanOf(unN, unW) } : null,
  }
}
