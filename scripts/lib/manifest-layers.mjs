/**
 * 029 M1:manifest 分层拆分 —— 纯函数。
 *
 * 三层产物(029 §2):
 *   1) manifest-core.json —— 启动加载。species[] 只带名录字段 + **首图首音**(答题/选项/预取够用)。
 *   2) assets/<bucket>.json —— 按物种 id 首字母分桶。每物种完整 images[]/audios[](5+5 逐条署名)
 *      + notes + profile;详情/画廊/海报按需懒加载。
 *   3) manifest-global.min.json —— 全球池(≈9.8k 种,1+1 素材),core 同构,懒加载后合并。
 *
 * 分桶规则:物种 id 首字符 a-z → 同名桶;数字/其它 → '0-9'。
 * 桶索引(core.buckets)只列**实际存在**的桶,前端据此拼接 URL。
 */
import { groupOfKnown } from './profiles.mjs'
import { resolveGroup6 } from './class-taxonomy.mjs'


/** 核心条目保留的名录字段(其余如 desc/location/habit 等属详情层)。
 *  notes/profile 体量极小(全库 ~0.2MB)且被 FAQ 列表/结果页档案直接读取(无 loading 态),
 *  故留在 core;真正的大头是 5+5 素材数组(images/audios)→ 三层里的 assets 分片。 */
/** 050 P1：权威名录层的字段白名单（**刻意不含任何媒体键**）。 */
const META_SPECIES_KEYS = [
  'id',
  'nameZh',
  'nameSci',
  'nameEn',
  'family',
  'order',
  'taxonKey',
  'taxonId',
  'commonness',
  'playable',
  'playableImage',
  'playableAudio',
  'quizExcluded',
  'notes',
  'profile',
  'rankWorld',
  'rankCN',
  'inCN',
  'desc',
  'location',
  'habit',
]

const CORE_SPECIES_KEYS = [
  'id',
  'nameZh',
  'nameSci',
  'nameEn',
  'family',
  'taxonKey',
  'taxonId',
  'commonness',
  'playable',
  'playableImage',
  'playableAudio',
  'quizExcluded',
  'notes',
  'profile',
]

/** 素材进 core 时需要保留的字段(答案是首图/首音,答题与预取都只用这些) */
const CORE_ASSET_KEYS = [
  'url',
  'thumbUrl',
  'xlUrl',
  'avifUrl',
  'thumbhash',
  'license',
  'author',
  'source',
  'sourceUrl',
  'sourceId',
  'type',
  'speciesId',
  'transcode',
  'month',
]

/**
 * 大桶自适应拆分(029 M1 DoD:单桶 ≤400KB;S6 起支持**多级**拆分):
 * 桶 JSON 超过 `maxBytes` 时按 id 前缀逐级加长拆分(如 p → pa/pe/… → paa/pab/…),
 * 直到每片 ≤ `maxBytes` 或已拆到单物种(不可再分)。
 * 确定性:同一输入必得同一输出;meta.buckets / core.buckets 列出**最终**桶名,前端据此解析。
 * 前端解析用「最长前缀优先」:同一物种只需在各前缀里命中最长的一个(见 resolveBucket)。
 */
export const BUCKET_SPLIT_THRESHOLD = 400_000

/** 子桶名:id 前两位(小写;非 [a-z][a-z0-9] 时退化为首字母 + '_') */
export function subBucketOf(id) {
  const s = String(id || '').toLowerCase()
  const two = s.slice(0, 2)
  if (/^[a-z][a-z0-9]$/.test(two)) return two
  const one = s.charAt(0)
  return /^[a-z]$/.test(one) ? `${one}_` : '0-9'
}

/** 前缀桶名:id 的前 `len` 个小写字符(len=1 时非字母 → '0-9') */
export function prefixBucketOf(id, len) {
  const s = String(id || '').toLowerCase()
  if (len <= 1) {
    const c = s.charAt(0)
    return /^[a-z]$/.test(c) ? c : '0-9'
  }
  const p = s.slice(0, len)
  return p || '0-9'
}

export function splitLargeBuckets(buckets, maxBytes = BUCKET_SPLIT_THRESHOLD) {
  const out = {}
  const place = (name, entries) => {
    out[name] = entries
  }
  /** @param {Record<string,object>} entries @param {string} fallbackName @param {number} len */
  const recurse = (entries, fallbackName, len) => {
    const ids = Object.keys(entries)
    if (JSON.stringify(entries).length <= maxBytes || ids.length <= 1 || len > 8) {
      place(fallbackName, entries)
      return
    }
    const byPrefix = {}
    for (const id of ids) {
      const key = prefixBucketOf(id, len)
      ;(byPrefix[key] ??= {})[id] = entries[id]
    }
    // 拆不动(前缀没变化)→ 落盘,避免死循环
    if (Object.keys(byPrefix).length <= 1) {
      place(fallbackName, entries)
      return
    }
    for (const [key, sub] of Object.entries(byPrefix)) recurse(sub, key, len + 1)
  }
  for (const [name, entries] of Object.entries(buckets)) {
    if (name === '0-9' || JSON.stringify(entries).length <= maxBytes) {
      place(name, entries)
      continue
    }
    recurse(entries, name, 2)
  }
  return out
}

/**
 * 前端(与 meta.buckets 配合)解析某物种的素材分片名:
 * **最长前缀优先**——多级拆分后桶名可能 2/3/4… 位,命中最长者即为该物种所在片。
 */
export function resolveBucket(id, knownBuckets) {
  const set = knownBuckets instanceof Set ? knownBuckets : new Set(knownBuckets || [])
  const s = String(id || '').toLowerCase()
  for (let len = 8; len >= 1; len--) {
    const p = prefixBucketOf(s, len)
    if (set.has(p)) return p
  }
  return set.has('0-9') ? '0-9' : prefixBucketOf(s, 1)
}

/** 桶名:物种 id 首字符是 a-z 用它,否则 '0-9' */
export function bucketOf(id) {
  const c = String(id || '').charAt(0).toLowerCase()
  return /^[a-z]$/.test(c) ? c : '0-9'
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k]
  }
  return out
}

/**
 * 完整 manifest → 核心 manifest(启动加载层)。
 * 物种只留名录字段 + 首图首音(取 images[0]/audios[0],兼容旧的 image/audio 单值);
 * 顶层统计改为按层级拆分后的真实值,并带 `buckets` 桶索引与 `mediaMode`。
 */
export function toCore(manifest) {
  const species = []
  const buckets = new Set()
  for (const sp of manifest.species || []) {
    buckets.add(bucketOf(sp.id))
    const out = pick(sp, CORE_SPECIES_KEYS)
    const img = (sp.images && sp.images[0]) || sp.image || null
    const aud = (sp.audios && sp.audios[0]) || sp.audio || null
    if (img) out.image = pick(img, CORE_ASSET_KEYS)
    if (aud) out.audio = pick(aud, CORE_ASSET_KEYS)
    species.push(out)
  }
  return {
    ...pick(manifest, ['schemaVersion', 'generatedAt', 'policy', 'mediaMode', 'source', 'perSpecies']),
    layer: 'core',
    total: species.length,
    stats: {
      withImage: species.filter((s) => s.image).length,
      withAudio: species.filter((s) => s.audio).length,
    },
    buckets: [...buckets].sort(),
    species,
  }
}

/**
 * 完整 manifest → 素材分片 { bucket: { id: { images, audios } } }。
 * 只写"有完整素材数组"的物种;无媒体物种不占桶空间(notes/profile 已在 core)。
 */
export function toAssetBuckets(manifest) {
  const buckets = {}
  for (const sp of manifest.species || []) {
    const images = sp.images && sp.images.length ? sp.images : sp.image ? [sp.image] : []
    const audios = sp.audios && sp.audios.length ? sp.audios : sp.audio ? [sp.audio] : []
    if (!images.length && !audios.length) continue
    const b = bucketOf(sp.id)
    if (!buckets[b]) buckets[b] = {}
    const entry = {}
    if (images.length) entry.images = images
    if (audios.length) entry.audios = audios
    buckets[b][sp.id] = entry
  }
  return buckets
}

/**
 * 全球台账(1+1 素材的 manifest-global.json) → 全球池(core 同构,懒加载)。
 * 只收有素材或声明可玩的物种;`layer:'global'` 便于前端区分。
 */
export function toGlobalPool(manifest) {
  const species = []
  for (const sp of manifest.species || []) {
    const img = (sp.images && sp.images[0]) || sp.image || null
    const aud = (sp.audios && sp.audios[0]) || sp.audio || null
    if (!img && !aud) continue
    const out = pick(sp, CORE_SPECIES_KEYS)
    if (img) out.image = pick(img, CORE_ASSET_KEYS)
    if (aud) out.audio = pick(aud, CORE_ASSET_KEYS)
    species.push(out)
  }
  return {
    ...pick(manifest, ['schemaVersion', 'generatedAt', 'policy', 'mediaMode', 'source', 'perSpecies']),
    layer: 'global',
    total: species.length,
    buckets: [],
    species,
  }
}


/**
 * 050 P1：`toMeta()` —— **唯一权威名录层**。
 *
 * 输入：core 完整 manifest（1,299 种，字段最全）+ 全球台账（9,839 → 可玩 9,545 种），
 * 输出：10,844 种 × 全部名录字段，**不含任何媒体**（媒体仍在 assets 分片 / 全球池）。
 *
 * 为什么"合并"不会冲突：core 1299 与全球池 9545 **实测零重叠**
 * （`check:catalog` 的互斥断言长期通过），所以这里是
 * 「**9,545 条补齐 core 才有的字段**」+「1,299 条原样带入」，没有去重/改 id 的风险。
 *
 * 字段口径：
 *  - `id/nameZh/nameSci/nameEn/family/taxonKey/taxonId/commonness` 来自任一来源，core 优先；
 *  - `rankWorld/rankCN/inCN/desc/location/habit` 只 core 有 → 保留；
 *  - `profile` 以 core 为准，但**重算 group**（050 P0：改按目名派生，修全球种全标"林鸟"的 bug）；
 *  - `notes`（答疑四字段）随 core 带入；
 *  - `order` 从 species-index 补（族/目展示 + 后续按目分片的依据）。
 */
export function toMeta(coreManifest, globalLedger, orderOf, usageKeys, classTable) {
  const byId = new Map()
  // 口径：权威层 = **可玩全集**（至少 1 图或 1 音），与 catalog/global 池同口径（10,844）。
  // 台账里"完全无媒体"的种（实测 294 种）不进权威层——它们没有详情可展示，
  // 仍由 species-index 骨架的轻量详情兜底（属"没有数据"，非缺陷）。
  let skippedNoMedia = 0
  for (const sp of globalLedger?.species || []) {
    const hasMedia = (sp.images && sp.images.length) || sp.audios && sp.audios.length || sp.image || sp.audio
    if (!hasMedia) {
      skippedNoMedia++
      continue
    }
    const out = pick(sp, META_SPECIES_KEYS)
    byId.set(sp.id, out)
  }
  let coreKept = 0
  let enriched = 0
  const fromCore = new Set()
  for (const sp of coreManifest?.species || []) {
    const out = pick(sp, META_SPECIES_KEYS)
    // 全球层同名（理论为 0）：core 覆盖全球层，缺失字段回填
    const prev = byId.get(sp.id)
    if (prev) {
      for (const [k, v] of Object.entries(out)) {
        if (v !== undefined && v !== null && (prev[k] === undefined || prev[k] === null)) prev[k] = v
      }
      enriched++
    } else {
      byId.set(sp.id, out)
      coreKept++
    }
    fromCore.add(sp.id)
  }

  // P0（修订版）：`group` 只按**科名**查表 —— 科是实在的分类单元，表由核心库的中文科名反推，
  // 与权威口径同源。用户 2026-10-10 明确要求：**没有信息就留空，不要靠推断填**；
  // 因此不再用「目名多数票」推断，也不再把查不到的种一律兜底成 landbird
  // （那会让九千多种都被标成"林鸟"，等于伪造信息）。
  const groups = { waterbird: 0, raptor: 0, landbird: 0 }
  let groupBlank = 0
  for (const sp of byId.values()) {
    const order = sp.order || orderOf?.get(sp.id) || orderOf?.get(sp.nameSci) || ''
    if (!sp.order && order) sp.order = order
    const next = { ...sp.profile }
    // 核心库 1,299 种的 group 本来就是**权威中文科名**推出来的 → 原样保留（只补不改）。
    // 全球种则按英文科名查表；查不到 → 留空（没有依据就不填，而不是伪造 landbird）。
    const g = fromCore.has(sp.id) ? next.group : groupOfKnown(sp.family)
    if (g) next.group = g
    else if (!fromCore.has(sp.id)) delete next.group
    sp.profile = Object.keys(next).length ? next : undefined
    if (g) groups[g]++
    else groupBlank++
  }

  // 050 P3：给**全球种**回填 taxonId（GBIF usageKey，取自 023 P1-b 的 gbif-match 缓存，离线）。
  // 核心库的 taxonId 一律不动（它们是历史键，另立 P3b 修正）。
  let taxonFilled = 0
  if (usageKeys) {
    for (const sp of byId.values()) {
      if (sp.taxonId != null) continue
      const key = usageKeys.get(sp.nameSci)
      if (key != null) {
        sp.taxonId = key
        taxonFilled++
      }
    }
  }

  // 051 S2：生活型六分法——**只附有出处的记录**（classTable 已过滤 disputed 与无 source 的条目）。
  // 出处本身不逐种重复写（按科/目存一次即可），物种上只挂 groups 数组 → 体积可控。
  let classCovered = 0
  const classes = {}
  if (classTable) {
    for (const sp of byId.values()) {
      const hit = resolveGroup6(classTable, { speciesSci: sp.nameSci, familySci: sp.family, orderSci: sp.order })
      if (!hit) continue
      classCovered++
      sp.profile = { ...sp.profile, group6: hit.groups }
      const key =
        hit.record.speciesSci || hit.record.familySci || `order:${hit.record.orderSci}`
      if (!classes[key]) {
        classes[key] = {
          groups: hit.groups,
          source: hit.record.source,
          contributor: hit.record.contributor,
          at: hit.record.at,
          matchedBy: hit.matchedBy,
        }
      }
    }
  }

  const species = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return {
    layer: 'meta',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: coreManifest?.policy || globalLedger?.policy || 'relaxed',
    source: 'core manifest + 全球采集台账（050 单一权威名录层）',
    total: species.length,
    /** 生活型类群出处（按科/目存一次；051 S2 —— 有出处才收录） */
    classes,
    stats: {
      fromCore: coreKept,
      enriched: enriched,
      skippedNoMedia,
      withNameZh: species.filter((s) => s.nameZh).length,
      withProfile: species.filter((s) => s.profile).length,
      withNotes: species.filter((s) => s.notes).length,
      withTaxonId: species.filter((s) => s.taxonId).length,
      taxonFilled,
      groups,
      groupBlank,
      classCovered,
      classRecords: Object.keys(classes).length,
    },
    species,
  }
}
