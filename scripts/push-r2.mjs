#!/usr/bin/env node
/**
 * 用 wrangler 把 public/media 上传到 R2（不需要 S3 凭证，用 Cloudflare 登录态）
 * 前置：
 *   1) npm run bank:stage      # 抓取→转码→暂存到 public/media，manifest 指向 R2
 *   2) wrangler login          # 一次性登录
 *   3) .env 里设置 R2_BUCKET
 * 用法：npm run r2:push
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEnv } from './lib/util.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await loadEnv(path.join(ROOT, '.env'))
const bucket = process.env.R2_BUCKET
if (!bucket) {
  console.error('❌ 缺少 R2_BUCKET（写到 .env）')
  process.exit(1)
}

const MEDIA_DIR = path.join(ROOT, 'public/media')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const files = await walk(MEDIA_DIR)
if (!files.length) {
  console.error('❌ public/media 为空，请先运行 `npm run bank:stage`')
  process.exit(1)
}

console.log(`⬆️  上传 ${files.length} 个文件到 R2 桶「${bucket}」的 media/ 下…\n`)

let ok = 0
const failures = []
for (const file of files) {
  const rel = 'media/' + path.relative(MEDIA_DIR, file).split(path.sep).join('/')
  try {
    // 关键：--remote 才会写进真实的 R2 桶；不加则默认写本地模拟存储
    await execFileP(
      'npx',
      ['--yes', 'wrangler', 'r2', 'object', 'put', `${bucket}/${rel}`, '--file', file, '--remote'],
      { cwd: ROOT },
    )
    ok++
    console.log('   ↑', rel)
  } catch (e) {
    const msg = (e.stderr?.toString?.() || e.stdout?.toString?.() || e.message || '').trim()
    failures.push({ rel, msg })
    console.error('   ✗', rel, msg.split('\n')[0])
  }
}

console.log(`\n${failures.length ? '❌' : '✅'} 成功 ${ok} / ${files.length}`)
if (failures.length) {
  console.error('\n首个错误详情：\n' + failures[0].msg)
  console.error('\n常见原因：未 `wrangler login`、桶名不对、账号无权限。')
  process.exit(1)
}
console.log('\n✅ 全部完成。别忘了在 R2 → Settings → CORS 里允许你的站点来源。')
