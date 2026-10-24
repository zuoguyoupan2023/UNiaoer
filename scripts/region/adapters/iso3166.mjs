/**
 * 021 §2.2 ISO 3166-2 adapter（纯函数，可单测）。
 * 用途：把 GBIF `stateProvince` 自由文本映射到稳定的 ISO 3166-2 code
 * （用户决定 2026-10-02：M2 先用 ISO 3166-2 作规范基准，eBird subnational1 后补）。
 *
 * 数据集：alexander-schranz/iso-3166-2（MIT），每国 `<cc>.json` = { 'US-CA': 'California', ... }
 * 名称含多语言变体，以换行 `\n` 或 `!` 分隔，括号/方括号为别名，已在本模块统一展开。
 */

/**
 * 归一化：去变音符、**折叠不可分解的拉丁变体字母**（đ/ø/ł/ð/æ/þ 等，NFD 无法拆）、
 * 小写、非字母数字折叠为空格。越南 `Đồng Nai` 的 `Đ` 即此类（否则会变成 `ong nai`）。
 */
export function canonName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[þÞ]/g, 'th')
    .replace(/[ß]/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// 行政后缀/连接词：多语种（含西语 comunidad/foral/principado、越南 thanh pho、中文 sheng、英语 prov）
const SUFFIX =
  /\b(state|province|prov|prefecture|territory|region|county|district|city|comunidad|foral|autonoma|principado|ciudad|thanh|pho|sheng|division|bibhag|of|the|de|del|la|el)\b/g

/**
 * 一个名称（ISO 名或 GBIF 自由文本）→ 可能的匹配键集合。
 * 展开多语言分隔（\n、!）、括号/方括号别名、行政后缀与逗号后注，并补「分隔符尾段」。
 */
export function nameKeys(name) {
  const keys = new Set()
  const raw = String(name || '')
  const add = (s) => {
    const k = canonName(s)
    if (!k) return
    keys.add(k)
    const stripped = canonName(k.replace(SUFFIX, ' '))
    if (stripped) keys.add(stripped)
  }
  for (const line of raw.split(/[\n!]+/)) {
    add(line.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' '))
    for (const m of line.matchAll(/\[([^\]]*)\]/g)) add(m[1])
    for (const m of line.matchAll(/\(([^)]*)\)/g)) add(m[1])
    if (line.includes(',')) add(line.split(',')[0]) // "Michigan, Captive" → "Michigan"
  }
  // "Scotland - Highland" / "England – Norfolk"：尾段单独成键
  for (const sep of [' - ', ' – ', ' — ', ' -', '- ']) {
    if (raw.includes(sep)) add(raw.split(sep).pop())
  }
  return keys
}

import { AUTO_ALIASES } from '../aliases-auto.mjs'
import { PROVINCE_TO_L1 } from './province-to-region.mjs'

// 转出口：供测试与外部脚本引用（真实定义在 ./province-to-region.mjs）
export { PROVINCE_TO_L1 }

/**
 * 自由文本别名 → ISO code（仅收已知高频变体；不臆造）。
 * key 为 canonName 结果；日本按 GBIF 常用赫本式补 ISO 训令式拼写之缺。
 *
 * 2026-10-23：机器生成的候选（`npm run region:suggest-aliases -- --write` → `aliases-auto.mjs`）
 * 会**先铺底**，下面的人工条目**后写覆盖**（同名冲突以人工为准）。
 */
export const NAME_ALIASES = {
  ...AUTO_ALIASES,
  // 日本：赫本式 → ISO code（ISO 本身为训令式拼写，如 Tiba/Gihu）
  aichi: 'JP-23', gifu: 'JP-21', hiroshima: 'JP-34', fukui: 'JP-18', fukuoka: 'JP-40',
  fukushima: 'JP-07', ishikawa: 'JP-17', kagoshima: 'JP-46', kochi: 'JP-39', kyoto: 'JP-26',
  oita: 'JP-44', osaka: 'JP-27', shiga: 'JP-25', shizuoka: 'JP-22', chiba: 'JP-12',
  tochigi: 'JP-09', tokushima: 'JP-36', tokyo: 'JP-13', yamaguchi: 'JP-35', yamanashi: 'JP-19',
  shimane: 'JP-32', hokkaido: 'JP-01', hyogo: 'JP-28',
  // 美国：两位缩写 + 特区
  wa: 'US-WA', dc: 'US-DC', 'washington d c': 'US-DC', 'district of columbia': 'US-DC',
  al: 'US-AL', ak: 'US-AK', az: 'US-AZ', ar: 'US-AR', ca: 'US-CA', co: 'US-CO', ct: 'US-CT',
  de: 'US-DE', fl: 'US-FL', ga: 'US-GA', hi: 'US-HI', id: 'US-ID', il: 'US-IL', in: 'US-IN',
  ia: 'US-IA', ks: 'US-KS', ky: 'US-KY', la: 'US-LA', me: 'US-ME', md: 'US-MD', ma: 'US-MA',
  mi: 'US-MI', mn: 'US-MN', ms: 'US-MS', mo: 'US-MO', mt: 'US-MT', ne: 'US-NE', nv: 'US-NV',
  nh: 'US-NH', nj: 'US-NJ', nm: 'US-NM', ny: 'US-NY', nc: 'US-NC', nd: 'US-ND', oh: 'US-OH',
  ok: 'US-OK', or: 'US-OR', pa: 'US-PA', ri: 'US-RI', sc: 'US-SC', sd: 'US-SD', tn: 'US-TN',
  tx: 'US-TX', ut: 'US-UT', vt: 'US-VT', va: 'US-VA', wv: 'US-WV', wi: 'US-WI', wy: 'US-WY',
  // 澳大利亚：GBIF 偶见法/荷译名
  'nouvelle galles du sud': 'AU-NSW', 'noordoost australie': 'AU-QLD',
  'west australie': 'AU-WA', 'australia del sur': 'AU-SA',
  // 中国：旧拼音/历史拼写/后缀变体（GBIF stateProvince 实测值，021 M3）。
  // 注意消歧：Shanxi 山西 CN-14 ≠ Shaanxi 陕西 CN-61（canon 后本就不同键）。
  // "Manchuria"（东北历史地区，跨黑吉辽）不映射——无法安全归单省，丢弃不臆造。
  szechwan: 'CN-51', szechuan: 'CN-51', hopei: 'CN-13', shansi: 'CN-14',
  shensi: 'CN-61', sinkiang: 'CN-65', 'heilongjiang prov': 'CN-23',
  tibet: 'CN-54', xizang: 'CN-54', hongkong: 'CN-91', macau: 'CN-92', taiwan: 'CN-71',
  // 中国历史拼写补充（GBIF stateProvince 实测，2026-10-03）
  kiangsu: 'CN-32', shantung: 'CN-37', chekiang: 'CN-33', fukien: 'CN-35',
  heilungkiang: 'CN-23', kirin: 'CN-22', kweichow: 'CN-52',
  xinjiang: 'CN-65', 'xinjiang uygur': 'CN-65', ningxia: 'CN-64', 'ningxia hui': 'CN-64',
  // 西班牙：加泰语/英语变体（ISO 数据集用 Catalunya，GBIF 常用 Cataluña/Catalonia）
  cataluna: 'ES-CT', catalonia: 'ES-CT', 'illes baleares': 'ES-IB',
  // 荷兰：英语/旧拼写（数据集 Fryslân/Zuid-Holland）
  friesland: 'NL-FR', frisia: 'NL-FR', drente: 'NL-DR',
  'south holland': 'NL-ZH', 'north holland': 'NL-NH', 'north brabant': 'NL-NB',
  // 印度：旧名/拼写/缩写（数据集 Odisha/Delhi/Andaman and Nicobar Islands；Ladakh 数据集暂无，跳过不臆造）
  'nct delhi': 'IN-DL', 'new delhi': 'IN-DL', orissa: 'IN-OR', bombay: 'IN-MH',
  maharastra: 'IN-MH', 'west benga': 'IN-WB',
  'andaman and nicobar': 'IN-AN', 'andaman nicobar': 'IN-AN',
  // ── 2026-10-23 扩国（074 P1-4 第 1 批·亚洲）：只收"有量且语义明确"的变体；
  //    政治敏感的写法（Kashmir / Golan / West Bank / Northern Areas 之外的争议区）一律**不映射**，宁缺勿错（铁律 6）。
  // 孟加拉：GBIF 用 "Dhaka bibhag"（bibhag=division，已进 SUFFIX 自动处理）；下面是英文/拼写变体
  chattogram: 'BD-B', 'chittagong hill tracts': 'BD-B', barishal: 'BD-A', mymensingh: 'BD-C', rajshani: 'BD-E',
  // 以色列：GBIF 用希伯来语转写（HaDarom/HaZafon/HaMerkaz），数据集用英文 District 名
  hadarom: 'IL-D', 'south district': 'IL-D', 'southern dist': 'IL-D', 'yughnyy okrug izrailya': 'IL-D',
  hazafon: 'IL-Z', 'north district': 'IL-Z', 'northern dist': 'IL-Z', cafon: 'IL-Z',
  hamerkaz: 'IL-M', 'center district': 'IL-M', 'central dist': 'IL-M',
  yerushalayim: 'IL-JM', 'jerusalem dist': 'IL-JM', hefa: 'IL-HA', 'haifa dist': 'IL-HA',
  // 沙特：GBIF 用简称（Makkah/Jizan/Al Madinah/Eastern Region），数据集用全称（Makkah al Mukarramah…）
  makkah: 'SA-02', mecca: 'SA-02', 'makkah region': 'SA-02', 'mecca region': 'SA-02', "makkah div n": 'SA-02',
  jizan: 'SA-09', 'al madinah': 'SA-03', 'al madinah region': 'SA-03',
  'eastern region': 'SA-04', 'eastern province': 'SA-04', eastern: 'SA-04', 'ash sharquiyah': 'SA-04',
  'riyadh region': 'SA-01', riyadh: 'SA-01', 'ar riyadh': 'SA-01', 'al quassim': 'SA-05', 'hayel region': 'SA-06',
  // 巴基斯坦：GBIF 大量用旧名（Sind/North-West Frontier/Baluchistan/F.C.T./N.W.F.P./Northern Areas/F.A.T.A.）
  sind: 'PK-SD', 'sind province': 'PK-SD', 'hyderabad district': 'PK-SD',
  'north west frontier': 'PK-KP', 'north west frontier province': 'PK-KP', 'n w f p': 'PK-KP', 'hazara district': 'PK-KP',
  baluchistan: 'PK-BA', 'baluchistan province': 'PK-BA',
  'f c t': 'PK-IS', 'capital territory islamabad': 'PK-IS',
  'northern areas': 'PK-GB', 'northern region': 'PK-GB', 'f a t a': 'PK-TA',
  punyab: 'PK-PB', 'west punjab province': 'PK-PB', 'dera ghazi khan': 'PK-PB', rawalpindi: 'PK-PB',
  // 哈萨克斯坦：**不能**把 oblysy/oblast 加进 SUFFIX（会把 "Almaty oblysy" 撞成 "Almaty" 市）→ 逐名映射；
  //   西里尔写法（Кызылординская обл.）canon 后为空，保持未映射（约占 1%）
  qaraghandy: 'KZ-KAR', karaganda: 'KZ-KAR', karagandinskaya: 'KZ-KAR',
  aqmola: 'KZ-AKM', akmola: 'KZ-AKM', aktyubinskaya: 'KZ-AKT', aktobe: 'KZ-AKT',
  'south kazakhstan': 'KZ-YUZ', 'yuzhno kazahstanskaya': 'KZ-YUZ', 'yuzhno kazakhstanskaya': 'KZ-YUZ',
  'east kazakhstan': 'KZ-VOS', 'vostochno kazahstanskaya': 'KZ-VOS',
  'north kazakhstan': 'KZ-SEV', 'severokazahstanskaya': 'KZ-SEV',
  'west kazakhstan': 'KZ-ZAP', 'zapadno kazahstanskaya': 'KZ-ZAP',
  mangghystau: 'KZ-MAN', mangistauskaya: 'KZ-MAN', pavlodarskaya: 'KZ-PAV', almatinskaya: 'KZ-ALM',
  kyzylorda: 'KZ-KZY', kyzylordinskaya: 'KZ-KZY', kostanay: 'KZ-KUS', kostanayskaya: 'KZ-KUS',
  atyrau: 'KZ-ATY', atyrauskaya: 'KZ-ATY', zhambyl: 'KZ-ZHA', zhambylskaya: 'KZ-ZHA',
  astana: 'KZ-AST', 'nur sultan': 'KZ-AST',
  // 柬埔寨：GBIF 用法式转写（Siemréab/Phnum Pénh/Kândal），数据集用 ISO 罗马化（Siem Reab/Phnom Penh/Kandaal）
  siemreab: 'KH-17', 'siem reap': 'KH-17', 'phnum penh': 'KH-12', batdambang: 'KH-02', kandal: 'KH-08',
  'banteay meanchey': 'KH-01', 'kampong sp': 'KH-05', 'kampong spoe': 'KH-05', 'kampong speu': 'KH-05',
  'kampong cham': 'KH-03', 'krong keb': 'KH-23', kep: 'KH-23', takev: 'KH-21', rotanokiri: 'KH-16',
  'prey veng': 'KH-14', 'otdar meanchey': 'KH-22', 'svay rieng': 'KH-20', pouthisat: 'KH-15', kratie: 'KH-10',
  'stung treng': 'KH-19', 'stng treng': 'KH-19', 'st ng treng': 'KH-19', 'kampong thom': 'KH-06',
  'koh kong': 'KH-09', 'preah sihanouk': 'KH-18', mondulkiri: 'KH-11', pailin: 'KH-24',
  // 缅甸：GBIF 用旧名/异拼（Ayeyarwady/Tanintharyi/Pegu/Rangoon/Arakan/Naypyitaw）
  ayeyarwady: 'MM-07', ayeyarwadi: 'MM-07', tanintharyi: 'MM-05', tenasserim: 'MM-05', pegu: 'MM-02',
  rangoon: 'MM-06', arakan: 'MM-16', rakhaine: 'MM-16', naypyitaw: 'MM-18', 'chin hills': 'MM-14',
  'shan states': 'MM-17', 's shan states': 'MM-17', 'n shan states': 'MM-17', bhamo: 'MM-11',
  'lower chindwin': 'MM-01', 'lower pegu': 'MM-02', 'low pegu': 'MM-02',
}

/** 英国的 ISO 一级区就是 4 个构成国；把「Scotland - 某郡」「England - 某郡」归属回去 */
const GB_CONSTITUENT = { england: 'GB-ENG', scotland: 'GB-SCT', wales: 'GB-WLS', 'northern ireland': 'GB-NIR' }

/** 预计算索引：{ [CC]: { byKey: Map<key, code>, divisions: [{ code, name }] } } */
export function buildIndex(dataset, countryCodes = null) {
  const want = countryCodes ? new Set(countryCodes) : null
  const index = {}
  for (const [cc, divisions] of Object.entries(dataset || {})) {
    if (want && !want.has(cc)) continue
    const byKey = new Map()
    const list = []
    for (const [code, name] of Object.entries(divisions || {})) {
      list.push({ code, name })
      for (const k of nameKeys(name)) if (!byKey.has(k)) byKey.set(k, code)
    }
    // 「省/县 → 一级区划」映射的 value 必须是该区划数据集里真实存在的 code；
    // 数据集过时（如 NP 旧 5 大区）/拼错 → 构建期硬失败，不让错码进产物。
    const toL1 = PROVINCE_TO_L1[cc]
    if (toL1) {
      const codes = new Set(list.map((d) => d.code))
      const bad = [...new Set(Object.values(toL1).filter((c) => !codes.has(c)))]
      if (bad.length) throw new Error(`province-to-region[${cc}] 指向不存在的区划码: ${bad.join(', ')}（区划数据集过时或映射拼错）`)
    }
    index[cc] = { byKey, divisions: list }
  }
  return index
}

/**
 * ISO 名 → 展示名：取首个语言变体；有方括号别名时优先别名（数据集把常用拼写放方括号），
 * 否则去圆括号注。例："Tōkyō [Tokyo]"→"Tokyo"、"Xizang\n(Tibet)"→"Xizang"。
 */
export function displayName(name) {
  const first = String(name || '')
    .split(/[\n!]/)[0]
    .trim()
  const bracket = first.match(/\[([^\]]*)\]/)
  return (bracket ? bracket[1] : first.replace(/\([^)]*\)/g, ' ')).trim() || String(name || '')
}

/** GBIF stateProvince 自由文本 → ISO code（找不到返回 null，绝不臆造） */
export function matchSubdivision(index, country, rawName) {
  const entry = index[country]
  if (!entry) return null
  // 「省/县 → 一级区划」二次映射（081 §6.1）：GBIF 写省级、ISO 一级是大区/省的国家（PH/NP/LK）
  const toL1 = PROVINCE_TO_L1[country]
  for (const k of nameKeys(rawName)) {
    const alias = NAME_ALIASES[k]
    if (alias && alias.startsWith(country + '-')) return alias
    if (entry.byKey.has(k)) return entry.byKey.get(k)
    // 兜底：直接命中失败后再查省→区映射（保证 "Quezon City"→PH-00 这类保护键先于裸名生效）
    if (toL1 && toL1[k]) return toL1[k]
  }
  // 英国：郡级文本归入所属构成国（ISO 一级区）
  if (country === 'GB') {
    const c = canonName(rawName)
    for (const [name, code] of Object.entries(GB_CONSTITUENT)) {
      if (c === name || c.startsWith(name + ' ')) return code
    }
  }
  return null
}
