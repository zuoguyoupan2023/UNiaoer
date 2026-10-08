#!/usr/bin/env node
/**
 * 029 M5:一条命令把构建产物同步到两个消费端（三源收敛）。
 *
 *   唯一事实源：仓库构建产物（public/data/*）
 *     ├─ R2 `data/manifest*.json`   发布通道 —— /api/manifest* 优先读它
 *     └─ D1 species/media/meta     派生读模型 —— B5 动态出题读它
 *
 * 流程（失败即停，不吞错）：
 *   1) 刷新分层产物（core / assets 分片 / global.min，由 manifest + 采集台账派生）
 *   2) 上传 R2：manifest.json / manifest-core.json / manifest-global.min.json（带 --remote）
 *   3) 生成 D1 seed（scripts/gen-d1-seed.mjs）
 *   4) D1 远端：先 schema.sql（重建派生读模型）再分块执行 seed（进度打印）
 *   5) check:sync 三源一致性校验（漂移即非零退出）
 *
 * 用法：
 *   npm run sync:prod                 # 全流程
 *   npm run sync:prod -- --skip-r2    # 只同步 D1
 *   npm run sync:prod -- --skip-d1    # 只同步 R2
 *   npm run sync:prod -- --dry        # 只打印计划（不写任何远端）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loadEnv, parseArgs, sleep } from './lib/util.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const SKIP_R2 = !!args['skip-r2']
const SKIP_D1 = !!args['skip-d1']
const DRY = !!args.dry
const CHUNK_BYTES = args['chunk-bytes'] ? Number(args['chunk-bytes']) : 2_500_000
const DB = 'uniaoer'

await loadEnv(path.join(ROOT, '.env'))
const bucket = process.env.R2_BUCKET
if (!SKIP_R2 && !bucket) {
  console.error('❌ 缺少 R2_BUCKET（写到 .env）')
  process.exit(1)
}

const wrangler = (argv, opts = {}) =>
  execFileP('npx', ['--yes', 'wrangler', ...argv], {
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  })

function step(title) {
  console.log(`\n──────── ${title} ────────`)
}

// ─────────────────────────────────────────────
step('1/5 刷新分层产物（core / assets / global.min）')
// ─────────────────────────────────────────────
{
  const { writeManifestLayers } = await import('./build-manifest-layers.mjs')
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest.json'), 'utf8'))
  const stats = await writeManifestLayers(manifest)
  if (stats.coreBytes > 1_800_000) console.warn(`⚠ core 超 1.8MB 参考线（${(stats.coreBytes / 1e6).toFixed(2)}MB）`)
}

// ─────────────────────────────────────────────
step(SKIP_R2 ? '2/5 R2 上传（--skip-r2 跳过）' : '2/5 上传 R2（发布通道，--remote）')
// ─────────────────────────────────────────────
// 发布通道文件：题库三层 + 区系矩阵（Worker 地区过滤读它）
const R2_FILES = ['manifest.json', 'manifest-core.json', 'manifest-global.min.json', 'species-distribution.json']
if (!SKIP_R2) {
  for (const file of R2_FILES) {
    const local = path.join(ROOT, 'public/data', file)
    const size = (await fs.stat(local)).size
    if (DRY) {
      console.log(`  [dry] ${file}（${(size / 1e6).toFixed(2)}MB）→ r2://${bucket}/data/${file}`)
      continue
    }
    process.stdout.write(`  ↑ ${file}（${(size / 1e6).toFixed(2)}MB）… `)
    await wrangler([
      'r2', 'object', 'put', `${bucket}/data/${file}`,
      '--file', local,
      '--content-type', 'application/json; charset=utf-8',
      '--cache-control', 'public, max-age=300',
      '--remote',
    ])
    console.log('ok')
  }
}

// ─────────────────────────────────────────────
step('3/5 生成 D1 seed（核心 5+5 + 全球 1+1）')
// ─────────────────────────────────────────────
if (!DRY) {
  await execFileP('node', ['scripts/gen-d1-seed.mjs'], { cwd: ROOT, stdio: 'inherit' }).catch((e) => {
    if (e.stdout) process.stdout.write(e.stdout)
    if (e.stderr) process.stderr.write(e.stderr)
    throw e
  })
} else {
  console.log('  [dry] node scripts/gen-d1-seed.mjs')
}

// ─────────────────────────────────────────────
step(SKIP_D1 ? '4/5 D1 重建（--skip-d1 跳过）' : '4/5 D1 远端重建（派生读模型：schema + seed）')
// ─────────────────────────────────────────────
if (!SKIP_D1) {
  if (DRY) {
    console.log(`  [dry] wrangler d1 execute ${DB} --file=worker/schema.sql --remote`)
  } else {
    // 写入预检（2026-10-08 事故：DROP 成功后才在 seed 处撞上 D1 每日写入额度，
    // 留下"表结构在、数据空"的状态）——先写一行 meta 试探可写性，不可写就整段跳过，
    // 绝不在无法完成重建时先删旧数据。
    process.stdout.write('  · 写入预检（meta 探针）… ')
    try {
      // 探针自带建表（DDL 不占"行写入"额度），对全新库同样成立
      await wrangler([
        'd1', 'execute', DB, '--command',
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
          "INSERT OR REPLACE INTO meta (key,value) VALUES ('sync_probe', strftime('%s','now'));",
        '--remote',
      ])
      console.log('ok')
    } catch (e) {
      // wrangler 的错误对象结构不定（stderr/stdout/message 都可能为空），
      // 故对整个错误做一次字符串化再匹配关键词。
      let msg = ''
      try {
        msg = [e?.stderr, e?.stdout, e?.message].filter(Boolean).join('\n')
        if (!msg) msg = JSON.stringify(e) ?? ''
      } catch {
        msg = String(e)
      }
      console.log('✗')
      if (/RESET_DO|daily|exceed|over|limit/i.test(msg)) {
        const now = new Date()
        const nextUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
        const hours = ((nextUtc - now.getTime()) / 3.6e6).toFixed(1)
        console.error(
          `\n❌ D1 每日写入额度已用尽（免费额度 10 万行/天，00:00 UTC 重置）。\n` +
            `   当前库仍是上一次同步的内容，**未做任何破坏性操作**。\n` +
            `   约 ${hours} 小时后（UTC ${new Date(nextUtc).toISOString().slice(0, 16)}）重跑：npm run sync:prod -- --skip-r2\n` +
            `   另请运行 wrangler d1 info ${DB} 查看 rows_written_24h 确认消耗来源。`,
        )
        process.exit(2)
      }
      throw e
    }
    process.stdout.write(`  · schema.sql（重建 species/questions，保留 reports/meta）… `)
    await wrangler(['d1', 'execute', DB, '--file=worker/schema.sql', '--remote'])
    console.log('ok')

    // seed 分块执行：单次请求体过大易失败，按字节预算切块（语句均为单行,行边界安全）
    const seedText = await fs.readFile(path.join(ROOT, 'worker/seed.sql'), 'utf8')
    const lines = seedText.split('\n')
    const chunks = []
    let cur = []
    let curBytes = 0
    for (const line of lines) {
      cur.push(line)
      curBytes += Buffer.byteLength(line) + 1
      if (curBytes >= CHUNK_BYTES) {
        chunks.push(cur.join('\n'))
        cur = []
        curBytes = 0
      }
    }
    if (cur.length) chunks.push(cur.join('\n'))
    const chunkDir = path.join(ROOT, 'data-cache/d1-seed')
    await fs.mkdir(chunkDir, { recursive: true })

    console.log(`  · seed.sql 分 ${chunks.length} 块执行（每块 ≤${(CHUNK_BYTES / 1e6).toFixed(1)}MB）`)
    for (let i = 0; i < chunks.length; i++) {
      const file = path.join(chunkDir, `chunk-${String(i + 1).padStart(2, '0')}.sql`)
      await fs.writeFile(file, chunks[i])
      process.stdout.write(`    [${i + 1}/${chunks.length}] ${(Buffer.byteLength(chunks[i]) / 1e6).toFixed(2)}MB … `)
      await wrangler(['d1', 'execute', DB, '--file', file, '--remote'])
      console.log('ok')
      await sleep(300)
    }
  }
}

// ─────────────────────────────────────────────
step('5/5 三源一致性校验（check:sync）')
// ─────────────────────────────────────────────
if (DRY) {
  console.log('  [dry] node scripts/check-sync.mjs')
} else {
  try {
    const { stdout, stderr } = await execFileP('node', ['scripts/check-sync.mjs'], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
    process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout)
    if (e.stderr) process.stderr.write(e.stderr)
    console.error('\n❌ sync:prod 完成但一致性校验未通过（见上）')
    process.exit(1)
  }
}

console.log('\n✅ sync:prod 完成：仓库 → R2（发布通道）+ D1（派生读模型）已一致')
