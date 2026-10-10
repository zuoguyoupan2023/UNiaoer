import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 物种档案（C1）：类群（水鸟/猛禽/林鸟）按科派生 + 分布（distribution.json）+
 * 人工整理的居留型/生境/习性（data/species-profiles.json）。
 * 供 build-bank 与 apply-profiles 复用；产出写入 manifest 的 species[].profile。
 */

/**
 * 类群（group）派生。
 *
 * 050 P0 修 bug：原实现只认**中文科名**，而全球层的 `family` 是 AviList 的**英文科名**
 * （`Cettiidae`/`Accipitridae`…）→ 10,844 条里除核心库外**全部落到兜底 `landbird`**，
 * 连鸥科、鹭科、鹰科的全球种都被标成"林鸟"（实测 global.min 的 9545 种 group 100% 为 landbird）。
 *
 * 修法：**优先按目（Order）派生**——目名是 AviList 的英文标准名，在中英文两种来源下都稳定，
 * 且 `species-index.json` 每种都带 `order`；科名派生保留为兜底（兼容无 order 的老数据）。
 */

/** 涉禽/水鸟相关目（AviList 英文目名；判据 = 「主要营水生环境」） */
const WATERBIRD_ORDERS = new Set([
  'Charadriiformes', // 鸻形目（鹬、鸻、燕鸻…）
  'Gruiformes', // 鹤形目
  'Pelecaniformes', // 鹈形目（鹈鹕、鹱、鹺鹈、鲣鸟…）
  'Suliformes', // 鲣鸟目
  'Procellariiformes', // 鹱形目
  'Ciconiiformes', // 鹳形目（鹳、鹭、鹮…）
  'Phoenicopteriformes', // 红鹳目
  'Podicipediformes', // 鸊鷉目
  'Gaviiformes', // 潜鸟目
  'Sphenisciformes', // 企鹅目
  'Coliiformes', //  coliiformes
  'Pterocliformes', // 沙鸡目
  'Tinamiformes', // 䴙䴘目
  'Eurypygiformes', // 鹤鸵目（部分水栖）
])

/** 猛禽相关目（鹰、隼、鸮、鹫） */
const RAPTOR_ORDERS = new Set([
  'Accipitriformes',
  'Falconiformes',
  'Strigiformes',
  'Cathartiformes',
  'Sagittariiformes',
])

/** 水鸟类群：游禽 + 涉禽（按 manifest 的中文科名归档；旧数据兜底） */
const WATERBIRD_FAMILIES = new Set([
  // 游禽
  '鸭科',
  '䴙䴘科',
  '潜鸟科',
  '鸬鹚科',
  '鹈鹕科',
  '蛇鹈科',
  '鲣鸟科',
  '军舰鸟科',
  '鹱科',
  '海雀科',
  '企鹅科',
  '贼鸥科',
  '鸥科',
  '翠鸟科',
  '河乌科',
  // 涉禽
  '鹬科',
  '鸻科',
  '秧鸡科',
  '鹭科',
  '鹮科',
  '鹳科',
  '鹤科',
  '反嘴鹬科',
  '蛎鹬科',
  '水雉科',
  '彩鹬科',
  '石鸻科',
  '燕鸻科',
  '红鹳科',
  '秧鹤科',
  '锤头鹳科',
])

/** 猛禽类群（中文科名；旧数据兜底） */
const RAPTOR_FAMILIES = new Set(['鹰科', '隼科', '鸱鸮科', '草鸮科', '美洲鹫科', '鹗科'])

/**
 * 科名 → 类群 key（**仅作兜底**）。
 * 050 P0 起优先用 `groupOfOrder`；这里同时收中英文科名，
 * 以便仍然只有科名的历史数据也能判对。
 */
export function groupOfFamily(family) {
  if (WATERBIRD_FAMILIES.has(family) || WATERBIRD_ORDERS.has(family)) return 'waterbird'
  if (RAPTOR_FAMILIES.has(family) || RAPTOR_ORDERS.has(family)) return 'raptor'
  return 'landbird'
}

/**
 * 目名 → 类群 key（**首选**）。目名为 AviList 英文标准名，中英文数据源都一致。
 * 未知目 → null（交由调用方回退到科名派生，避免未知目被误判成"林鸟"）。
 */
export function groupOfOrder(order) {
  if (!order) return null
  if (WATERBIRD_ORDERS.has(order)) return 'waterbird'
  if (RAPTOR_ORDERS.has(order)) return 'raptor'
  return 'landbird'
}

/** 读取 data/distribution.json，返回 { [taxonId]: entry }；文件缺失返回 {} */
export async function loadDistribution(root) {
  try {
    const d = JSON.parse(await fs.readFile(path.join(root, 'data/distribution.json'), 'utf8'))
    return d.species || {}
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
}

/** 读取人工档案 data/species-profiles.json → { [speciesId]: {...} } */
export async function loadSpeciesProfiles(root) {
  try {
    const d = JSON.parse(await fs.readFile(path.join(root, 'data/species-profiles.json'), 'utf8'))
    return (d && d.profiles) || {}
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
}

/** ISO 国家码列表（原始分布条目） */
export function countriesOf(entry) {
  return Array.isArray(entry?.countries) ? entry.countries : []
}

/**
 * 分布条目 → manifest 里的精简分布字段（只留数量与 IUCN 摘要；
 * 国家码列表另存 public/data/distribution.json，避免 manifest 膨胀）。
 */
function distributionOf(entry) {
  const countries = countriesOf(entry)
  if (!countries.length) return undefined
  return {
    count: countries.length,
    category: entry?.iucn?.category || undefined,
    source: entry?.distributionSource || undefined,
    url: entry?.iucn?.url || undefined,
  }
}

/**
 * 为单个物种派生 profile（就地原则由调用方决定）：
 * 类群 = 人工覆盖 ?? 科派生；居留型/生境/习性 = 人工整理（稀疏）；
 * 分布 = distribution.json（按 taxonId 关联）。无任何字段返回 undefined。
 */
export function deriveProfile(sp, distEntry, curated = {}) {
  const profile = {}
  // 050 P0：目名优先（全球层的 family 是英文科名，科名派生会全部兜底成 landbird）
  const group = curated.group || groupOfOrder(sp.order) || groupOfFamily(sp.family)
  if (group) profile.group = group
  if (curated.migration) profile.migration = curated.migration
  const habitatZh = curated.habitatZh || curated.habitatEn
  const habitatEn = curated.habitatEn || curated.habitatZh
  if (habitatZh) profile.habitatZh = habitatZh
  if (habitatEn) profile.habitatEn = habitatEn
  const habitZh = curated.habitZh || curated.habitEn
  const habitEn = curated.habitEn || curated.habitZh
  if (habitZh) profile.habitZh = habitZh
  if (habitEn) profile.habitEn = habitEn
  const dist = distributionOf(distEntry)
  if (dist) profile.distribution = dist
  return Object.keys(profile).length ? profile : undefined
}

/** 把 profile 并入物种记录（就地）；返回应用条数 */
export function applyProfiles(species, distByTaxon, curated) {
  let applied = 0
  for (const sp of species) {
    const p = deriveProfile(sp, distByTaxon[String(sp.taxonId)], curated[sp.id])
    if (p) {
      sp.profile = p
      applied++
    } else {
      delete sp.profile
    }
  }
  return applied
}

/** species id → 国家码列表（写入 public/data/distribution.json，按需加载） */
export function buildCountryIndex(species, distByTaxon) {
  const bySpecies = {}
  for (const sp of species) {
    const list = countriesOf(distByTaxon[String(sp.taxonId)])
    if (list.length) bySpecies[sp.id] = list
  }
  return bySpecies
}

/** curated 里出现、但 species 列表中没有的 id（多为拼写错误） */
export function unmatchedProfileIds(species, curated) {
  const ids = new Set(species.map((s) => s.id))
  return Object.keys(curated).filter((id) => !ids.has(id))
}
