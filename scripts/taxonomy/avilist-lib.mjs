/**
 * 023 P0:AviList XLSX 纯解析函数(不碰网络/文件系统,可单测)。
 * xlsx = zip(xl/sharedStrings.xml + xl/worksheets/sheetN.xml);zip 读取复用 gbif-sql-lib 的 readZipEntry。
 * AviList v2025b:CC BY 4.0;AviList Core Team 2026, https://doi.org/10.2173/avilist.v2025b
 */
import { readZipEntry } from '../region/gbif-sql-lib.mjs'

/** 解析 sharedStrings.xml → 字符串数组(<si> 可含富文本多段 <r><t> 与 XML 实体)。 */
export function parseSharedStrings(xml) {
  return [...String(xml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml(m[1].replace(/<[^>]+>/g, '')))
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 列字母 → 0 基列号(A→0, Z→25, AA→26)。 */
export function columnIndex(letters) {
  let n = 0
  for (const ch of String(letters || '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** sheet XML → 按列号展开的行数组(稀疏单元格留 undefined;t=s 查 sharedStrings,t=inlineStr 取内联)。 */
export function parseSheetRows(xml, strings = []) {
  const rows = []
  for (const m of String(xml || '').matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const c of m[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] || ''
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1]
      if (!ref) continue
      const type = attrs.match(/t="(\w+)"/)?.[1]
      const body = c[2] || ''
      let v = ''
      if (type === 's') {
        const idx = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        v = idx == null ? '' : (strings[Number(idx)] ?? '')
      } else if (type === 'inlineStr') {
        v = decodeXml(body.replace(/<[^>]+>/g, ''))
      } else {
        v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
      }
      cells[columnIndex(ref)] = v
    }
    rows.push(cells)
  }
  return rows
}

/** xlsx Buffer → 结构化 rows(取第一个 sheet)。 */
export function parseAvilistXlsx(buf) {
  const strings = parseSharedStrings(readZipEntry(buf, { name: 'xl/sharedStrings.xml' }).data.toString('utf8'))
  const sheet = readZipEntry(buf, { name: 'xl/worksheets/sheet1.xml' }).data.toString('utf8')
  return parseSheetRows(sheet, strings)
}

const RANKS = new Set(['order', 'family', 'genus', 'species', 'subspecies'])
const cell = (cells, i) => String(i >= 0 && i < cells.length ? cells[i] || '' : '').trim()

/**
 * AviList 行数组 → { orders, families, genera, species, subspecies }。
 * 第 1 行是机器表头;第 2 行是给阅读者的展示名(大写,rank 不在枚举内)自动跳过。
 * 学名缺 AvibaseID 的行直接抛错(骨架主键不允许空)。
 */
export function taxaFromRows(rows) {
  if (!rows.length) throw new Error('avilist: 空表(无表头)')
  const header = rows[0].map((h) => String(h || '').trim())
  const col = (name) => header.indexOf(name)
  for (const k of ['Taxon_rank', 'Order', 'Family', 'Scientific_name', 'AvibaseID']) {
    if (col(k) < 0) throw new Error(`avilist: 缺少必需列 ${k}`)
  }
  const c = {
    sequence: col('Sequence'),
    rank: col('Taxon_rank'),
    order: col('Order'),
    family: col('Family'),
    familyEn: col('Family_English_name'),
    sci: col('Scientific_name'),
    authority: col('Authority'),
    enAvi: col('English_name_AviList'),
    enClem: col('English_name_Clements_v2025'),
    enBl: col('English_name_BirdLife_v10'),
    range: col('Range'),
    extinct: col('Extinct_or_possibly_extinct'),
    iucn: col('IUCN_Red_List_Category'),
    ebird: col('Species_code_Cornell_Lab'),
    avibase: col('AvibaseID'),
  }
  const out = { orders: [], families: [], genera: [], species: [], subspecies: [] }
  for (const cells of rows.slice(1)) {
    const rank = cell(cells, c.rank).toLowerCase()
    if (!RANKS.has(rank)) continue
    const sci = cell(cells, c.sci)
    if (!sci) throw new Error(`avilist: rank=${rank} 行缺学名`)
    const base = { sequence: Number(cell(cells, c.sequence)) || null, rank, nameSci: sci }
    if (rank === 'order') {
      out.orders.push(base)
    } else if (rank === 'family') {
      out.families.push({ ...base, order: cell(cells, c.order), familyEn: cell(cells, c.familyEn) })
    } else if (rank === 'genus') {
      out.genera.push({ ...base, family: cell(cells, c.family) })
    } else {
      const avibaseId = cell(cells, c.avibase)
      if (!avibaseId) throw new Error(`avilist: ${sci} 缺 AvibaseID(骨架主键不允许空)`)
      const entry = {
        ...base,
        order: cell(cells, c.order),
        family: cell(cells, c.family),
        familyEn: cell(cells, c.familyEn),
        authority: cell(cells, c.authority),
        nameEn: cell(cells, c.enAvi),
        nameEnClements: cell(cells, c.enClem),
        nameEnBirdLife: cell(cells, c.enBl),
        extinct: cell(cells, c.extinct) || null,
        iucn: cell(cells, c.iucn) || null,
        ebirdCode: cell(cells, c.ebird) || null,
        avibaseId,
      }
      if (rank === 'species') out.species.push(entry)
      else out.subspecies.push(entry)
    }
  }
  return out
}

/** 学名归一化(匹配键):去括号注记、压空白、小写。 */
export function normalizeSciName(s) {
  return String(s || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 学名别名表(仅当现有学名在 AviList v2025b 无同名物种行时启用)。
 * 依据:AviList v2025b 对这些概念采取「并入父种」的处置(跟随 HBW/BirdLife;eBird/Clements 为拆分侧)。
 * 键=本项目现有学名(manifest/taxa.json),值=AviList 物种学名。逐条可核对:AviList xlsx 内 Decision summary + 亚种行。
 * 例:Saxicola maurus stejnegeri 亚种行 avibase-80216E85 → 归于物种 avibase-3380CFC5。
 */
export const SCI_ALIASES = {
  'saxicola stejnegeri': 'Saxicola maurus', // Stejneger's Stonechat → Siberian Stonechat(ssp. stejnegeri)
  'pericrocotus speciosus': 'Pericrocotus flammeus', // Scarlet Minivet(HBW 口径)
  'porphyrio poliocephalus': 'Porphyrio porphyrio', // Grey-headed Swamphen → Purple Swamphen(s.l.)
  'porphyrio melanotus': 'Porphyrio porphyrio', // Australasian Swamphen → Purple Swamphen(s.l.)
  'corvus cornix': 'Corvus corone', // Hooded Crow → Carrion Crow(s.l., ssp. cornix)
  'icterus bullockii': 'Icterus galbula', // Bullock's Oriole → Baltimore Oriole(s.l., Northern Oriole 旧合并口径)
  'vireo swainsoni': 'Vireo gilvus', // Swainson's Vireo → Warbling Vireo(s.l., ssp. swainsoni)
}

/** species 列表 → 归一化学名索引(同键首个优先)。另附 subspecies 三名 → 父种学名的旁索引。 */
export function buildNameIndex(taxa) {
  const byName = new Map()
  for (const t of taxa.species || []) {
    const k = normalizeSciName(t.nameSci)
    if (k && !byName.has(k)) byName.set(k, t)
  }
  const subspeciesParent = new Map()
  for (const t of taxa.subspecies || []) {
    const parent = normalizeSciName(t.nameSci.split(/\s+/).slice(0, 2).join(' '))
    if (parent && !subspeciesParent.has(normalizeSciName(t.nameSci))) subspeciesParent.set(normalizeSciName(t.nameSci), parent)
  }
  return { byName, subspeciesParent }
}

/**
 * manifest 物种 → AviList 匹配。
 * 依次尝试:物种行 → SCI_ALIASES(并入父种概念,via: 'alias')→ 亚种行取父种(via: 'subspecies');都没有 → miss。
 */
export function matchSpecies(manifestSpecies, nameIndex) {
  const matches = []
  const misses = []
  for (const s of manifestSpecies || []) {
    const key = normalizeSciName(s.nameSci)
    const hit = nameIndex.byName.get(key)
    if (hit) {
      matches.push({ id: s.id, nameSci: s.nameSci, taxonKey: hit.avibaseId, via: 'species' })
      continue
    }
    const aliasTarget = SCI_ALIASES[key]
    const aliasHit = aliasTarget && nameIndex.byName.get(normalizeSciName(aliasTarget))
    if (aliasHit) {
      matches.push({ id: s.id, nameSci: s.nameSci, taxonKey: aliasHit.avibaseId, via: 'alias' })
      continue
    }
    const parent = nameIndex.subspeciesParent.get(key)
    const parentHit = parent && nameIndex.byName.get(parent)
    if (parentHit) {
      matches.push({ id: s.id, nameSci: s.nameSci, taxonKey: parentHit.avibaseId, via: 'subspecies' })
      continue
    }
    misses.push({ id: s.id, nameSci: s.nameSci })
  }
  return { matches, misses }
}
