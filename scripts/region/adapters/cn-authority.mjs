/**
 * 021 M3：郑光美体系开放数据集 adapter（《中国鸟类的生活史和生态学特征数据集》，
 * 《生物多样性》2021，DOI 10.17520/biods.2021201，1445 种）。
 *
 * 该数据集【没有】省级列表（分布列为动物地理亚区 + 省份数），可用的是
 * 「迁徙状态」列（R/S/W/P/V，全量权威居留型）→ seasonality 的 L1 定性层。
 *
 * 数据文件（gitignore，手工获取一次）：
 *   curl -A "Mozilla/5.0" -e "https://www.biodiversity-science.net/CN/10.17520/biods.2021201" \
 *     -o data-cache/region/cn-authority/dataset.zip \
 *     "https://www.biodiversity-science.net/fileup/1005-0094/DATA/2021201.zip"
 *   解压得 dataset/Chinesebirdsdata.xlsx
 */

const MIGRATION_CODES = { R: 'resident', S: 'summer', W: 'winter', P: 'passage', V: 'vagrant' }

/** xlsx 内部 XML 里的共享字符串表 → string[]（纯函数，可单测） */
export function parseSharedStrings(xml) {
  const strings = []
  for (const m of String(xml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push(
      [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)]
        .map((x) => x[1])
        .join(''),
    )
  }
  return strings
}

/** sheet XML → 行数组（每行 { 列字母: 值 }；shared 字符串已解析，纯函数可单测） */
export function parseSheet(xml, strings) {
  const rows = []
  for (const rm of String(xml || '').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {}
    for (const c of rm[1].matchAll(
      /<c r="([A-Z]+)\d+"[^>]*?>([\s\S]*?)<\/c>/g,
    )) {
      const col = c[1]
      const body = c[2]
      const t = /t="(inlineStr|s)"/.exec(c[0])?.[1]
      let v = ''
      if (t === 'inlineStr') {
        v = [...body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('')
      } else {
        const num = /<v>([^<]*)<\/v>/.exec(body)?.[1]
        v = num === undefined ? '' : t === 's' ? (strings[Number(num)] ?? '') : num
      }
      if (v !== '') row[col] = v
    }
    if (Object.keys(row).length) rows.push(row)
  }
  return rows
}

/**
 * 数据集行 → { bySci, unknown }。学名精确两词（canon 小写键），迁徙状态多值拆分；
 * 未收录的状态码丢弃并计数（不臆造）。
 */
export function extractBirds(rows) {
  const bySci = {}
  const unknown = new Map()
  let sciCol = null
  let migCol = null
  for (const row of rows) {
    if (sciCol === null) {
      const header = Object.entries(row).find(([, v]) => v === '种拉丁名')
      if (!header) continue
      sciCol = header[0]
      migCol = Object.entries(row).find(([, v]) => v.startsWith('迁徙状态'))?.[0] ?? null
      continue
    }
    const sci = String(row[sciCol] || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    if (!sci || !sci.includes(' ')) continue
    const raw = migCol ? String(row[migCol] || '') : ''
    const range = []
    // 数据集多状态为无分隔连写（如 "RSWP"=留+夏+旅+冬），状态码均为单字母 → 逐字符解析
    for (const ch of raw.toUpperCase()) {
      const code = MIGRATION_CODES[ch]
      if (code) range.push(code)
      else if (/[A-Z]/.test(ch)) unknown.set(ch, (unknown.get(ch) || 0) + 1)
    }
    if (range.length) bySci[sci] = { range: [...new Set(range)] }
  }
  return { bySci, unknown: [...unknown.entries()].map(([k, n]) => ({ code: k, n })) }
}
