#!/usr/bin/env node
/**
 * 从 public/data/manifest.json 生成 D1 种子 SQL（worker/seed.sql）
 * 用法：
 *   node scripts/gen-d1-seed.mjs
 *   wrangler d1 execute uniaoer --file=worker/seed.sql --remote
 *
 * 说明：写入全部素材（每鸟 5 图 + 5 音），media.id = `${species}-${type}-${n}`。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest.json'), 'utf8'))

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const n = (v) => (v == null || v === '' ? 'NULL' : String(Number(v)))
const b = (v) => (v == null ? 'NULL' : v ? '1' : '0')

// 注意：D1 execute 不允许显式 BEGIN TRANSACTION/COMMIT（会自动按事务执行），故不包裹
let sql = '-- 由 scripts/gen-d1-seed.mjs 生成，请勿手改\n'
let mediaRows = 0

for (const s of manifest.species) {
  const p = s.profile || {}
  sql +=
    'INSERT OR REPLACE INTO species (id,name_zh,name_sci,name_en,taxon_id,family,commonness,rank_world,rank_cn,in_cn,group_name,migration,iucn_category,distribution_count,desc,location,habit) VALUES (' +
    [
      q(s.id),
      q(s.nameZh),
      q(s.nameSci),
      q(s.nameEn),
      n(s.taxonId),
      q(s.family),
      n(s.commonness),
      n(s.rankWorld),
      n(s.rankCN),
      b(s.inCN),
      q(p.group),
      q(p.migration),
      q(p.distribution && p.distribution.category),
      n(p.distribution && p.distribution.count),
      q(s.desc),
      q(s.location),
      q(s.habit),
    ].join(',') +
    ');\n'

  const imgs = s.images && s.images.length ? s.images : s.image ? [s.image] : []
  const auds = s.audios && s.audios.length ? s.audios : s.audio ? [s.audio] : []
  for (const [type, arr] of [
    ['image', imgs],
    ['audio', auds],
  ]) {
    arr.forEach((m, i) => {
      const id = `${s.id}-${type}-${i + 1}`
      sql +=
        'INSERT OR REPLACE INTO media (id,species_id,type,url,thumb_url,xl_url,avif_url,original_url,source_id,license,license_raw,author,source,source_url,quality,transcode) VALUES (' +
        [
          q(id),
          q(s.id),
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
        ].join(',') +
        ');\n'
      mediaRows++
    })
  }
}

sql += '\n'

await fs.writeFile(path.join(ROOT, 'worker/seed.sql'), sql)
console.log(`✅ 写入 worker/seed.sql：${manifest.species.length} 个物种、${mediaRows} 条媒体`)
