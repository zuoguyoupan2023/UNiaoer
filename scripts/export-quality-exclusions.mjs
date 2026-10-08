#!/usr/bin/env node
/**
 * 029 M3:质量隔离导出（D1 → 题库构建输入）。
 *
 * 链路（docs/029 §4）：
 *   quality 反馈 → 管理方在 /admin「隔离素材」→ D1 `media_quarantine`
 *   → 本脚本导出 → `data/quality-exclusions.json`（构建输入，入库）
 *   → 下次 `npm run bank:global --ids …` 重采受影响物种时，构建期把它映射进
 *      `media-overrides.json` 的 excludeUrls（既有机制，零新管线）
 *   → 有替补则自动换下一条候选；无替补 → `quizExcluded`（仅展示、不进题库）
 *
 * 用法：
 *   npm run quality:export             # 从 D1 拉取活跃隔离项并写 data/quality-exclusions.json
 *   npm run quality:export -- --no-net # 只用本地文件重算/校验（CI/离线）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data/quality-exclusions.json')
const args = parseArgs(process.argv.slice(2))
const NO_NET = !!args['no-net']

await loadEnv(path.join(ROOT, '.env'))

/** 活跃隔离项（resolved_at 为空）→ 规范化输出 */
function normalize(items) {
  const bySpecies = {}
  for (const it of items) {
    const speciesId = String(it.species_id || '').trim()
    const type = String(it.media_type || '').trim()
    const url = String(it.media_url || '').trim()
    if (!speciesId || !url || (type !== 'image' && type !== 'audio')) continue
    if (!bySpecies[speciesId]) bySpecies[speciesId] = { image: [], audio: [] }
    bySpecies[speciesId][type].push(url)
  }
  return bySpecies
}

let bySpecies = {}
let source = 'local'

if (!NO_NET) {
  const key = process.env.ADMIN_KEY
  if (!key) {
    console.error('❌ 缺少 ADMIN_KEY（.env）——或用 --no-net 只读本地文件')
    process.exit(1)
  }
  const origin = (process.env.WORKER_ORIGIN || 'https://uniaoer.com').replace(/\/$/, '')
  try {
    const res = await fetch(`${origin}/api/quarantine`, { headers: { 'x-admin-key': key } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const active = (data.items ?? []).filter((x) => !x.resolved_at)
    bySpecies = normalize(active)
    source = 'd1'
    console.log(`从 D1 拉取隔离项 ${active.length} 条（活跃）`)
  } catch (e) {
    console.warn(`⚠ 无法从 D1 拉取（${e.message}）——保留本地已有文件不变`)
    process.exit(0)
  }
} else {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'))
    bySpecies = prev.bySpecies ?? {}
    source = 'local'
  } catch {
    bySpecies = {}
  }
}

const speciesCount = Object.keys(bySpecies).length
const mediaCount = Object.values(bySpecies).reduce(
  (n, v) => n + (v.image?.length ?? 0) + (v.audio?.length ?? 0),
  0,
)
const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source,
  note:
    '质量隔离台账（029 M3）。构建期映射进 media-overrides.excludeUrls：' +
    '有替补则换下一条候选，无替补则该物种 quizExcluded（仅展示、不进题库）。' +
    '由 npm run quality:export 从 D1 生成，请勿手改。',
  counts: { species: speciesCount, media: mediaCount },
  bySpecies,
}
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`✓ 写入 data/quality-exclusions.json：${speciesCount} 个物种 / ${mediaCount} 条素材（source=${source}）`)
