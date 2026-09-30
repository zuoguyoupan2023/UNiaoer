/**
 * C7 地区浏览（017）纯逻辑：由 `public/data/distribution.json` 的 `bySpecies`
 * （{ 物种id: [ISO 3166-1 alpha-2 国家码…] }）反查「国家/地区 → 物种」，并归入七大洲。
 *
 * 政治/地图敏感性：
 * - 本项目**只做国家/地区文本列表，不涉及任何地图与边界**（未来若上地图，需专门处理边界）。
 * - 港澳台**单独列出**，但显示名按「中国香港／中国澳门／中国台湾」标注
 *   （英文 Hong Kong, China / Macao, China / Taiwan, China）；见 `REGION_LABEL_KEY`。
 * - 未收录/非法地区码（如数据源里的 `DT`）无大洲归属，在按大洲浏览时自然不出现。
 *
 * 国家名的本地化由视图用 Intl.DisplayNames + REGION_LABEL_KEY 完成，这里只处理结构与归类。
 */

export type Continent =
  | 'asia'
  | 'europe'
  | 'africa'
  | 'northAmerica'
  | 'southAmerica'
  | 'oceania'
  | 'antarctica'

/** 展示顺序（七大洲） */
export const CONTINENTS: Continent[] = [
  'asia',
  'europe',
  'africa',
  'northAmerica',
  'southAmerica',
  'oceania',
  'antarctica',
]

const EUROPE = [
  'AD', 'AL', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU',
  'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SJ',
  'SK', 'SM', 'UA', 'VA',
]
const ASIA = [
  'AE', 'AF', 'AM', 'AZ', 'BD', 'BH', 'BN', 'BT', 'CN', 'GE', 'HK', 'ID', 'IL', 'IN', 'IQ', 'IR',
  'JO', 'JP', 'KG', 'KH', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY',
  'NP', 'OM', 'PH', 'PK', 'PS', 'QA', 'SA', 'SG', 'SY', 'TH', 'TJ', 'TL', 'TM', 'TR', 'TW', 'UZ',
  'VN', 'YE',
]
const AFRICA = [
  'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ', 'DZ', 'EG', 'EH', 'ER',
  'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'IO', 'KE', 'KM', 'LR', 'LS', 'LY', 'MA', 'MG', 'ML',
  'MR', 'MU', 'MW', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW', 'SC', 'SD', 'SH', 'SL', 'SN', 'SO', 'SS',
  'ST', 'SZ', 'TD', 'TG', 'TN', 'TZ', 'UG', 'YT', 'ZA', 'ZM', 'ZW',
]
const NORTH_AMERICA = [
  'AG', 'AI', 'AW', 'BB', 'BL', 'BM', 'BQ', 'BS', 'BZ', 'CA', 'CR', 'CU', 'CW', 'DM', 'DO', 'GD',
  'GL', 'GP', 'GT', 'HN', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ', 'MS', 'MX', 'NI', 'PA', 'PM',
  'PR', 'SV', 'SX', 'TC', 'TT', 'US', 'VC', 'VG', 'VI',
]
const SOUTH_AMERICA = ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PE', 'PY', 'SR', 'UY', 'VE']
const OCEANIA = [
  'AS', 'AU', 'CC', 'CK', 'CX', 'FJ', 'FM', 'GU', 'HM', 'KI', 'MH', 'MP', 'NC', 'NF', 'NR', 'NU',
  'NZ', 'PF', 'PG', 'PN', 'PW', 'SB', 'TK', 'TO', 'TV', 'UM', 'VU', 'WF', 'WS',
]
const ANTARCTICA = ['AQ', 'BV', 'GS', 'TF']

const CONTINENT_BY_COUNTRY: Record<string, Continent> = {}
for (const [continent, codes] of [
  ['europe', EUROPE],
  ['asia', ASIA],
  ['africa', AFRICA],
  ['northAmerica', NORTH_AMERICA],
  ['southAmerica', SOUTH_AMERICA],
  ['oceania', OCEANIA],
  ['antarctica', ANTARCTICA],
] as const) {
  for (const code of codes) CONTINENT_BY_COUNTRY[code] = continent
}

/**
 * 需按「中国+地区」特别标注的地区码 → i18n key（视图用 t() 取显示名）。
 * 港澳台单独成条目，但显示为「中国香港／中国澳门／中国台湾」（英文 …, China）。
 */
export const REGION_LABEL_KEY: Record<string, string> = {
  HK: 'region.regions.HK',
  MO: 'region.regions.MO',
  TW: 'region.regions.TW',
}

/** 国家/地区码 → 所属大洲（未收录返回 undefined） */
export function continentOf(code: string): Continent | undefined {
  return CONTINENT_BY_COUNTRY[code]
}

export interface CountryStat {
  code: string
  count: number
}

/** 反查索引：countryCode → speciesId[]（保持输入物种顺序；同一物种同一码只记一次） */
export function buildCountryIndex(bySpecies: Record<string, string[]>): Record<string, string[]> {
  const byCountry: Record<string, string[]> = {}
  for (const [speciesId, codes] of Object.entries(bySpecies)) {
    const seen = new Set<string>()
    for (const code of codes) {
      if (seen.has(code)) continue
      seen.add(code)
      ;(byCountry[code] ??= []).push(speciesId)
    }
  }
  return byCountry
}

/** 国家/地区统计，按物种数降序（同数量按 code 升序，保证顺序稳定） */
export function countryStats(bySpecies: Record<string, string[]>): CountryStat[] {
  const counts = new Map<string, number>()
  for (const codes of Object.values(bySpecies)) {
    const seen = new Set<string>()
    for (const code of codes) {
      if (seen.has(code)) continue
      seen.add(code)
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

/** 过滤国家/地区：匹配代码或本地化名称（大小写不敏感），空查询返回全部 */
export function filterCountries(
  stats: CountryStat[],
  query: string,
  nameOf: (code: string) => string,
): CountryStat[] {
  const q = query.trim().toLowerCase()
  if (!q) return stats
  return stats.filter(
    (s) => s.code.toLowerCase().includes(q) || nameOf(s.code).toLowerCase().includes(q),
  )
}

/** 按大洲筛出国家/地区（保持传入顺序；无大洲归属的码自然被排除） */
export function countriesInContinent(
  stats: CountryStat[],
  continent: Continent,
): CountryStat[] {
  return stats.filter((s) => continentOf(s.code) === continent)
}

/** 有数据的大洲（按 CONTINENTS 顺序，只保留国家数 > 0 的） */
export function presentContinents(stats: CountryStat[]): Continent[] {
  const counts = new Map<Continent, number>()
  for (const s of stats) {
    const c = continentOf(s.code)
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return CONTINENTS.filter((c) => (counts.get(c) ?? 0) > 0)
}
