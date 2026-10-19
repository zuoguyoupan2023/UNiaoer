/**
 * D1 种子行构造（全量 seed 与定向 upsert 共用）。
 *
 * 为什么要有这个模块（062 §7 E1）：
 *   `gen-d1-seed.mjs` 以前直接读 `public/data/manifest.json` /
 *   `public/data/manifest-global.min.json`。这两个文件在 S6/P5 后已退役，
 *   导致 `npm run d1:seed` / `npm run sync:prod` 在生成 seed 时直接失败。
 *
 * 现在统一从「仍存在且语义正确」的两个输入取数：
 *   data-cache/manifest-core-full.json   核心 1,299 种（5+5 媒体、档案字段）
 *   data-cache/manifest-global.json      全球 9,839 种（当前 5+5 台账）
 *
 * 输出是一行一个物种的**原始值数组**（顺序 = SPECIES_COLS），
 * 由 `rowToSql` 统一转 SQL 字面量；定向脚本可以直接拿原始值做逐列 diff。
 */

export const SPECIES_COLS = [
  'id', 'name_zh', 'name_sci', 'name_en', 'taxon_id', 'taxon_key', 'family', 'commonness',
  'rank_world', 'rank_cn', 'in_cn', 'group_name', 'migration', 'iucn_category',
  'distribution_count', 'playable_image', 'playable_audio', 'quiz_excluded',
  'desc', 'location', 'habit',
  'img_url', 'img_thumb_url', 'img_xl_url', 'img_avif_url', 'img_thumbhash',
  'img_original_url', 'img_source_id', 'img_license', 'img_license_raw', 'img_author',
  'img_source', 'img_source_url', 'img_transcode',
  'aud_url', 'aud_original_url', 'aud_source_id', 'aud_license', 'aud_license_raw',
  'aud_author', 'aud_source', 'aud_source_url', 'aud_quality', 'aud_transcode',
  'rnd',
]

const TEXT_COLS = new Set([
  'id', 'name_zh', 'name_sci', 'name_en', 'taxon_key', 'family', 'group_name', 'migration',
  'iucn_category', 'desc', 'location', 'habit',
  'img_url', 'img_thumb_url', 'img_xl_url', 'img_avif_url', 'img_thumbhash',
  'img_original_url', 'img_source_id', 'img_license', 'img_license_raw', 'img_author',
  'img_source', 'img_source_url',
  'aud_url', 'aud_original_url', 'aud_source_id', 'aud_license', 'aud_license_raw',
  'aud_author', 'aud_source', 'aud_source_url', 'aud_quality',
])
const REAL_COLS = new Set(['rnd'])

/** SQL 字符串字面量：折叠控制字符 + 转义单引号（与旧 gen-d1-seed 完全一致）。 */
export const q = (v) =>
  v == null || v === ''
    ? 'NULL'
    : `'${String(v).replace(/\s+/g, ' ').trim().replace(/'/g, "''")}'`

/** 稳定伪随机值 [0,1)，由 id 派生（同一物种跨次构建不变）。 */
export function rndOf(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const n = (v) => (v == null || v === '' ? 'NULL' : String(Number(v)))
const b = (v) => (v == null ? 'NULL' : v ? '1' : '0')

function mediaOf(images, audios) {
  const img = (images && images[0]) || null
  const aud = (audios && audios[0]) || null
  return { img, aud }
}

/** 核心库行：完整档案字段 + 5+5 素材。 */
export function coreRow(s) {
  const p = s.profile || {}
  const { img, aud } = mediaOf(s.images, s.audios)
  return [
    s.id, s.nameZh ?? null, s.nameSci ?? null, s.nameEn ?? null,
    s.taxonId ?? null, s.taxonKey ?? null, s.family ?? null, s.commonness ?? null,
    s.rankWorld ?? null, s.rankCN ?? null, s.inCN ?? null,
    p.group ?? null, p.migration ?? null,
    p.distribution?.category ?? null, p.distribution?.count ?? null,
    (s.images?.length ?? (s.image ? 1 : 0)) >= 1 ? 1 : 0,
    (s.audios?.length ?? (s.audio ? 1 : 0)) >= 1 ? 1 : 0,
    s.quizExcluded ? 1 : 0,
    s.desc ?? null, s.location ?? null, s.habit ?? null,
    img?.url ?? null, img?.thumbUrl ?? null, img?.xlUrl ?? null, img?.avifUrl ?? null,
    img?.thumbhash ?? null, img?.originalUrl ?? null, img?.sourceId ?? null,
    img?.license ?? null, img?.licenseRaw ?? null, img?.author ?? null,
    img?.source ?? null, img?.sourceUrl ?? null, img?.transcode ? 1 : 0,
    aud?.url ?? null, aud?.originalUrl ?? null, aud?.sourceId ?? null,
    aud?.license ?? null, aud?.licenseRaw ?? null, aud?.author ?? null,
    aud?.source ?? null, aud?.sourceUrl ?? null, aud?.quality ?? null,
    aud?.transcode ? 1 : 0,
    rndOf(s.id),
  ]
}

/** 全球池行：无档案/排名/分布字段，只内联首图首音。 */
export function globalRow(s) {
  const { img, aud } = mediaOf(s.images, s.audios)
  return [
    s.id, s.nameZh ?? null, s.nameSci ?? null, s.nameEn ?? null,
    s.taxonId ?? null, s.taxonKey ?? null, s.family ?? null, s.commonness ?? null,
    null, null, null, null, null, null, null,
    img ? 1 : 0, aud ? 1 : 0, s.quizExcluded ? 1 : 0,
    s.desc ?? null, s.location ?? null, s.habit ?? null,
    img?.url ?? null, img?.thumbUrl ?? null, img?.xlUrl ?? null, img?.avifUrl ?? null,
    img?.thumbhash ?? null, img?.originalUrl ?? null, img?.sourceId ?? null,
    img?.license ?? null, img?.licenseRaw ?? null, img?.author ?? null,
    img?.source ?? null, img?.sourceUrl ?? null, img?.transcode ? 1 : 0,
    aud?.url ?? null, aud?.originalUrl ?? null, aud?.sourceId ?? null,
    aud?.license ?? null, aud?.licenseRaw ?? null, aud?.author ?? null,
    aud?.source ?? null, aud?.sourceUrl ?? null, aud?.quality ?? null,
    aud?.transcode ? 1 : 0,
    rndOf(s.id),
  ]
}

/**
 * 把核心 + 全球合并成目标行集合（core 优先）。
 * 返回：rows / coreCount / globalCount / withImg / withAud / duplicates。
 */
export function buildD1Rows(coreDoc, globalDoc) {
  const core = Array.isArray(coreDoc?.species) ? coreDoc.species : []
  const global = Array.isArray(globalDoc?.species) ? globalDoc.species : []
  const seen = new Set()
  const rows = []
  let coreCount = 0
  let globalCount = 0
  let withImg = 0
  let withAud = 0
  const duplicates = []

  for (const s of core) {
    if (!s?.id) continue
    if (seen.has(s.id)) {
      duplicates.push(s.id)
      continue
    }
    seen.add(s.id)
    const row = coreRow(s)
    rows.push(row)
    coreCount++
    if (row[15]) withImg++
    if (row[16]) withAud++
  }
  for (const s of global) {
    if (!s?.id) continue
    if (seen.has(s.id)) {
      duplicates.push(s.id)
      continue
    }
    seen.add(s.id)
    const row = globalRow(s)
    rows.push(row)
    globalCount++
    if (row[15]) withImg++
    if (row[16]) withAud++
  }

  return {
    rows,
    coreCount,
    globalCount,
    withImg,
    withAud,
    duplicates,
    coreGeneratedAt: coreDoc?.generatedAt || '',
    globalGeneratedAt: globalDoc?.generatedAt || '',
  }
}

/** 原始值数组 → SQL 字面量数组（长度必须等于 SPECIES_COLS）。 */
export function rowToSql(row) {
  if (row.length !== SPECIES_COLS.length) {
    throw new Error(`D1 行列数不符：${row.length} ≠ ${SPECIES_COLS.length}`)
  }
  return row.map((v, i) => {
    const col = SPECIES_COLS[i]
    if (REAL_COLS.has(col)) return v == null ? 'NULL' : Number(v).toFixed(5)
    if (TEXT_COLS.has(col)) return q(v)
    return typeof v === 'number' || typeof v === 'boolean' ? n(v) : b(v)
  })
}

/** 一行 → `INSERT ...` 语句（用于全量 seed / 定向 upsert 的 VALUES）。 */
export function insertSql(row) {
  return `INSERT INTO species (${SPECIES_COLS.join(',')}) VALUES (${rowToSql(row).join(',')});`
}

/** meta 指纹（check:sync 的锚点）；与旧 gen-d1-seed 的键保持一致。 */
export function buildMetaRows(coreDoc, stats, seedAt = new Date().toISOString()) {
  return [
    ['manifest_generatedAt', coreDoc?.generatedAt || ''],
    ['manifest_total', String(stats.coreCount)],
    ['global_generatedAt', stats.globalGeneratedAt || ''],
    ['global_total', String(stats.globalCount)],
    ['seed_species', String(stats.rows.length)],
    ['seed_with_img', String(stats.withImg)],
    ['seed_with_aud', String(stats.withAud)],
    ['seed_at', seedAt],
  ]
}

/** 渲染全量 seed SQL（保持与旧脚本相同的 `INSERT INTO` + `INSERT OR REPLACE meta` 形态）。 */
export function renderSeedSql({ rows, metaRows, header }) {
  let sql = header || '-- 由 scripts/gen-d1-seed.mjs 生成，请勿手改（重跑：npm run d1:seed）\n'
  for (const row of rows) sql += insertSql(row) + '\n'
  sql += '\n'
  for (const [k, v] of metaRows) {
    sql += `INSERT OR REPLACE INTO meta (key,value) VALUES (${q(k)},${q(v)});\n`
  }
  return sql
}
