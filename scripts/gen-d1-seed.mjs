#!/usr/bin/env node
/**
 * 从 public/data/manifest.json 生成 D1 种子 SQL（worker/seed.sql）
 * 用法：
 *   node scripts/gen-d1-seed.mjs
 *   wrangler d1 execute uniaoer --file=worker/seed.sql --remote
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest.json'), 'utf8'))

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const n = (v) => (v == null ? 'NULL' : String(Number(v)))

let sql = '-- 由 scripts/gen-d1-seed.mjs 生成，请勿手改\nBEGIN TRANSACTION;\n'

for (const s of manifest.species) {
  sql +=
    'INSERT OR REPLACE INTO species (id,name_zh,name_sci,family,commonness,desc,location,habit) VALUES (' +
    [q(s.id), q(s.nameZh), q(s.nameSci), q(s.family), n(s.commonness), q(s.desc), q(s.location), q(s.habit)].join(',') +
    ');\n'
  for (const kind of ['image', 'audio']) {
    const m = s[kind]
    if (!m) continue
    const id = `${s.id}-${kind}`
    sql +=
      'INSERT OR REPLACE INTO media (id,species_id,type,url,license,license_raw,author,source,source_url,quality,transcode) VALUES (' +
      [
        q(id),
        q(s.id),
        q(kind),
        q(m.url),
        q(m.license),
        q(m.licenseRaw),
        q(m.author),
        q(m.source),
        q(m.sourceUrl),
        q(m.quality || null),
        m.transcode ? 1 : 0,
      ].join(',') +
      ');\n'
  }
}

sql += 'COMMIT;\n'

await fs.writeFile(path.join(ROOT, 'worker/seed.sql'), sql)
console.log(`✅ 写入 worker/seed.sql：${manifest.species.length} 个物种`)
