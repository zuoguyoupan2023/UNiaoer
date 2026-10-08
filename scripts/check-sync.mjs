#!/usr/bin/env node
/**
 * 029 M5:三源一致性校验（防"三处元数据各自漂移"，如 Pages 构建覆盖 manifest 类事故）。
 *
 *   ① 仓库构建产物（唯一事实源；本脚本的直接输入）
 *   ② R2 发布通道（/api/manifest* 优先读）——比对 generatedAt/total
 *   ③ D1 派生读模型 —— 比对 meta 指纹 + 实际行数
 *   ④ Pages 线上静态（警告级：部署滞后于提交属常态，不算失败）
 *
 * 用法：npm run check:sync（[--strict] 把 Pages 滞后也算失败）
 * 退出码：0 一致；1 漂移（附修复提示：npm run sync:prod）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loadEnv, parseArgs } from './lib/util.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const STRICT = !!args.strict
const NO_NET = !!args['no-net'] // 离线：只校验本地层(self-consistency)

await loadEnv(path.join(ROOT, '.env'))
const publicBase = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
const base = publicBase && !/^https?:\/\//i.test(publicBase) ? `https://${publicBase}` : publicBase

const problems = []
const warns = []
const fail = (m) => problems.push(m)
const warn = (m) => warns.push(m)

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

// ── ① 本地：分层产物与完整层自洽 ──────────────────────────────
const core = await readJson(path.join(ROOT, 'public/data/manifest-core.json'))
const full = await readJson(path.join(ROOT, 'public/data/manifest.json'))
const global = await readJson(path.join(ROOT, 'public/data/manifest-global.min.json')).catch(() => null)
const assetsDir = path.join(ROOT, 'public/data/assets')
const assetFiles = (await fs.readdir(assetsDir)).filter((f) => f.endsWith('.json'))
const declared = [...(core.buckets || [])].sort()

if (core.generatedAt !== full.generatedAt) {
  fail(`本地 core.generatedAt(${core.generatedAt}) ≠ manifest.generatedAt(${full.generatedAt})——重跑 npm run layers`)
}
if (core.total !== full.species.length) fail(`本地 core.total(${core.total}) ≠ manifest 物种数(${full.species.length})`)
if (JSON.stringify(declared) !== JSON.stringify(assetFiles.map((f) => f.slice(0, -5)).sort())) {
  fail(`core.buckets(${declared.length}) 与 assets/ 文件(${assetFiles.length}) 不一致——重跑 npm run layers`)
}
console.log(`① 本地   core ${core.total} 种 · ${assetFiles.length} 分片 · generatedAt ${core.generatedAt}`)

// 期望的 D1 行数（从本地产物直接算）
const expectSpecies = core.total + (global?.species?.length || 0)
const countMedia = (sp) =>
  ((sp.images?.length || 0) || (sp.image ? 1 : 0)) + ((sp.audios?.length || 0) || (sp.audio ? 1 : 0))
const expectMedia =
  full.species.reduce((n, sp) => n + countMedia(sp), 0) +
  (global?.species?.reduce((n, sp) => n + countMedia(sp), 0) || 0)

// ── ② R2 发布通道 ───────────────────────────────────────────
if (NO_NET) {
  console.log('② R2     （--no-net 跳过）')
} else if (!base) {
  fail('缺少 R2_PUBLIC_BASE（.env）——无法校验 R2 发布通道')
} else {
  const r2Checks = [
    ['manifest.json', full.generatedAt, full.species.length],
    ['manifest-core.json', core.generatedAt, core.total],
    ...(global ? [['manifest-global.min.json', global.generatedAt, global.species.length]] : []),
  ]
  for (const [file, wantAt, wantTotal] of r2Checks) {
    try {
      const res = await fetch(`${base}/data/${file}`, { headers: { 'cache-control': 'no-cache' } })
      if (!res.ok) {
        fail(`R2 ${file}: HTTP ${res.status}（未上传？跑 npm run sync:prod）`)
        continue
      }
      const doc = await res.json()
      const gotTotal = doc.total ?? doc.species?.length
      if (doc.generatedAt !== wantAt) fail(`R2 ${file} generationAt 漂移：${doc.generatedAt} ≠ 本地 ${wantAt}`)
      if (gotTotal !== wantTotal) fail(`R2 ${file} total 漂移：${gotTotal} ≠ 本地 ${wantTotal}`)
      console.log(`② R2     ${file} ✓（${doc.generatedAt}）`)
    } catch (e) {
      fail(`R2 ${file}: ${e.message}`)
    }
  }
}

// ── ③ D1 派生读模型 ─────────────────────────────────────────
if (NO_NET) {
  console.log('③ D1     （--no-net 跳过）')
} else {
  try {
    const { stdout } = await execFileP(
      'npx',
      [
        '--yes', 'wrangler', 'd1', 'execute', 'uniaoer',
        '--command',
        "SELECT 'count_species' AS k, CAST(COUNT(*) AS TEXT) AS v FROM species " +
          "UNION ALL SELECT 'count_media', CAST(COUNT(*) AS TEXT) FROM media " +
          'UNION ALL SELECT key, value FROM meta',
        '--remote', '--json',
      ],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
    )
    const jsonText = stdout.slice(stdout.indexOf('['), stdout.lastIndexOf(']') + 1)
    const rows = JSON.parse(jsonText)[0]?.results || []
    const kv = Object.fromEntries(rows.map((r) => [r.k, r.v]))
    const checks = [
      ['manifest_generatedAt', core.generatedAt],
      ['global_generatedAt', global?.generatedAt || ''],
      ['count_species', String(expectSpecies)],
      ['count_media', String(expectMedia)],
      ['seed_species', String(expectSpecies)],
      ['seed_media', String(expectMedia)],
    ]
    let ok = true
    for (const [k, want] of checks) {
      const got = kv[k]
      if (got !== want) {
        ok = false
        fail(`D1 ${k} 漂移：${got ?? '(缺失)'} ≠ 期望 ${want}`)
      }
    }
    if (ok) {
      console.log(
        `③ D1     species ${kv.count_species} · media ${kv.count_media} · seed_at ${kv.seed_at}`,
      )
    }
  } catch (e) {
    fail(`D1 查询失败：${(e.stderr || e.message || '').toString().split('\n').slice(0, 3).join(' / ')}`)
  }
}

// ── ④ Pages 线上静态（警告级：部署滞后属常态） ────────────────
if (!NO_NET) {
  const origin = 'https://uniaoer.com'
  try {
    const res = await fetch(`${origin}/data/manifest-core.json`, { headers: { 'cache-control': 'no-cache' } })
    if (!res.ok) {
      warn(`Pages /data/manifest-core.json HTTP ${res.status}（未部署？git push 触发 Pages 构建）`)
    } else {
      const doc = await res.json()
      if (doc.generatedAt !== core.generatedAt) {
        warn(`Pages 线上 core.generatedAt(${doc.generatedAt}) ≠ 本地(${core.generatedAt})——提交尚未部署到 Pages`)
      } else {
        console.log(`④ Pages  ${origin} ✓（${doc.generatedAt}）`)
      }
    }
  } catch (e) {
    warn(`Pages 检查失败：${e.message}`)
  }
}

// ── 结论 ────────────────────────────────────────────────────
if (warns.length) {
  for (const w of warns) console.warn(`⚠ ${w}`)
  if (STRICT) for (const w of warns) fail(`[--strict] ${w}`)
}
if (problems.length) {
  console.error(`\n✗ check:sync 漂移（${problems.length} 项）：`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n修复：npm run sync:prod（或分层不一致时先 npm run layers）')
  process.exit(1)
}
console.log('\n✓ check:sync：仓库 / R2 / D1 三源一致')
