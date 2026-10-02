/**
 * 021 §2.2 ISO 3166-2 adapter（纯函数，可单测）。
 * 用途：把 GBIF `stateProvince` 自由文本映射到稳定的 ISO 3166-2 code
 * （用户决定 2026-10-02：M2 先用 ISO 3166-2 作规范基准，eBird subnational1 后补）。
 *
 * 数据集：alexander-schranz/iso-3166-2（MIT），每国 `<cc>.json` = { 'US-CA': 'California', ... }
 * 名称含多语言变体，以换行 `\n` 或 `!` 分隔，括号/方括号为别名，已在本模块统一展开。
 */

/** 归一化：去变音符、小写、非字母数字折叠为空格 */
export function canonName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const SUFFIX = /\b(state|province|prefecture|territory|region|county|district|city|of|the)\b/g

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

/**
 * 自由文本别名 → ISO code（仅收已知高频变体；不臆造）。
 * key 为 canonName 结果；日本按 GBIF 常用赫本式补 ISO 训令式拼写之缺。
 */
export const NAME_ALIASES = {
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
  for (const k of nameKeys(rawName)) {
    const alias = NAME_ALIASES[k]
    if (alias && alias.startsWith(country + '-')) return alias
    if (entry.byKey.has(k)) return entry.byKey.get(k)
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
