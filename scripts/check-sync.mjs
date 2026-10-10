#!/usr/bin/env node
/**
 * S6/P5：多源一致性校验（防"各处元数据各自漂移"）。
 *
 *   ① 仓库构建产物（唯一事实源）：meta + assets + catalog 自洽
 *   ② R2 发布通道：`species-distribution.json` / `province-commonness.json`（Worker 读取）
 *   ③ D1 派生读模型：物种数 / 有图 / 有音（对齐 meta.universe）
 *   ④ Pages 线上静态：`/data/manifest-meta.json`（前端唯一名单源；部署滞后属警告级）
 *
 * 用法：npm run check:sync（[--strict] 把 Pages 滞后也算失败；[--no-net] 只校验本地层）
 * 退出码：0 一致；1 漂移
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
const NO_NET = !!args['no-net']

await loadEnv(path.join(ROOT, '.env'))
const publicBase = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
const base = publicBase && !/^https?:\/\//i.test(publicBase) ? `https://${publicBase}` : publicBase

const problems = []
const warns = []
const fail = (m) => problems.push(m)
const warn = (m) => warns.push(m)
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

// ── ① 本地：meta / assets / catalog 自洽 ──────────────────────
const meta = await readJson(path.join(ROOT, 'public/data/manifest-meta.json'))
const assetsDir = path.join(ROOT, 'public/data/assets')
const assetFiles = (await fs.readdir(assetsDir)).filter((f) => f.endsWith('.json'))
const declared = [...(meta.buckets || [])].sort()

if (meta.total !== meta.species.length) fail(`本地 meta.total(${meta.total}) ≠ species.length(${meta.species.length})`)
if (JSON.stringify(declared) !== JSON.stringify(assetFiles.map((f) => f.slice(0, -5)).sort())) {
  fail(`meta.buckets(${declared.length}) 与 assets/ 文件(${assetFiles.length}) 不一致——重跑 npm run layers`)
}
try {
  const catalog = await readJson(path.join(ROOT, 'public/data/catalog.json'))
  if (catalog.counts.total !== meta.total) fail(`catalog.total(${catalog.counts.total}) ≠ meta.total(${meta.total})`)
} catch {
  warn('未找到 catalog.json，跳过交叉校验')
}
const expectSpecies = meta.total
const expectWithImg = meta.universe?.withImage ?? 0
const expectWithAud = meta.universe?.withAudio ?? 0
console.log(`① 本地   meta ${expectSpecies} 种 · ${assetFiles.length} 分片 · generatedAt ${meta.generatedAt}`)

// ── ② R2 发布通道（Worker 读取的地区产物） ────────────────────
if (NO_NET) {
  console.log('② R2     （--no-net 跳过）')
} else if (!base) {
  fail('缺少 R2_PUBLIC_BASE（.env）——无法校验 R2 发布通道')
} else {
  const r2Files = ['species-distribution.json', 'province-commonness.json']
  for (const file of r2Files) {
    try {
      const res = await fetch(`${base}/data/${file}`, { headers: { 'cache-control': 'no-cache' } })
      if (!res.ok) fail(`R2 ${file}: HTTP ${res.status}（未上传？跑 npm run sync:prod）`)
      else console.log(`② R2     ${file} ✓`)
    } catch (e) {
      fail(`R2 ${file}: ${e.message}`)
    }
  }
}

// ── ③ D1 派生读模型 ──────────────────────────────────────────
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
          "UNION ALL SELECT 'count_with_img', CAST(COUNT(*) AS TEXT) FROM species WHERE img_url IS NOT NULL " +
          "UNION ALL SELECT 'count_with_aud', CAST(COUNT(*) AS TEXT) FROM species WHERE aud_url IS NOT NULL " +
          'UNION ALL SELECT key, value FROM meta',
        '--remote', '--json',
      ],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
    )
    const jsonText = stdout.slice(stdout.indexOf('['), stdout.lastIndexOf(']') + 1)
    const rows = JSON.parse(jsonText)[0]?.results || []
    const kv = Object.fromEntries(rows.map((r) => [r.k, r.v]))
    const checks = [
      ['count_species', String(expectSpecies)],
      ['count_with_img', String(expectWithImg)],
      ['count_with_aud', String(expectWithAud)],
      ['seed_species', String(expectSpecies)],
    ]
    let ok = true
    for (const [k, want] of checks) {
      const got = kv[k]
      if (got !== want) {
        ok = false
        fail(`D1 ${k} 漂移：${got ?? '(缺失)'} ≠ 期望 ${want}`)
      }
    }
    if (ok) console.log(`③ D1     species ${kv.count_species}（有图 ${kv.count_with_img} / 有音 ${kv.count_with_aud}）`)
  } catch (e) {
    fail(`D1 查询失败：${(e.stderr || e.message || '').toString().split('\n').slice(0, 3).join(' / ')}`)
  }
}

// ── ④ Pages 线上静态（前端唯一名单源；滞后属常态） ────────────
if (!NO_NET) {
  const origin = 'https://uniaoer.com'
  try {
    const res = await fetch(`${origin}/data/manifest-meta.json`, { headers: { 'cache-control': 'no-cache' } })
    if (!res.ok) {
      warn(`Pages /data/manifest-meta.json HTTP ${res.status}（未部署？git push 触发 Pages 构建）`)
    } else {
      const doc = await res.json()
      if (doc.generatedAt !== meta.generatedAt) {
        warn(`Pages 线上 meta.generatedAt(${doc.generatedAt}) ≠ 本地(${meta.generatedAt})——提交尚未部署到 Pages`)
      } else if (doc.total !== meta.total) {
        warn(`Pages 线上 meta.total(${doc.total}) ≠ 本地(${meta.total})`)
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
