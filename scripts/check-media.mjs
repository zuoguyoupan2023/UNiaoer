#!/usr/bin/env node
/**
 * A4 媒体完整性检查
 * 对 manifest 里每一个媒体 URL 做 HEAD（并发受限），产出缺失/不可达清单：
 *   - R2 媒体不可达 → 尝试 --fix：若 public/media 里有同名文件，用 wrangler r2 object put --remote 重传
 *   - 本地也没有 → 提示重跑 `npm run bank:stage`（有 data-cache，很便宜）再 `npm run r2:push`
 *
 * 用法：node scripts/check-media.mjs [--concurrency 6] [--fix] [--manifest public/data/manifest.json]
 * 输出：data-cache/media-missing.json（最终仍缺失的清单）
 * 退出码：0 全部可达；1 仍有缺失
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { parseArgs, loadEnv, mapPool } from './lib/util.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))

await loadEnv(path.join(ROOT, '.env'))
const BUCKET = process.env.R2_BUCKET || ''
const MANIFEST = path.resolve(ROOT, args.manifest || 'public/data/manifest.json')
const PUBLIC_MEDIA = path.join(ROOT, 'public/media')
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 6

async function headStatus(url) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    clearTimeout(timer)
    return res.status
  } catch {
    return 0 // 网络/超时
  }
}

/** https://host/media/<id>/<file> → <id>/<file>（R2 键相对 media/），非 /media/ 路径返回 null */
function r2KeyOf(url) {
  const m = String(url).match(/^https?:\/\/[^/]+\/media\/(.+)$/)
  return m ? m[1] : null
}

async function wranglerPut(key, file) {
  // 铁律：--remote 才写真桶
  await execFileP(
    'npx',
    ['--yes', 'wrangler', 'r2', 'object', 'put', `${BUCKET}/media/${key}`, '--file', file, '--remote'],
    { cwd: ROOT },
  )
}

const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
const targets = []
for (const sp of manifest.species) {
  for (const kind of ['image', 'audio']) {
    const a = sp[kind]
    if (!a?.url) continue
    // 主文件 + 派生图（thumb/xl/avif）一并检查
    for (const field of ['url', 'thumbUrl', 'xlUrl', 'avifUrl']) {
      const u = a[field]
      if (u) targets.push({ speciesId: sp.id, kind: `${kind}.${field}`, url: u })
    }
  }
}

console.log(`🔍 检查 ${targets.length} 个媒体 URL（并发 ${CONCURRENCY}）…\n`)
const results = await mapPool(targets, CONCURRENCY, async (t) => {
  const status = await headStatus(t.url)
  const ok = status >= 200 && status < 300
  console.log(`   ${ok ? '✓' : '✗'} [${status || 'ERR'}] ${t.speciesId}/${t.kind}`)
  return { ...t, status, ok }
})

const missing = results.filter((r) => !r.ok)
if (!missing.length) {
  console.log(`\n✅ 全部 ${results.length} 个媒体可达。`)
  process.exit(0)
}

console.log(`\n❌ 不可达 ${missing.length} 个：`)
missing.forEach((m) => console.log(`   · [${m.status || 'ERR'}] ${m.speciesId}/${m.kind}: ${m.url}`))

// ---- --fix：本地有就重传 ----
if (args.fix) {
  if (!BUCKET) {
    console.error('\n❌ --fix 需要 .env 里的 R2_BUCKET')
    process.exit(1)
  }
  console.log(`\n🔧 尝试从 public/media 重传缺失文件（wrangler --remote）…`)
  const stillMissing = []
  for (const m of missing) {
    const key = r2KeyOf(m.url)
    const local = key ? path.join(PUBLIC_MEDIA, key) : null
    if (!local) {
      stillMissing.push(m)
      continue
    }
    if (!(await fs.access(local).then(() => true, () => false))) {
      console.log(`   ⏭️  本地不存在，待补抓：media/${key}`)
      stillMissing.push(m)
      continue
    }
    try {
      await wranglerPut(key, local)
      const status = await headStatus(m.url)
      if (status >= 200 && status < 300) {
        console.log(`   ↑ 已重传并验证：media/${key}`)
      } else {
        console.log(`   ⚠️  重传后仍 [${status}]：media/${key}`)
        stillMissing.push(m)
      }
    } catch (e) {
      console.log(`   ✗ 重传失败：media/${key} → ${String(e.stderr || e.message).split('\n')[0]}`)
      stillMissing.push(m)
    }
  }

  if (!stillMissing.length) {
    console.log(`\n✅ --fix 完成：全部缺失文件已重传并验证。`)
    process.exit(0)
  }
  console.log(`\n⚠️  仍有 ${stillMissing.length} 个无法通过重传解决：`)
  stillMissing.forEach((m) => console.log(`   · ${m.speciesId}/${m.kind}: ${m.url}`))
  console.log(`\nℹ️  本地也缺失的，请重跑 \`npm run bank:stage\`（data-cache 命中，只补下载）+ \`npm run r2:push\``)
  await fs.mkdir(path.join(ROOT, 'data-cache'), { recursive: true })
  await fs.writeFile(
    path.join(ROOT, 'data-cache/media-missing.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), missing: stillMissing }, null, 2),
  )
  console.log('   清单已写入 data-cache/media-missing.json')
  process.exit(1)
}

// 非 --fix：只落清单
await fs.mkdir(path.join(ROOT, 'data-cache'), { recursive: true })
await fs.writeFile(
  path.join(ROOT, 'data-cache/media-missing.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), missing }, null, 2),
)
console.log('\nℹ️  清单已写入 data-cache/media-missing.json；本地有同名文件可加 --fix 重传。')
process.exit(1)
