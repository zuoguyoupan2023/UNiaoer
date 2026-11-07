#!/usr/bin/env node
/**
 * 029 M5:一条命令把构建产物同步到两个消费端（三源收敛）。
 *
 *   唯一事实源：仓库构建产物（public/data/*）
 *     ├─ R2 `data/manifest*.json`   发布通道 —— /api/manifest* 优先读它
 *     └─ D1 species/media/meta     派生读模型 —— B5 动态出题读它
 *
 * 流程（每步自动重试 5 次 + 断点续传；额度类错误仍即停）：
 *   进度记于 data-cache/sync-prod-progress.json，中断后重跑只做剩余步骤；
 *   --fresh 忽略断点从头重来（2026-11-07 补：本机对 Cloudflare API 常年不稳，
 *   373 个 R2 put + 8 个 seed 分块裸跑必撞瞬时 fetch failed，见 docs/113）。
 *   1) 刷新分层产物（manifest-meta / assets 分片 / catalog，由核心完整层 + 全球台账派生）
 *   2) 上传 R2：manifest-meta.json / species-distribution.json / province-commonness*（带 --remote）
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
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loadEnv, parseArgs, sleep } from './lib/util.mjs'
import { guard } from './lib/cloud-guard.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const SKIP_R2 = !!args['skip-r2']
const SKIP_D1 = !!args['skip-d1']
/**
 * `--fresh`：忽略断点进度，从头重跑（缺省：存在进度文件则自动续传，见下）。
 * 2026-11-07 补：本机到 Cloudflare API 的网络常年不稳（AGENTS.md 铁律 8），一次全量
 * 同步含 373 个 R2 put + 8 个 seed 分块，裸跑必然撞上瞬时 `fetch failed`，而本脚本是
 * 「失败即停」设计 → 用户被迫一遍遍从头重跑。现改为「每步重试 + 断点续传」。
 */
const FRESH = !!args.fresh
/**
 * 铁律 13（2026-11-05）：本脚本同时写 R2 与 D1，属最高危云端操作。
 * `--apply` 缺省即 dry；真跑时要求 TTY + 手输确认词。
 */
const MODE = await guard({
  op: args.apply ? 'sync prod' : 'sync prod (dry)',
  dry: !args.apply || !!args.dry,
  summary: [
    SKIP_R2 ? null : '重传 R2 发布通道（manifest-meta / species-distribution / province-commonness 索引 + 全部分片）',
    SKIP_D1 ? null : '重建 D1 远端读模型（schema.sql + 全量 seed，约 43,410 行写入）',
  ]
    .filter(Boolean)
    .join('；'),
  targets: [
    ...(SKIP_R2 ? [] : [`r2://${process.env.R2_BUCKET || '<bucket>'}/data/*`]),
    ...(SKIP_D1 ? [] : ['D1 uniaoer（species / questions / meta 等派生读模型）']),
  ],
  impact:
    '线上出题与地区口径立即变化；D1 单次写入约占当日额度 43%（单日最多跑 2 次，跑前用 npm run d1:usage 看额度）',
  rollback:
    'R2：重传上一版同名对象；D1：用旧 seed 重跑（schema.sql 会 DROP 重建，务必先确认有可回滚的旧 seed）',
  dryRunHint: 'npm run sync:prod -- --dry',
})
const DRY = MODE === 'dry'
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

/**
 * 带重试的 wrangler 调用（2026-11-07）。
 *
 * 模式抄自 `push-r2-data.mjs`（单文件重试 3 次），这里加强为 5 次线性退避：
 * 实测本机对 api.cloudflare.com 的瞬时 `fetch failed` / 503 占批量操作的 1–2%，
 * 一次全量同步 380+ 次调用，不重试必然中途挂（2026-11-07 用户连跑 2 次均中断于 R2 阶段）。
 *
 * 额度类错误（`RESET_DO`/`daily`/`limit`）**不重试**——重试也不会好，直接抛给上层
 * 输出友好提示（见 D1 段的 catch）。
 */
const RETRY_ATTEMPTS = 5
async function wranglerRetry(argv, opts = {}, what = '') {
  let lastErr = null
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const r = await wrangler(argv, opts)
      if (attempt > 1) console.log(`（第 ${attempt} 次尝试成功）`)
      return r
    } catch (e) {
      lastErr = e
      let msg = ''
      try {
        msg = [e?.stderr, e?.stdout, e?.message].filter(Boolean).join('\n')
        if (!msg) msg = JSON.stringify(e) ?? ''
      } catch {
        msg = String(e)
      }
      if (/RESET_DO|daily|exceed|over|limit/i.test(msg)) throw e
      if (attempt < RETRY_ATTEMPTS) {
        const waitMs = 2000 * attempt
        console.warn(
          `  ⚠ ${what || argv.join(' ').slice(0, 60)} 失败（${msg.split('\n')[0].slice(0, 120)}），` +
            `${Math.round(waitMs / 1000)}s 后第 ${attempt + 1}/${RETRY_ATTEMPTS} 次重试…`,
        )
        await sleep(waitMs)
      }
    }
  }
  throw lastErr
}

/**
 * 断点进度文件（`data-cache/` 已 gitignore）。
 * 结构：`{ r2Done: string[], d1: { seedHash, schemaDone, chunksDone: number[] } }`
 * 每完成一步立刻落盘；全部完成后删除。`--fresh` 忽略并从头开始。
 */
const PROGRESS_FILE = path.join(ROOT, 'data-cache/sync-prod-progress.json')
async function loadProgress() {
  if (FRESH) return {}
  try {
    return JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf8'))
  } catch {
    return {}
  }
}
async function saveProgress(p) {
  await fs.mkdir(path.dirname(PROGRESS_FILE), { recursive: true })
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(p, null, 2))
}
async function clearProgress() {
  await fs.rm(PROGRESS_FILE, { force: true })
}

function step(title) {
  console.log(`\n──────── ${title} ────────`)
}

// ─────────────────────────────────────────────
step('1/5 刷新分层产物（meta / assets）')
// ─────────────────────────────────────────────
// 2026-11-05：dry-run 必须**真的只读**。此前 dry 也会跑 writeManifestLayers()，
// 把 public/data/manifest-meta.json / catalog.json 的 generatedAt 刷成当前时间
// （内容等价但产生脏 diff），既污染工作区又让「dry 无害」的承诺失真。
if (DRY) {
  console.log('  [dry] 跳过：npm run layers（writeManifestLayers 会改写 public/data 产物）')
} else {
  const { writeManifestLayers } = await import('./build-manifest-layers.mjs')
  const corePaths = [path.join(ROOT, 'data-cache/manifest-core-full.json'), path.join(ROOT, 'public/data/manifest.json')]
  let manifest = null
  for (const p of corePaths) {
    try {
      manifest = JSON.parse(await fs.readFile(p, 'utf8'))
      break
    } catch {
      /* 试下一个 */
    }
  }
  if (!manifest) {
    console.error('❌ 找不到 core 完整层（data-cache/manifest-core-full.json）——先跑 npm run bank')
    process.exit(1)
  }
  await writeManifestLayers(manifest)
}

// ─────────────────────────────────────────────
step(SKIP_R2 ? '2/5 R2 上传（--skip-r2 跳过）' : '2/5 上传 R2（发布通道，--remote）')
// ─────────────────────────────────────────────
// 发布通道文件：权威名录层（/api/manifest-meta 优先读）+ 区系矩阵（Worker 地区过滤读它）+ 省级常见度（036 地区档位）
const R2_FILES = ['manifest-meta.json', 'species-distribution.json', 'province-commonness.json']
/** 036 分片目录（Worker 按省读 `data/province-commonness/<CC>.json`；索引给前端发现） */
const R2_PROVINCE_DIR = 'province-commonness'
if (!SKIP_R2) {
  const uploads = R2_FILES.map((file) => ({ local: path.join(ROOT, 'public/data', file), key: `data/${file}` }))
  // 分片：仅上传仓库中**已存在**的（`npm run check:region` 保证索引/文件/结构一致）
  const shardDir = path.join(ROOT, 'public/data', R2_PROVINCE_DIR)
  const shardFiles = (await fs.readdir(shardDir).catch(() => [])).filter((f) => f.endsWith('.json')).sort()
  for (const f of shardFiles) {
    uploads.push({ local: path.join(shardDir, f), key: `data/${R2_PROVINCE_DIR}/${f}` })
  }
  // 断点续传：跳过上次已成功的对象（R2 put 幂等，重传无害；跳过只为省时间）
  const prog = await loadProgress()
  const r2Done = new Set(prog.r2Done ?? [])
  const pending = uploads.filter((u) => !r2Done.has(u.key))
  if (r2Done.size) {
    console.log(`  断点续传：${r2Done.size} 个对象上次已上传，本次跳过；待传 ${pending.length} 个`)
  }
  for (const { local, key } of pending) {
    const size = (await fs.stat(local)).size
    if (DRY) {
      console.log(`  [dry] ${key}（${(size / 1e6).toFixed(2)}MB）→ r2://${bucket}/${key}`)
      continue
    }
    process.stdout.write(`  ↑ ${key}（${(size / 1e3).toFixed(0)}KB）… `)
    await wranglerRetry(
      [
        'r2', 'object', 'put', `${bucket}/${key}`,
        '--file', local,
        '--content-type', 'application/json; charset=utf-8',
        '--cache-control', 'public, max-age=300',
        '--remote',
      ],
      {},
      key,
    )
    // 每成功一个立刻落盘进度 → 中断后重跑只做剩余部分
    r2Done.add(key)
    prog.r2Done = [...r2Done]
    await saveProgress(prog)
    console.log('ok')
  }
  if (!DRY && pending.length === 0 && r2Done.size === 0) {
    console.log('  （无待上传对象）')
  }
}

// ─────────────────────────────────────────────
step('3/5 生成 D1 seed（核心 1,299 + 全球 9,839，首图首音内联）')
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
    // 断点续传判定（2026-11-07）：上次若已跑过 schema + 部分 seed 块，本次**跳过 schema**
    // 直接续传剩余块——schema.sql 会再 DROP 一次，把已完成的部分全毁掉。
    // 安全前提（两个都要满足才续传）：
    //   ① seed 内容未变（哈希一致——变了说明构建产物已更新，必须从头重建）；
    //   ② D1 的 execute --file 是**原子**的（Cloudflare 导入 API 保证：失败即回滚到
    //      执行前状态），所以「某块已完成」是可靠的，重传同一块也不会撞主键。
    const seedText = await fs.readFile(path.join(ROOT, 'worker/seed.sql'), 'utf8')
    const seedHash = createHash('sha256').update(seedText).digest('hex').slice(0, 16)
    const prog = await loadProgress()
    const d1p = prog.d1 ?? {}
    const canResume =
      !FRESH && d1p.seedHash === seedHash && (d1p.schemaDone || (d1p.chunksDone?.length ?? 0) > 0)
    if (d1p.seedHash && d1p.seedHash !== seedHash) {
      console.log('  检测到 seed 内容已变化（哈希不一致）→ 放弃断点，从头重建')
    }
    if (canResume) {
      console.log(
        `  断点续传：schema ${d1p.schemaDone ? '已完成（跳过）' : '待执行'}；` +
          `seed 已完成 ${(d1p.chunksDone ?? []).length} 块`,
      )
    }

    // 写入预检（2026-10-08 事故：DROP 成功后才在 seed 处撞上 D1 每日写入额度，
    // 留下"表结构在、数据空"的状态）——先写一行 meta 试探可写性，不可写就整段跳过，
    // 绝不在无法完成重建时先删旧数据。续传时表已存在，探针跳过。
    if (!canResume) {
      process.stdout.write('  · 写入预检（meta 探针）… ')
      try {
        // 探针自带建表（DDL 不占"行写入"额度），对全新库同样成立
        await wranglerRetry(
          [
            'd1', 'execute', DB, '--command',
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
              "INSERT OR REPLACE INTO meta (key,value) VALUES ('sync_probe', strftime('%s','now'));",
            '--remote',
          ],
          {},
          '写入预检',
        )
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
      await wranglerRetry(['d1', 'execute', DB, '--file=worker/schema.sql', '--remote'], {}, 'schema.sql')
      console.log('ok')
    }

    // seed 分块执行：单次请求体过大易失败，按字节预算切块（语句均为单行,行边界安全）
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
    // 清理上一次的分块残留：块数随 seed 体量变化（曾 10 块，现 6 块），旧块留盘会被
    // 误读为本次产物（2026-10-08 复盘发现 10 块制式旧块与 6 块新块混在一起）。
    // （内容由 seedText 确定性生成；续传时重写出的块与上次逐字节一致，安全。）
    for (const f of await fs.readdir(chunkDir)) {
      if (f.endsWith('.sql')) await fs.rm(path.join(chunkDir, f), { force: true })
    }

    const doneChunks = new Set(canResume ? (d1p.chunksDone ?? []) : [])
    if (doneChunks.size) {
      console.log(
        `  · seed.sql 共 ${chunks.length} 块，续传剩余 ${chunks.length - doneChunks.size} 块（每块 ≤${(CHUNK_BYTES / 1e6).toFixed(1)}MB）`,
      )
    } else {
      console.log(`  · seed.sql 分 ${chunks.length} 块执行（每块 ≤${(CHUNK_BYTES / 1e6).toFixed(1)}MB）`)
    }
    for (let i = 0; i < chunks.length; i++) {
      if (doneChunks.has(i)) continue // 已完成的块直接跳过
      const file = path.join(chunkDir, `chunk-${String(i + 1).padStart(2, '0')}.sql`)
      await fs.writeFile(file, chunks[i])
      process.stdout.write(`    [${i + 1}/${chunks.length}] ${(Buffer.byteLength(chunks[i]) / 1e6).toFixed(2)}MB … `)
      // 每块都是一次原子的 execute --file：失败自动回滚到块前状态 → 重试/续传都安全
      await wranglerRetry(['d1', 'execute', DB, '--file', file, '--remote'], {}, `seed 块 ${i + 1}`)
      doneChunks.add(i)
      prog.d1 = { seedHash, schemaDone: true, chunksDone: [...doneChunks] }
      await saveProgress(prog)
      console.log('ok')
      await sleep(300)
    }
    // D1 全部完成 → 清断点（后续 check:sync 失败不需要续传，重跑只做校验）
    await clearProgress()
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
