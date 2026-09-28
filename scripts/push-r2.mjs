#!/usr/bin/env node
/**
 * 用 wrangler 把 public/media 上传到 R2（不需要 S3 凭证，用 Cloudflare 登录态）
 * 前置：
 *   1) npm run bank:stage      # 抓取→转码→暂存到 public/media，manifest 指向 R2
 *   2) wrangler login          # 一次性登录
 *   3) .env 里设置 R2_BUCKET
 *
 * 用法：
 *   npm run r2:push                       # 全量上传
 *   npm run r2:push -- --retry-failed     # 只重传上次失败的文件
 *
 * 失败清单：data-cache/r2-failed.json（成功重传的会自动从清单移除）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEnv, mapPool, parseArgs, sleep } from './lib/util.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await loadEnv(path.join(ROOT, '.env'))
const args = parseArgs(process.argv.slice(2))
const bucket = process.env.R2_BUCKET
if (!bucket) {
  console.error('❌ 缺少 R2_BUCKET（写到 .env）')
  process.exit(1)
}

const MEDIA_DIR = path.join(ROOT, 'public/media')
const LOG = path.join(ROOT, 'data-cache/r2-failed.json')
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 4
const TRIES = args.tries ? Number(args.tries) : 3

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

async function readFailed() {
  try {
    const d = JSON.parse(await fs.readFile(LOG, 'utf8'))
    return d.failures || []
  } catch {
    return []
  }
}
async function writeFailed(failures) {
  await fs.mkdir(path.dirname(LOG), { recursive: true })
  await fs.writeFile(
    LOG,
    JSON.stringify({ generatedAt: new Date().toISOString(), bucket, count: failures.length, failures }, null, 2),
  )
}

// 目标列表（rel 相对 public/media，如 media/<id>/image.full.webp）
let rels
if (args['retry-failed']) {
  rels = (await readFailed()).map((f) => f.rel).filter(Boolean)
  if (!rels.length) {
    console.log('✅ 没有待重传的失败记录（data-cache/r2-failed.json 为空）。')
    process.exit(0)
  }
  console.log(`♻️  仅重传上次失败 ${rels.length} 个文件…\n`)
} else {
  rels = (await walk(MEDIA_DIR)).map((f) => 'media/' + path.relative(MEDIA_DIR, f).split(path.sep).join('/'))
  if (!rels.length) {
    console.error('❌ public/media 为空，请先运行 `npm run bank:stage`')
    process.exit(1)
  }
  console.log(`⬆️  上传 ${rels.length} 个文件到 R2 桶「${bucket}」的 media/ 下（并发 ${CONCURRENCY}，重试 ${TRIES}）…\n`)
}

async function uploadOne(rel) {
  const file = path.join(MEDIA_DIR, rel.replace(/^media\//, ''))
  let lastMsg = ''
  for (let i = 0; i < TRIES; i++) {
    try {
      await execFileP(
        'npx',
        ['--yes', 'wrangler', 'r2', 'object', 'put', `${bucket}/${rel}`, '--file', file, '--remote'],
        { cwd: ROOT },
      )
      return { ok: true }
    } catch (e) {
      lastMsg = (e.stderr?.toString?.() || e.stdout?.toString?.() || e.message || '').trim().split('\n')[0]
      if (i < TRIES - 1) await sleep(1500 * (i + 1))
    }
  }
  return { ok: false, msg: lastMsg }
}

let ok = 0
let done = 0
const failures = []
await mapPool(rels, CONCURRENCY, async (rel) => {
  const r = await uploadOne(rel)
  done++
  if (r.ok) {
    ok++
    console.log(`   ↑ [${String(done).padStart(5)}/${rels.length}]`, rel)
  } else {
    failures.push({ rel, msg: r.msg })
    console.error(`   ✗ [${String(done).padStart(5)}/${rels.length}]`, rel, r.msg)
  }
})

await writeFailed(failures)

console.log(`\n${failures.length ? '⚠️' : '✅'} 成功 ${ok} / ${rels.length}`)
if (failures.length) {
  console.log(`\n❌ 仍有 ${failures.length} 个失败（已写入 data-cache/r2-failed.json）：`)
  failures.forEach((f) => console.log(`   · ${f.rel}  →  ${f.msg}`))
  console.log('\n→ 网络恢复后执行：npm run r2:push -- --retry-failed')
  process.exit(1)
}
console.log('\n✅ 全部完成。别忘了在 R2 → Settings → CORS 里允许你的站点来源。')
