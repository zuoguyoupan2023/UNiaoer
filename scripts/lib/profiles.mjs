import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 物种档案（C1）：类群（水鸟/猛禽/林鸟）按科派生 + 分布（distribution.json）+
 * 人工整理的居留型/生境/习性（data/species-profiles.json）。
 * 供 build-bank 与 apply-profiles 复用；产出写入 manifest 的 species[].profile。
 */

/** 水鸟类群：游禽 + 涉禽（按 manifest 的中文科名归档） */
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

/** 猛禽类群 */
const RAPTOR_FAMILIES = new Set(['鹰科', '隼科', '鸱鸮科', '草鸮科', '美洲鹫科', '鹗科'])

/** 科名 → 类群 key；其余归林鸟（含攀禽/陆禽等陆生鸟类） */
export function groupOfFamily(family) {
  if (WATERBIRD_FAMILIES.has(family)) return 'waterbird'
  if (RAPTOR_FAMILIES.has(family)) return 'raptor'
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
  const group = curated.group || groupOfFamily(sp.family)
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
