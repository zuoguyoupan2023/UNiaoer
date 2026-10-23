#!/usr/bin/env node
/**
 * 把 `public/data` 下的**某个目录**推到 R2（S3 直传，走 .env 的 R2_* 凭证）。
 *
 * 用途（2026-10-23 用户定）：省级**出题档位分片**（`province-commonness/`，194 国 / 365 片 / 18MB）
 * 只推 R2、不进 git —— Worker 出题时读 `R2 data/province-commonness/<CC>.json`。
 * 前端读的地区展示产物（region-provinces / region-species / region-records）仍由 Pages 静态伺服，**不需要推 R2**。
 *
 * 铁律 9：这是**云端写**。执行前先 `--dry` 看清单，确认后才真传；
 * 回滚 = 重传上一版同名对象（R2 无版本，覆盖即替换）/ 或删除该前缀下对象。
 *
 * CLI：
 *   node scripts/push-r2-data.mjs --dir public/data/province-commonness --dry
 *   node scripts/push-r2-data.mjs --dir public/data/province-commonness [--prefix data/province-commonness]
 *                                  [--concurrency 8] [--only US.json,CN.json]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEnv, mapPool, parseArgs } from './lib/util.mjs'
import { makeR2 } from './lib/r2.mjs'

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await loadEnv(path.join(ROOT, '.env'))

const args = parseArgs(process.argv.slice(2))
const dirArg = String(args.dir || '').trim()
if (!dirArg) {
  console.error('用法：node scripts/push-r2-data.mjs --dir public/data/<目录> [--prefix data/<目录>] [--dry]')
  process.exit(1)
}
const DIR = path.resolve(ROOT, dirArg)
const base = path.basename(DIR)
const PREFIX = String(args.prefix || `data/${base}`).replace(/^\/+|\/+$/g, '')
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 8)
const DRY = !!args.dry
const ONLY = String(args.only || '').split(',').map((s) => s.trim()).filter(Boolean)

const R2 = makeR2()
/**
 * 两条上传通道（铁律：必须 `--remote`，绝不写本地 `.wrangler/state`）：
 *   ① S3 直传（R2_ACCOUNT_ID/KEY 齐全时，最快）；
 *   ② 否则退回 `wrangler r2 object put ... --remote`（用本机 Cloudflare 登录态，慢一些）。
 */
const BUCKET = process.env.R2_BUCKET
const USE_S3 = R2.ready
if (!USE_S3 && !DRY && !BUCKET) {
  console.error('❌ 既没有 S3 凭证，也没有 R2_BUCKET：无法上传')
  process.exit(1)
}

const files = (await fs.readdir(DIR).catch(() => []))
  .filter((f) => f.endsWith('.json') && (!ONLY.length || ONLY.includes(f)))
  .sort()
if (!files.length) {
  console.error(`❌ ${path.relative(ROOT, DIR)} 下没有 .json（先构建）`)
  process.exit(1)
}

let total = 0
for (const f of files) total += (await fs.stat(path.join(DIR, f))).size
console.log(
  `→ ${files.length} 个对象 / ${(total / 1e6).toFixed(2)}MB → R2 ${PREFIX}/` +
    (DRY ? '（--dry：只列清单，不写云端）' : USE_S3 ? '（S3 直传）' : '（wrangler --remote）'),
)

if (!DRY) {
  let done = 0
  const failed = []
  await mapPool(files, CONCURRENCY, async (f) => {
    const file = path.join(DIR, f)
    try {
      if (USE_S3) {
        const body = await fs.readFile(file)
        await R2.put(`${PREFIX}/${f}`, body, 'application/json; charset=utf-8')
      } else {
        // wrangler 走 Cloudflare API，偶发 `fetch request failed`（实测批量上传时约 1-2%）→ 单文件重试 3 次
        let lastErr = null
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await execFileP(
              'npx',
              [
                'wrangler', 'r2', 'object', 'put', `${BUCKET}/${PREFIX}/${f}`,
                `--file=${file}`,
                '--content-type=application/json; charset=utf-8',
                '--remote',
              ],
              { cwd: ROOT, timeout: 180_000 },
            )
            lastErr = null
            break
          } catch (e) {
            lastErr = e
            await new Promise((r) => setTimeout(r, 1500 * attempt))
          }
        }
        if (lastErr) throw lastErr
      }
      if (++done % 50 === 0) console.log(`  … ${done}/${files.length}`)
    } catch (e) {
      failed.push(`${f}: ${String(e?.stderr || e?.message || e).slice(0, 200)}`)
    }
  })
  console.log(`✓ 上传完成：${files.length - failed.length}/${files.length}`)
  if (failed.length) {
    console.error(`✗ 失败 ${failed.length}：\n  - ${failed.slice(0, 10).join('\n  - ')}`)
    process.exit(1)
  }
} else {
  for (const f of files.slice(0, 8)) console.log(`  · ${PREFIX}/${f}`)
  if (files.length > 8) console.log(`  … 其余 ${files.length - 8} 个`)
}
