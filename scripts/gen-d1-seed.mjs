#!/usr/bin/env node
/**
 * 029 M5:从分层产物生成 D1 种子 SQL（worker/seed.sql）。
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

/** 素材数组（兼容旧单值 image/audio） */
function mediaOf(sp) {
  const imgs = sp.images && sp.images.length ? sp.images : sp.image ? [sp.image] : []
  const auds = sp.audios && sp.audios.length ? sp.audios : sp.audio ? [sp.audio] : []
  return [
    ['image', imgs],
    ['audio', auds],
  ]
}

function mediaRow(speciesId, type, m, i) {
  const id = `${speciesId}-${type}-${i + 1}`
  return (
    'INSERT INTO media (id,species_id,type,url,thumb_url,xl_url,avif_url,original_url,source_id,license,license_raw,author,source,source_url,quality,transcode,quiz_excluded) VALUES (' +
    [
      q(id),
      q(speciesId),
      q(type),
      q(m.url),
      q(m.thumbUrl),
      q(m.xlUrl),
      q(m.avifUrl),
      q(m.originalUrl),
      q(m.sourceId),
      q(m.license),
      q(m.licenseRaw),
      q(m.author),
      q(m.source),
      q(m.sourceUrl),
      q(m.quality || null),
      m.transcode ? 1 : 0,
      b(!!m.quizExcluded),
    ].join(',') +
    ');\n'
  )
}

// D1 execute 不允许显式 BEGIN TRANSACTION/COMMIT（会自动按事务执行），故不包裹
let sql = '-- 由 scripts/gen-d1-seed.mjs 生成，请勿手改（重跑：npm run d1:seed）\n'
let mediaRows = 0

// ---- 核心层：1299 种，完整 5+5 素材 + 档案字段 ----
for (const s of core.species) {
  const p = s.profile || {}
  sql +=
    'INSERT INTO species (id,name_zh,name_sci,name_en,taxon_id,taxon_key,family,commonness,rank_world,rank_cn,in_cn,group_name,migration,iucn_category,distribution_count,playable_image,playable_audio,quiz_excluded,desc,location,habit) VALUES (' +
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
    ].join(',') +
    ');\n'

  for (const [type, arr] of mediaOf(s)) {
    arr.forEach((m, i) => {
      sql += mediaRow(s.id, type, m, i)
      mediaRows++
    })
  }
}

// ---- 全球池：1+1 素材，无档案字段（name_zh 可能为空） ----
let globalRows = 0
for (const s of globalSpecies) {
  sql +=
    'INSERT INTO species (id,name_zh,name_sci,name_en,taxon_id,taxon_key,family,commonness,rank_world,rank_cn,in_cn,group_name,migration,iucn_category,distribution_count,playable_image,playable_audio,quiz_excluded,desc,location,habit) VALUES (' +
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
      b(!!s.image),
      b(!!s.audio),
      b(!!s.quizExcluded),
      q(s.desc),
      q(s.location),
      q(s.habit),
    ].join(',') +
    ');\n'
  globalRows++
  for (const [type, arr] of mediaOf(s)) {
    arr.forEach((m, i) => {
      sql += mediaRow(s.id, type, m, i)
      mediaRows++
    })
  }
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
  ['seed_media', String(mediaRows)],
  ['seed_at', seedAt],
]
sql += '\n'
for (const [k, v] of metaRows) {
  sql += `INSERT OR REPLACE INTO meta (key,value) VALUES (${q(k)},${q(v)});\n`
}

await fs.writeFile(path.join(ROOT, 'worker/seed.sql'), sql)
const mb = (Buffer.byteLength(sql) / 1e6).toFixed(1)
console.log(
  `✅ 写入 worker/seed.sql（${mb}MB）：物种 ${speciesRows}（核心 ${core.species.length} + 全球 ${globalRows}）、媒体 ${mediaRows} 条、meta ${metaRows.length} 项`,
)
