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
import { guardFromArgs } from './lib/cloud-guard.mjs'

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await loadEnv(path.join(ROOT, '.env'))

const args = parseArgs(process.argv.slice(2))
const dirArg = String(args.dir || '').trim()
if (!dirArg) {
  console.error(
    '用法：node scripts/push-r2-data.mjs --dir public/data/<目录> [--prefix data/<目录>] [--only A,B] [--apply]\n' +
      '      默认 dry-run（只打印清单）；加 --apply 才真正写入 R2，且必须在交互式终端里手输确认词。',
  )
  process.exit(1)
}
const DIR = path.resolve(ROOT, dirArg)
const base = path.basename(DIR)
const PREFIX = String(args.prefix || `data/${base}`).replace(/^\/+|\/+$/g, '')
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 8)

/**
 * 铁律 13（2026-11-05）：云端写必须人审。
 * `--apply` 缺省即 dry（默认安全）；真传时要求 TTY + 手输确认词（AI/CI 物理上过不去）。
 */
const MODE = await guardFromArgs(args, {
  op: `push ${base}`,
  summary: `把 ${path.relative(ROOT, DIR)}/ 下的 .json 推到 R2（${PREFIX}/）`,
  targets: [`r2://${process.env.R2_BUCKET || '<bucket>'}/${PREFIX}/`],
  impact:
    '线上立即读到新产物（档位分片会影响出题池与地区口径）；' +
    'Worker 侧边缘缓存最长 1 天后全部生效',
  rollback: '重传上一版同名对象（R2 无版本，覆盖即替换）；或 git checkout 旧产物后重跑本脚本',
  dryRunHint: `node scripts/push-r2-data.mjs --dir ${path.relative(ROOT, DIR)} --dry`,
})
const DRY = MODE === 'dry'
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

/**
 * 同级索引文件（2026-11-05 事故后补）：
 *
 * `public/data/province-commonness.json`（索引：元数据 + sharding 清单）**不在**分片目录里，
 * 而是目录的**兄弟文件**。此前本脚本只 `readdir(DIR)`，于是「重推分片」永远不会更新索引，
 * 造成 R2 上索引停在 2026-10-22（58 片 / 621 省码 / 5 档）、分片却是新版的撕裂状态，
 * 而 `check:tiers` 的 R3 会一直报「索引 ≠ 本地索引」。
 *
 * 规则：若 `public/data/<base>.json` 存在，就与分片一起推（同一次操作、同一个确认词），
 * 避免"分片推了、索引忘了"。这是数据一致性要求，不是可选优化。
 */
const sidecar = path.join(path.dirname(DIR), `${base}.json`)
const sidecarExists = await fs
  .stat(sidecar)
  .then((s) => s.isFile())
  .catch(() => false)

let total = 0
for (const f of files) total += (await fs.stat(path.join(DIR, f))).size
const sidecarSize = sidecarExists ? (await fs.stat(sidecar)).size : 0
console.log(
  `→ ${files.length} 个对象 / ${(total / 1e6).toFixed(2)}MB → R2 ${PREFIX}/` +
    (DRY ? '（--dry：只列清单，不写云端）' : USE_S3 ? '（S3 直传）' : '（wrangler --remote）'),
)
if (sidecarExists) {
  console.log(
    `→ 附带同级索引 data/${base}.json（${(sidecarSize / 1e3).toFixed(0)}KB）——` +
      `与分片必须同版本，否则 check:tiers 的 R3 会报撕裂`,
  )
}

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

  // ── 同级索引：与分片同版本，必须一起推 ──────────────────────────
  if (sidecarExists) {
    const key = `data/${base}.json`
    process.stdout.write(`  ↑ 索引 ${key} … `)
    try {
      if (USE_S3) {
        await R2.put(key, await fs.readFile(sidecar), 'application/json; charset=utf-8')
      } else {
        let lastErr = null
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await execFileP(
              'npx',
              [
                'wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
                `--file=${sidecar}`,
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
      console.log('ok')
    } catch (e) {
      console.error(`失败：${String(e?.stderr || e?.message || e).slice(0, 200)}`)
      console.error('⚠ 分片已上传但索引失败 → R2 处于撕裂状态，重跑本命令即可补齐索引。')
      process.exit(1)
    }
  }
} else {
  for (const f of files.slice(0, 8)) console.log(`  · ${PREFIX}/${f}`)
  if (files.length > 8) console.log(`  … 其余 ${files.length - 8} 个`)
  if (sidecarExists) console.log(`  · data/${base}.json（同级索引）`)
}
