#!/usr/bin/env node
/**
 * 062 §7 E2–E4：D1 定向 upsert（不 DROP 表、不跑全量 sync:prod）。
 *
 * 输入：
 *   data-cache/manifest-core-full.json + data-cache/manifest-global.json
 *   public/data/manifest-meta.json（决定哪些种进 D1；排除 112 个无素材种）
 *   D1 导出的 species JSON（--d1-json，wrangler d1 execute ... --json 的原始输出）
 *   D1 PRAGMA table_info(species) JSON（--pragma-json，可选但建议）
 *
 * 输出：
 *   data-cache/d1-targeted/chunk-*.sql（每块 ≤2.4MB，可直接按顺序 execute）
 *   data-cache/d1-targeted/summary.json（行数/变更数/回滚信息）
 *
 * 用法：
 *   npx wrangler d1 execute uniaoer --remote --json --command "SELECT <cols> FROM species ORDER BY id;" > /tmp/d1-species-before.json
 *   npx wrangler d1 execute uniaoer --remote --json --command "PRAGMA table_info(species);" > /tmp/d1-pragma.json
 *   node scripts/d1-targeted-sync.mjs --d1-json /tmp/d1-species-before.json --pragma-json /tmp/d1-pragma.json
 *
 * 6 项断言（任一失败即退出，不写 SQL）：
 *   1) D1 表结构前 45 列与 SPECIES_COLS 一致
 *   2) 目标 id 唯一、name_sci 非空
 *   3) oldIds - newIds = 0（不删除任何种）
 *   4) newIds - oldIds = 182（与 062 预期一致）
 *   5) 现有 D1 行数 = 10,844
 *   6) 生成 SQL 只含 species/meta 的 upsert，不含 DROP/DELETE/ALTER
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from './lib/util.mjs'
import {
  SPECIES_COLS,
  buildD1Rows,
  buildMetaRows,
  rowToSql,
} from './lib/d1-rows.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const OUT_DIR = path.resolve(ROOT, args['out-dir'] || 'data-cache/d1-targeted')
const D1_JSON = path.resolve(ROOT, args['d1-json'] || '/tmp/d1-species-before.json')
const PRAGMA_JSON = path.resolve(ROOT, args['pragma-json'] || '/tmp/d1-pragma.json')
const META_PATH = path.resolve(ROOT, args.meta || 'public/data/manifest-meta.json')
const EXPECT_ADDED = Number(args['expect-added'] || 182)
const CHUNK_BYTES = 2_400_000

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))
function parseWranglerJson(text) {
  const a = text.indexOf('[')
  const b = text.lastIndexOf(']')
  if (a < 0 || b < 0) throw new Error('wrangler 输出里找不到 JSON 数组')
  const chunks = JSON.parse(text.slice(a, b + 1))
  const first = Array.isArray(chunks) ? chunks[0] : chunks
  return first?.results ?? first?.result?.[0]?.results ?? []
}

function upsertSql(row) {
  const values = rowToSql(row).join(',')
  const updates = SPECIES_COLS.filter((c) => c !== 'id')
    .map((c) => `${c}=excluded.${c}`)
    .join(',')
  return `INSERT INTO species (${SPECIES_COLS.join(',')}) VALUES (${values}) ON CONFLICT(id) DO UPDATE SET ${updates};`
}

function check(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const core = await readJson(path.join(ROOT, 'data-cache/manifest-core-full.json'))
const global = await readJson(path.join(ROOT, 'data-cache/manifest-global.json'))
const meta = await readJson(META_PATH)
const allowedIds = new Set((meta.species || []).map((s) => s.id))
const stats = buildD1Rows(core, global, allowedIds)

const d1Text = await fs.readFile(D1_JSON, 'utf8')
const oldRows = parseWranglerJson(d1Text)
console.log(`D1 现有 ${oldRows.length} 行 · 新目标 ${stats.rows.length} 行（核心 ${stats.coreCount} + 全球 ${stats.globalCount}，过滤 ${stats.filteredOut}）`)

// 1) 表结构
let pragma = null
try {
  pragma = parseWranglerJson(await fs.readFile(PRAGMA_JSON, 'utf8'))
} catch {
  console.warn('⚠️ 未读到 PRAGMA JSON，跳过表结构断言（建议补上 --pragma-json）')
}
if (pragma?.length) {
  const d1Cols = pragma.map((r) => r.name)
  const same = d1Cols.slice(0, SPECIES_COLS.length).join(',') === SPECIES_COLS.join(',')
  check(same, `D1 表结构前 ${SPECIES_COLS.length} 列与 SPECIES_COLS 一致`)
  const missing = SPECIES_COLS.filter((c) => !d1Cols.includes(c))
  check(!missing.length, `D1 表包含全部 SPECIES_COLS（缺 ${missing.length}）`)
}

// 2) 目标 id 唯一 / name_sci 非空
const newIds = new Set()
let badName = 0
for (const row of stats.rows) {
  if (newIds.has(row[0])) {
    console.error(`❌ 目标 id 重复：${row[0]}`)
    process.exit(1)
  }
  newIds.add(row[0])
  if (!row[2]) badName++
}
check(!badName, `目标 ${stats.rows.length} 行 id 唯一、name_sci 全部非空`)

// 3/4) 不删除、新增数量
const oldIds = new Set(oldRows.map((r) => r.id))
const removed = [...oldIds].filter((id) => !newIds.has(id))
const added = [...newIds].filter((id) => !oldIds.has(id))
check(removed.length === 0, `不删除任何种（old−new = ${removed.length}）`)
check(
  added.length === EXPECT_ADDED,
  `新增种 = ${added.length}（预期 ${EXPECT_ADDED}）`,
)
check(oldRows.length === 10844, `D1 现有行数 = ${oldRows.length}（预期 10,844）`)

// 差异：把 D1 行按 SPECIES_COLS 拼回数组，再用同一套 SQL 字面量比较
const oldById = new Map(oldRows.map((r) => [r.id, rowToSql(SPECIES_COLS.map((c) => r[c]))]))
let changed = 0
let same = 0
const upserts = []
for (const row of stats.rows) {
  const id = row[0]
  const next = rowToSql(row)
  const prev = oldById.get(id)
  if (!prev) {
    upserts.push(row)
    continue
  }
  if (prev.join(',') !== next.join(',')) {
    changed++
    upserts.push(row)
  } else {
    same++
  }
}

const metaRows = buildMetaRows(core, stats)
const header = '-- 062 E4 D1 定向 upsert（幂等；仅 species/meta 的 INSERT ... ON CONFLICT）\n'
const statements = []
for (const row of upserts) statements.push(upsertSql(row))
for (const [k, v] of metaRows) {
  statements.push(`INSERT OR REPLACE INTO meta (key,value) VALUES ('${String(k).replace(/'/g, "''")}','${String(v).replace(/'/g, "''")}');`)
}

// 6) 生成前自检：只允许两类语句
const bad = statements.filter(
  (s) => !s.startsWith('INSERT INTO species (') && !s.startsWith('INSERT OR REPLACE INTO meta ('),
)
check(!bad.length, `生成语句只含 species/meta upsert（异常 ${bad.length} 条）`)
const fullSql = header + statements.join('\n') + '\n'
check(!/\b(DROP|DELETE|ALTER)\b/i.test(fullSql), 'SQL 不含 DROP/DELETE/ALTER')

await fs.mkdir(OUT_DIR, { recursive: true })
for (const f of await fs.readdir(OUT_DIR).catch(() => [])) {
  if (f.endsWith('.sql') || f === 'summary.json') await fs.rm(path.join(OUT_DIR, f), { force: true })
}

// 分块（按字节；语句均单行，切块安全）
let chunk = []
let chunkBytes = Buffer.byteLength(header)
const files = []
for (const s of statements) {
  const b = Buffer.byteLength(s) + 1
  if (chunkBytes + b > CHUNK_BYTES && chunk.length) {
    const name = `chunk-${String(files.length + 1).padStart(2, '0')}.sql`
    await fs.writeFile(path.join(OUT_DIR, name), header + chunk.join('\n') + '\n')
    files.push({ name, statements: chunk.length, bytes: chunkBytes })
    chunk = []
    chunkBytes = Buffer.byteLength(header)
  }
  chunk.push(s)
  chunkBytes += b
}
if (chunk.length) {
  const name = `chunk-${String(files.length + 1).padStart(2, '0')}.sql`
  await fs.writeFile(path.join(OUT_DIR, name), header + chunk.join('\n') + '\n')
  files.push({ name, statements: chunk.length, bytes: chunkBytes })
}

const summary = {
  generatedAt: new Date().toISOString(),
  oldRows: oldRows.length,
  newRows: stats.rows.length,
  added: added.length,
  removed: removed.length,
  changed,
  same,
  upserts: upserts.length,
  metaRows: metaRows.length,
  chunks: files,
  expectedAdded: EXPECT_ADDED,
  source: { core: stats.coreCount, global: stats.globalCount, filteredOut: stats.filteredOut },
}
await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')

console.log(`\n变更：新增 ${added.length} · 字段变更 ${changed} · 不变 ${same} · 删除 ${removed.length}`)
console.log(`upsert ${upserts.length} 行 + meta ${metaRows.length} 项 → ${files.length} 块（${(files.reduce((n, f) => n + f.bytes, 0) / 1e6).toFixed(2)}MB）`)
console.log(`输出：${path.relative(ROOT, OUT_DIR)}/chunk-*.sql`)
console.log('\n执行（逐块，必须带 --remote）：')
for (const f of files) {
  console.log(`npx wrangler d1 execute uniaoer --remote --file=${path.join(path.relative(ROOT, OUT_DIR), f.name)}`)
}
