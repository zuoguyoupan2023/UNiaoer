#!/usr/bin/env node
/**
 * 029 M5:从分层产物生成 D1 种子 SQL（worker/seed.sql）。
 *
 * 形态：**一物种一行 + 首图首音内联**（2026-10-08 调整）。
 * 题目生成只需 1 图 1 音（完整 5+5 由前端 assets 分片提供，D-029-3），
 * 内联后可把独立 media 表的 31,347 行压缩成 species 的 21 个列，
 * 一次全量重建的写入行数从 22.2 万降到约 3.3 万（D1 免费额度 10 万行/天，
 * 且索引维护也按行计费）。
 *
 * 数据源（= 构建产物的"可玩层"，唯一事实源）：
 *   public/data/manifest.json            核心 1299 种（5+5 媒体、档案字段）
 *   public/data/manifest-global.min.json 全球池（1+1 媒体，约 9.5k 种）
 * 产出的 seed 由 sync:prod 灌入 D1（派生读模型）；meta 行记录指纹供 check:sync 比对。
 *
 * 用法：
 *   npm run d1:seed              # 生成 worker/seed.sql（gitignore）
 *   （由 npm run sync:prod 自动调用并分块执行远端）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORE_PATH = path.join(ROOT, 'public/data/manifest.json')
const GLOBAL_PATH = path.join(ROOT, 'public/data/manifest-global.min.json')

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const n = (v) => (v == null || v === '' ? 'NULL' : String(Number(v)))
const b = (v) => (v == null ? 'NULL' : v ? '1' : '0')

const core = JSON.parse(await fs.readFile(CORE_PATH, 'utf8'))
const global = JSON.parse(await fs.readFile(GLOBAL_PATH, 'utf8').catch(() => '{"species":[]}'))
const globalSpecies = Array.isArray(global.species) ? global.species : []

const SPECIES_COLS =
  'id,name_zh,name_sci,name_en,taxon_id,taxon_key,family,commonness,rank_world,rank_cn,in_cn,' +
  'group_name,migration,iucn_category,distribution_count,playable_image,playable_audio,quiz_excluded,' +
  'desc,location,habit,' +
  'img_url,img_thumb_url,img_xl_url,img_avif_url,img_thumbhash,img_original_url,img_source_id,' +
  'img_license,img_license_raw,img_author,img_source,img_source_url,img_transcode,' +
  'aud_url,aud_original_url,aud_source_id,aud_license,aud_license_raw,aud_author,' +
  'aud_source,aud_source_url,aud_quality,aud_transcode'

/** 首图的内联取值（无素材则整组 NULL；共 13 列） */
function inlineMedia(m) {
  if (!m) return Array.from({ length: 13 }, () => 'NULL')
  return [
    q(m.url),
    q(m.thumbUrl),
    q(m.xlUrl),
    q(m.avifUrl),
    q(m.thumbhash),
    q(m.originalUrl),
    q(m.sourceId),
    q(m.license),
    q(m.licenseRaw),
    q(m.author),
    q(m.source),
    q(m.sourceUrl),
    m.transcode ? 1 : 0,
  ]
}
function inlineAudio(m) {
  if (!m) return Array.from({ length: 11 }, () => 'NULL')
  return [
    q(m.url),
    q(m.originalUrl),
    q(m.sourceId),
    q(m.license),
    q(m.licenseRaw),
    q(m.author),
    q(m.source),
    q(m.sourceUrl),
    q(m.quality || null),
    m.transcode ? 1 : 0,
  ]
}

// D1 execute 不允许显式 BEGIN TRANSACTION/COMMIT（会自动按事务执行），故不包裹
let sql = '-- 由 scripts/gen-d1-seed.mjs 生成，请勿手改（重跑：npm run d1:seed）\n'
let withImg = 0
let withAud = 0

// ---- 核心层：1299 种，完整 5+5 素材 + 档案字段 ----
for (const s of core.species) {
  const p = s.profile || {}
  const img = (s.images && s.images[0]) || s.image || null
  const aud = (s.audios && s.audios[0]) || s.audio || null
  sql +=
    `INSERT INTO species (${SPECIES_COLS}) VALUES (` +
    [
      q(s.id),
      q(s.nameZh),
      q(s.nameSci),
      q(s.nameEn),
      n(s.taxonId),
      q(s.taxonKey),
      q(s.family),
      n(s.commonness),
      n(s.rankWorld),
      n(s.rankCN),
      b(s.inCN),
      q(p.group),
      q(p.migration),
      q(p.distribution && p.distribution.category),
      n(p.distribution && p.distribution.count),
      b((s.images ? s.images.length : s.image ? 1 : 0) >= 1),
      b((s.audios ? s.audios.length : s.audio ? 1 : 0) >= 1),
      b(!!s.quizExcluded),
      q(s.desc),
      q(s.location),
      q(s.habit),
      ...inlineMedia(img),
      ...inlineAudio(aud),
    ].join(',') +
    ');\n'
  if (img) withImg++
  if (aud) withAud++
}

// ---- 全球池：1+1 素材，无档案字段（name_zh 可能为空） ----
let globalRows = 0
for (const s of globalSpecies) {
  const img = (s.images && s.images[0]) || s.image || null
  const aud = (s.audios && s.audios[0]) || s.audio || null
  sql +=
    `INSERT INTO species (${SPECIES_COLS}) VALUES (` +
    [
      q(s.id),
      q(s.nameZh),
      q(s.nameSci),
      q(s.nameEn),
      n(s.taxonId),
      q(s.taxonKey),
      q(s.family),
      n(s.commonness),
      'NULL',
      'NULL',
      'NULL',
      'NULL',
      'NULL',
      'NULL',
      'NULL',
      b(!!img),
      b(!!aud),
      b(!!s.quizExcluded),
      q(s.desc),
      q(s.location),
      q(s.habit),
      ...inlineMedia(img),
      ...inlineAudio(aud),
    ].join(',') +
    ');\n'
  globalRows++
  if (img) withImg++
  if (aud) withAud++
}

// ---- meta 指纹（check:sync 的三源比对锚点） ----
const speciesRows = core.species.length + globalRows
const seedAt = new Date().toISOString()
const metaRows = [
  ['manifest_generatedAt', core.generatedAt || ''],
  ['manifest_total', String(core.species.length)],
  ['global_generatedAt', global.generatedAt || ''],
  ['global_total', String(globalRows)],
  ['seed_species', String(speciesRows)],
  ['seed_with_img', String(withImg)],
  ['seed_with_aud', String(withAud)],
  ['seed_at', seedAt],
]
sql += '\n'
for (const [k, v] of metaRows) {
  sql += `INSERT OR REPLACE INTO meta (key,value) VALUES (${q(k)},${q(v)});\n`
}

await fs.writeFile(path.join(ROOT, 'worker/seed.sql'), sql)
const mb = (Buffer.byteLength(sql) / 1e6).toFixed(1)
console.log(
  `✅ 写入 worker/seed.sql（${mb}MB）：物种 ${speciesRows}（核心 ${core.species.length} + 全球 ${globalRows}）、有图 ${withImg} / 有音 ${withAud}、meta ${metaRows.length} 项`,
)
