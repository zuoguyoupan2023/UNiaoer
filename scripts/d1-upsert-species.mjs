#!/usr/bin/env node
/**
 * D1 定向 UPSERT（少量物种；不 DROP、不删行、不跑全量 sync:prod）。
 *
 * 场景：媒体替换/纠错后，只更新这些物种在 `species` 表里的行（含首图/首音字段）。
 * 输入：data-cache/manifest-core-full.json + data-cache/manifest-global.json
 *       public/data/manifest-meta.json（决定哪些种进 D1；排除无素材种）
 * 输出：一份只含 INSERT ... ON CONFLICT(id) DO UPDATE 的 SQL 文件。
 *
 * 用法：
 *   node scripts/d1-upsert-species.mjs --ids pica-serica --out data-cache/d1-upsert-pica.sql
 *   node scripts/d1-upsert-species.mjs --ids a,b --dry-run
 *
 * 执行（写云端，需用户确认）：
 *   npx wrangler d1 execute uniaoer --remote --file=data-cache/d1-upsert-pica.sql
 *
 * 安全约束：
 *   - 只生成 UPSERT，不含 DROP/DELETE/ALTER；
 *   - id 必须存在于「完整层 ∩ manifest-meta」；缺失即退出 1，不写文件；
 *   - 行数与列数都有断言（复用 lib/d1-rows）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from './lib/util.mjs'
import { SPECIES_COLS, buildD1Rows, rowToSql } from './lib/d1-rows.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const IDS = String(args.ids || args.id || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const OUT = path.resolve(ROOT, args.out || 'data-cache/d1-upsert.sql')
const DRY = !!args['dry-run']

if (!IDS.length) {
  console.error('❌ 缺少 --ids（逗号分隔的物种 id）')
  process.exit(1)
}

const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'))

const [core, global, meta] = await Promise.all([
  readJson('data-cache/manifest-core-full.json'),
  readJson('data-cache/manifest-global.json').catch(() => ({ species: [] })),
  readJson('public/data/manifest-meta.json'),
])

const allowed = new Set((meta.species || []).map((s) => s.id))
const stats = buildD1Rows(core, global, allowed)
const byId = new Map(stats.rows.map((r) => [r[0], r]))

const missing = IDS.filter((id) => !byId.has(id))
if (missing.length) {
  console.error(`❌ 以下 id 不在「完整层 ∩ manifest-meta」中（检查拼写/是否无素材被排除）：${missing.join('、')}`)
  process.exit(1)
}
if (stats.rows.length !== allowed.size) {
  console.warn(`⚠️ D1 行数 ${stats.rows.length} ≠ meta 物种数 ${allowed.size}（通常相等；请确认 meta 口径）`)
}

const updates = SPECIES_COLS.filter((c) => c !== 'id')
  .map((c) => `${c}=excluded.${c}`)
  .join(', ')

let sql = `-- 由 scripts/d1-upsert-species.mjs 生成（定向 UPSERT，不含 DROP/DELETE/ALTER）\n`
sql += `-- ids: ${IDS.join(',')}\n`
sql += `-- generatedAt: ${new Date().toISOString()}\n\n`
for (const id of IDS) {
  const row = byId.get(id)
  const values = rowToSql(row).join(',')
  sql += `INSERT INTO species (${SPECIES_COLS.join(',')}) VALUES (${values}) ON CONFLICT(id) DO UPDATE SET ${updates};\n`
}

if (DRY) {
  console.log(`\n${sql}`)
  console.log(`（dry-run：未写文件；目标 ${OUT}）`)
} else {
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, sql)
  console.log(`✅ 生成 ${path.relative(ROOT, OUT)}（${IDS.length} 行，${Buffer.byteLength(sql)} 字节）`)
}
