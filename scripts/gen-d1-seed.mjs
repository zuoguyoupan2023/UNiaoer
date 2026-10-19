#!/usr/bin/env node
/**
 * 029 M5:从分层产物生成 D1 种子 SQL（worker/seed.sql）。
 *
 * 形态：**一物种一行 + 首图首音内联**（题目只需 1 图 1 音；完整 5+5 由前端 assets 分片提供）。
 *
 * 数据源（S6/P5 后的真实产物；062 §7 E1 修复）：
 *   data-cache/manifest-core-full.json   核心 1,299 种（5+5 媒体、档案字段）
 *   data-cache/manifest-global.json      全球 9,839 种（当前 5+5 台账）
 * 旧路径 public/data/manifest.json / manifest-global.min.json 已退役，不再读取。
 *
 * 行构造放在 scripts/lib/d1-rows.mjs，供全量 seed 与定向 upsert 共用。
 *
 * 用法：
 *   npm run d1:seed              # 生成 worker/seed.sql（gitignore）
 *   （由 npm run sync:prod 自动调用并分块执行远端）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildD1Rows, buildMetaRows, renderSeedSql } from './lib/d1-rows.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORE_PATH = path.join(ROOT, 'data-cache/manifest-core-full.json')
const GLOBAL_PATH = path.join(ROOT, 'data-cache/manifest-global.json')
const META_PATH = path.join(ROOT, 'public/data/manifest-meta.json')

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

const core = await readJson(CORE_PATH)
const global = await readJson(GLOBAL_PATH)
// 只给 meta 里的可玩种灌 D1：meta 排除了“无任何素材”的种（053 §6.0），
// 否则 check:sync 的 seed_species 会与 meta.total 对不上。
const meta = await readJson(META_PATH).catch(() => null)
const allowedIds = meta?.species?.length ? new Set(meta.species.map((s) => s.id)) : null
const stats = buildD1Rows(core, global, allowedIds)

if (stats.duplicates.length) {
  console.warn(`⚠️ 跳过重复 id ${stats.duplicates.length} 个：${stats.duplicates.slice(0, 5).join(', ')} …`)
}
if (!stats.rows.length) throw new Error('D1 seed 目标行为 0，检查两个输入文件')

const metaRows = buildMetaRows(core, stats)
const sql = renderSeedSql({ rows: stats.rows, metaRows })

await fs.writeFile(path.join(ROOT, 'worker/seed.sql'), sql)
const mb = (Buffer.byteLength(sql) / 1e6).toFixed(1)
console.log(
  `✅ 写入 worker/seed.sql（${mb}MB）：物种 ${stats.rows.length}` +
    `（核心 ${stats.coreCount} + 全球 ${stats.globalCount}，按 meta 过滤 ${stats.filteredOut}）` +
    `、有图 ${stats.withImg} / 有音 ${stats.withAud}、meta ${metaRows.length} 项`,
)
