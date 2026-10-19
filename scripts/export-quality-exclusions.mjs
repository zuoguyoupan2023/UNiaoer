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
 *
 * 退出码（F6，063 §3.4）：
 *   0 = 成功写入；1 = 拉取/解析失败 —— **失败一律不写文件、非零退出**，
 *   避免"调用方以为成功、隔离台账其实没更新"的空转（旧行为是 exit 0）。
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

/** 读现有文件：不存在 → 空（正常，首次运行）；**损坏 → 抛错**（绝不能静默覆盖成空） */
async function readPrev() {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'))
    return prev.bySpecies ?? {}
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw new Error(`现有 ${path.relative(ROOT, OUT)} 无法解析（${e.message}）——不覆盖，请先修好或删除该文件`)
  }
}

if (!NO_NET) {
  const key = process.env.ADMIN_KEY
  if (!key) {
    console.error('❌ 缺少 ADMIN_KEY（.env）——或用 --no-net 只读本地文件')
    process.exit(1)
  }
  const origin = (process.env.WORKER_ORIGIN || 'https://uniaoer.com').replace(/\/$/, '')
  // F6（063 §3.4）：**失败必须非零退出**，且绝不写文件。
  // 旧行为是 `exit(0)` + 一句 warn → 调用方（build 链）以为成功，隔离台账静默不更新（"空转"）。
  try {
    const res = await fetch(`${origin}/api/quarantine`, { headers: { 'x-admin-key': key } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data?.items)) {
      // 响应形状变了（字段改名/被 CDN 换成 HTML 等）——**当失败处理**，
      // 否则会 `active = []` → 写空文件 → 已隔离素材全部回到题库（静默事故）
      throw new Error(`响应缺少 items 数组（拿到 ${typeof data?.items}）`)
    }
    const active = data.items.filter((x) => !x.resolved_at)
    bySpecies = normalize(active)
    source = 'd1'
    console.log(`从 D1 拉取隔离项 ${active.length} 条（活跃）`)
    // 从有到无要显式提醒（可能是管理方真的都解除了，也可能是服务端异常）
    const prevCount = Object.keys(await readPrev().catch(() => ({}))).length
    if (prevCount > 0 && Object.keys(bySpecies).length === 0) {
      console.warn(`⚠ 本地原有 ${prevCount} 个物种的隔离项，本次拉取为 0 —— 若并非有意全部解除，请检查 D1`)
    }
  } catch (e) {
    console.error(`❌ 无法从 D1 拉取（${e.message}）——**不写文件**，保留本地已有内容不变`)
    process.exit(1)
  }
} else {
  // 离线：只重算/校验本地文件，绝不凭空造空集合
  try {
    bySpecies = await readPrev()
  } catch (e) {
    console.error(`❌ ${e.message}`)
    process.exit(1)
  }
  source = 'local'
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
