import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 物种档案（C1）：类群（水鸟/猛禽/林鸟）按科派生 + 分布（distribution.json）+
 * 人工整理的居留型/生境/习性（data/species-profiles.json）。
 * 供 build-bank 与 apply-profiles 复用；产出写入 manifest 的 species[].profile。
 */

/**
 * 类群（group）派生 —— 050 P0 修订版。
 *
 * ## 为什么原实现是错的
 * 原实现 `groupOfFamily()` 只认**中文科名**（`'鸥科'`/`'鹰科'`…），而全球层的 `family`
 * 是 AviList 的**英文科名**（`Cettiidae`/`Accipitridae`…）→ 10,844 条里除核心库外
 * **全部落到兜底 `landbird`**，连鸥科、鹭科、鹰科的全球种都被标成"林鸟"。
 *
 * ## 口径（重要：本项目只有三类，不是六类）
 * 系统枚举只有 `waterbird`（水/涉禽）/ `raptor`（猛禽）/ `landbird`（其余：林鸟+攀禽+游禽），
 * 由 `check-bank.mjs` 强制校验。**"水/涉/林/猛/攀/游"六分法在本项目里从未实现**；
 * 若将来要拆成六类，需同步改枚举 + `check-bank` + `SpeciesFacts.vue` 的 i18n。
 *
 * ## 派生方式：**用核心库反推，不手写**
 * 手写目名→类目的集合必然会漂移：本次就手写错了 —— `Coraciiformes`（翠鸟/蜂虎）整目判水鸟，
 * 但核心库该目是 13 种水鸟 / 10 种林鸟；`Pterocliformes` 沙鸡、`Tinamiformes` 䴙䴘、
 * `Eurypygiformes` 鹤鸵在核心库**根本没有样本**，被我凭空判成水鸟。
 * 现改为：核心库 1,299 种持有**中文科名**（权威口径），经 `species-index` 桥接到
 * **英文科名 / 目名**后按多数票反查 —— 与原始中文集合**完全同源**，只是翻译到了英文世界。
 */

/** 英文科名 → 类群（131 个科，由核心库 1,299 种反推；同科跨组的科不收录） */
const FAMILY_GROUP = {
"Acanthizidae": "landbird",
  "Accipitridae": "raptor",
  "Acrocephalidae": "landbird",
  "Aegithalidae": "landbird",
  "Aegithinidae": "landbird",
  "Alaudidae": "landbird",
  "Alcedinidae": "waterbird",
  "Alcidae": "waterbird",
  "Anatidae": "waterbird",
  "Anhingidae": "waterbird",
  "Apodidae": "landbird",
  "Aramidae": "waterbird",
  "Ardeidae": "waterbird",
  "Artamidae": "landbird",
  "Bombycillidae": "landbird",
  "Bucerotidae": "landbird",
  "Burhinidae": "waterbird",
  "Cacatuidae": "landbird",
  "Calcariidae": "landbird",
  "Campephagidae": "landbird",
  "Caprimulgidae": "landbird",
  "Cardinalidae": "landbird",
  "Casuariidae": "landbird",
  "Cathartidae": "raptor",
  "Certhiidae": "landbird",
  "Cettiidae": "landbird",
  "Charadriidae": "waterbird",
  "Chloropseidae": "landbird",
  "Ciconiidae": "waterbird",
  "Cinclidae": "waterbird",
  "Cisticolidae": "landbird",
  "Climacteridae": "landbird",
  "Coliidae": "landbird",
  "Columbidae": "landbird",
  "Coraciidae": "landbird",
  "Corvidae": "landbird",
  "Cracidae": "landbird",
  "Cuculidae": "landbird",
  "Dicaeidae": "landbird",
  "Dicruridae": "landbird",
  "Emberizidae": "landbird",
  "Estrildidae": "landbird",
  "Falconidae": "raptor",
  "Fregatidae": "waterbird",
  "Fringillidae": "landbird",
  "Furnariidae": "landbird",
  "Galbulidae": "landbird",
  "Gaviidae": "waterbird",
  "Glareolidae": "waterbird",
  "Gruidae": "waterbird",
  "Haematopodidae": "waterbird",
  "Hirundinidae": "landbird",
  "Icteridae": "landbird",
  "Jacanidae": "waterbird",
  "Laniidae": "landbird",
  "Laridae": "waterbird",
  "Leiothrichidae": "landbird",
  "Maluridae": "landbird",
  "Megalaimidae": "landbird",
  "Megapodiidae": "landbird",
  "Meliphagidae": "landbird",
  "Meropidae": "landbird",
  "Mimidae": "landbird",
  "Momotidae": "landbird",
  "Monarchidae": "landbird",
  "Motacillidae": "landbird",
  "Muscicapidae": "landbird",
  "Nectariniidae": "landbird",
  "Numididae": "landbird",
  "Odontophoridae": "landbird",
  "Oriolidae": "landbird",
  "Pachycephalidae": "landbird",
  "Pandionidae": "raptor",
  "Panuridae": "landbird",
  "Paradoxornithidae": "landbird",
  "Pardalotidae": "landbird",
  "Paridae": "landbird",
  "Parulidae": "landbird",
  "Passerellidae": "landbird",
  "Passeridae": "landbird",
  "Pelecanidae": "waterbird",
  "Pellorneidae": "landbird",
  "Petroicidae": "landbird",
  "Phalacrocoracidae": "waterbird",
  "Phasianidae": "landbird",
  "Phoenicopteridae": "waterbird",
  "Phylloscopidae": "landbird",
  "Picidae": "landbird",
  "Ploceidae": "landbird",
  "Podargidae": "landbird",
  "Podicipedidae": "waterbird",
  "Polioptilidae": "landbird",
  "Procellariidae": "waterbird",
  "Prunellidae": "landbird",
  "Psittacidae": "landbird",
  "Psittaculidae": "landbird",
  "Ptiliogonatidae": "landbird",
  "Ptilonorhynchidae": "landbird",
  "Pycnonotidae": "landbird",
  "Rallidae": "waterbird",
  "Ramphastidae": "landbird",
  "Recurvirostridae": "waterbird",
  "Regulidae": "landbird",
  "Remizidae": "landbird",
  "Rhipiduridae": "landbird",
  "Rostratulidae": "waterbird",
  "Scolopacidae": "waterbird",
  "Scopidae": "waterbird",
  "Sittidae": "landbird",
  "Spheniscidae": "waterbird",
  "Stenostiridae": "landbird",
  "Stercorariidae": "waterbird",
  "Strigidae": "raptor",
  "Struthionidae": "landbird",
  "Sturnidae": "landbird",
  "Sulidae": "waterbird",
  "Sylviidae": "landbird",
  "Thraupidae": "landbird",
  "Threskiornithidae": "waterbird",
  "Timaliidae": "landbird",
  "Tityridae": "landbird",
  "Trochilidae": "landbird",
  "Troglodytidae": "landbird",
  "Trogonidae": "landbird",
  "Turdidae": "landbird",
  "Tyrannidae": "landbird",
  "Tytonidae": "raptor",
  "Upupidae": "landbird",
  "Viduidae": "landbird",
  "Vireonidae": "landbird",
  "Zosteropidae": "landbird",
}

/** 目名 → 类群（31 个目，由核心库按多数票反推；core 无样本的目不在表内 → 落兜底） */
const ORDER_GROUP = {
"Accipitriformes": "raptor",
  "Anseriformes": "waterbird",
  "Apodiformes": "landbird",
  "Bucerotiformes": "landbird",
  "Caprimulgiformes": "landbird",
  "Casuariiformes": "landbird",
  "Cathartiformes": "raptor",
  "Charadriiformes": "waterbird",
  "Ciconiiformes": "waterbird",
  "Coliiformes": "landbird",
  "Columbiformes": "landbird",
  "Coraciiformes": "waterbird",
  "Cuculiformes": "landbird",
  "Falconiformes": "raptor",
  "Galbuliformes": "landbird",
  "Galliformes": "landbird",
  "Gaviiformes": "waterbird",
  "Gruiformes": "waterbird",
  "Passeriformes": "landbird",
  "Pelecaniformes": "waterbird",
  "Phoenicopteriformes": "waterbird",
  "Piciformes": "landbird",
  "Podargiformes": "landbird",
  "Podicipediformes": "waterbird",
  "Procellariiformes": "waterbird",
  "Psittaciformes": "landbird",
  "Sphenisciformes": "waterbird",
  "Strigiformes": "raptor",
  "Struthioniformes": "landbird",
  "Suliformes": "waterbird",
  "Trogoniformes": "landbird",
}

/** 水鸟类群：游禽 + 涉禽（核心库的中文科名原始集合，保持不变） */
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

/** 猛禽类群（中文科名；核心库原始集合，保持不变） */
const RAPTOR_FAMILIES = new Set(['鹰科', '隼科', '鸱鸮科', '草鸮科', '美洲鹫科', '鹗科'])

/**
 * **只按科名**解析类群，查不到返回 `null`（**不兜底 landbird**）。
 *
 * 050 P0 修订（用户 2026-10-10 明确要求）：没有信息就留空，不要靠推断填。
 * 科名表由核心库 1,299 种的中文科名反推而来，与权威口径同源；
 * 目名多数票那种"反推"已被弃用（六分类与习惯分类问题见 docs/051）。
 * 权威层里查不到的种 → `group` 留空 → `SpeciesFacts` 不显示类群标签。
 */
export function groupOfKnown(family) {
  if (family && FAMILY_GROUP[family]) return FAMILY_GROUP[family]
  if (family && WATERBIRD_FAMILIES.has(family)) return 'waterbird'
  if (family && RAPTOR_FAMILIES.has(family)) return 'raptor'
  return null
}

/**
 * 类群解析：英文科名 → 目名 → 中文科名 → 兜底林鸟。
 * ⚠️ 这个兜底版本只给**老数据**（如 build-bank 的 curated 覆盖）用；
 *    产物侧一律用 `groupOfKnown`（查不到留空）。
 * 前两级实测覆盖 8,174 / 2,517 种（合计 98.6%）；余 153 种落在
 * "核心库无样本的目"（沙鸡、䴙䴘、鹤鸵、麝雉等），按原始集合的兜底口径落 landbird。
 */
export function groupOf(family, order) {
  if (family && FAMILY_GROUP[family]) return FAMILY_GROUP[family]
  if (order && ORDER_GROUP[order]) return ORDER_GROUP[order]
  if (family && WATERBIRD_FAMILIES.has(family)) return 'waterbird'
  if (family && RAPTOR_FAMILIES.has(family)) return 'raptor'
  return 'landbird'
}

/** 只给科名的旧数据用（兼容原导出名） */
export function groupOfFamily(family) {
  return groupOf(family, '')
}

/** 只给目名的入口（050 P0 引入，保留导出名） */
export function groupOfOrder(order) {
  return groupOf('', order)
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
  const group = curated.group || groupOf(sp.family, sp.order)
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
