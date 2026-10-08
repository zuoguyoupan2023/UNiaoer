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

/** 核心条目保留的名录字段(其余如 desc/location/habit 等属详情层)。
 *  notes/profile 体量极小(全库 ~0.2MB)且被 FAQ 列表/结果页档案直接读取(无 loading 态),
 *  故留在 core;真正的大头是 5+5 素材数组(images/audios)→ 三层里的 assets 分片。 */
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
 * 大桶自适应拆分(029 M1 DoD:单桶 ≤400KB):
 * 桶 JSON 超过 `maxBytes` 时,按 id 前两位字母拆成子桶(如 p → pa/pe/ph…)。
 * 确定性:同一输入必得同一输出;核心的 `buckets` 列出**最终**桶名,前端据此解析。
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

export function splitLargeBuckets(buckets, maxBytes = BUCKET_SPLIT_THRESHOLD) {
  const out = {}
  for (const [name, entries] of Object.entries(buckets)) {
    const text = JSON.stringify(entries)
    if (text.length <= maxBytes || name === '0-9') {
      out[name] = entries
      continue
    }
    for (const [id, entry] of Object.entries(entries)) {
      const sub = subBucketOf(id)
      if (!out[sub]) out[sub] = {}
      out[sub][id] = entry
    }
  }
  return out
}

/**
 * 前端(与 core.buckets 配合)解析某物种的素材分片名:
 * 先试两位子桶,再试一位桶;都不在 buckets 清单时回退一位桶名(容错)。
 */
export function resolveBucket(id, knownBuckets) {
  const set = knownBuckets instanceof Set ? knownBuckets : new Set(knownBuckets || [])
  const two = subBucketOf(id)
  if (set.has(two)) return two
  const one = bucketOf(id)
  if (set.has(one)) return one
  return one
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
