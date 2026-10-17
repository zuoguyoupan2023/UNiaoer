#!/usr/bin/env node
/**
 * 053 本机执行监管器:全球种媒体 1+1 → 最多 5+5(docs/053 §2.8)
 *
 * 职责:
 *  - 采集:node scripts/build-bank.mjs --global --media stage --per 5 --concurrency 8
 *          (台账即断点;退出后自动重启续跑)
 *  - 批量推送:public/media ≥ 1GB → wrangler 登录态推送(npm run r2:push -- --resume --concurrency 3)
 *          → 按"本轮实际上传 delta"清理本地(未上传的绝不删)→ 继续采集
 *  - 内存看门狗:系统可用(free+inactive+speculative)< 600MB → 优雅停采集 → exit 42 提醒
 *  - 磁盘看门狗:可用 < 1GB → 停采集触发推送;恢复到 ≥1.2GB 才重启采集
 *  - 完成判定:连续 2 轮采集零产出(台账素材总数不增长)→ 最后一次推送清理 → exit 0
 *
 * 日志:/tmp/bank55-supervisor.log(本文件)/ /tmp/bank55.log(采集)/ /tmp/bank55-push.log(推送)
 * 状态:data-cache/bank55-status.json(随时查看)
 * 退出码:0 完成 · 41 采集连环崩溃 · 42 内存熔断 · 143 被信号停止(可重跑本文件续)
 */
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn, execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUP_LOG = '/tmp/bank55-supervisor.log'
const COLL_LOG = '/tmp/bank55.log'
const PUSH_LOG = '/tmp/bank55-push.log'
const STATUS = path.join(ROOT, 'data-cache/bank55-status.json')
const PUSH_LEDGER = path.join(ROOT, 'data-cache/r2-uploaded.json')

const MEM_FLOOR_MB = 600 // 用户指定:系统可用内存 <600MB → 熔断
const DISK_FLOOR_MB = 1024 // 磁盘可用 <1GB → 停采集推推送
const DISK_RESUME_MB = 1200 // 磁盘恢复到该值才重启采集
const BATCH_MB = 1024 // 用户指定:暂存每超 1GB 推送一次
const QA_SAMPLE = 300 // 推送前质量抽检的物种抽样数
// 推送单轮超时。3h 实测不够:wrangler 每文件约 1.97s(--s3 直传不可用,.env 里
// R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET 三行值为空),14041 个文件需 3.6h,每轮都在
// 尾段被腰斩,反复触发「台账剔除 stale 键 → 下轮重传」的无谓往返。提到 6h。
const PUSH_TIMEOUT_MS = 6 * 3600_000
let pushBusy = false // 推送(含抽检)进行中的同步标志,防主循环重入起第二个推送
// 主动停采集(磁盘地板/停采线/内存熔断)时置位,用来把「优雅停止」和「真崩溃」
// 分开统计。否则监管器自己停的采集会被记成崩溃,30 分钟内 5 次就 exit 41 把任务全停掉。
let collStoppedByUs = false
const PUSH_CONCURRENCY = 8 // wrangler 每文件约 1.97s 且瓶颈在 npm exec 的进程启动开销
// (CPU-bound),实测 10 核机器并发 3 时总体占用仅 22%,故从 3 提到 8。
// ⚠️ 直接跑 node 不经 npm script,没有默认值——--media 必须显式给 stage(remote 只抓元数据不物化!)
// 2026-10-17：并发 2 → 4。
// 起因：媒体下载**是每连接限速**（XC `/download` 实测 10–20 KB/s，4 路并发达 ~40 KB/s），
// 而媒体下载不占 CPU（实测 %CPU≈0.1）→ 提高 worker 数本该线性提高下载吞吐。
// 但实测**并发 8 并没有更快**（10 分钟只推进 4 种 ≈ 24 种/小时，与并发 2 同档），
// 而且 XC 对 8 路并发开始回 **HTTP 503**（实测 400 行日志里 14 次 5xx）。
// → 真正的瓶颈**不是下载，而是 XC 的全局串行 API 闸门**（fetchXc 走 xcQueue：
//   长尾种要按同义词逐个查，每个查询 ~2.5 s + xcGap 冷却，全局串行 → 所有 worker 排队等）。
// 因此这里只保守提到 4（下载有收益、503 还少），**别再往上加**；要提速得改 API 侧（见 docs/054 §1.5.6）。
const OPT_CONCURRENCY = Number(process.env.BANK55_CONCURRENCY || 4)
const COLL_ARGS = ['--global', '--media', 'stage', '--per', '5', '--concurrency', String(OPT_CONCURRENCY)]

let stopping = false
let exitCode = 0
let coll = null // { pid, spawnInfo }
let push = null
let zeroYield = 0
let crashTimes = []
let lastLedgerSum = null
const supFd = fsSync.openSync(SUP_LOG, 'a')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  fsSync.writeSync(supFd, line)
  process.stderr.write(line)
}

async function readJsonSet(file) {
  try {
    return new Set(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return new Set()
  }
}
async function writeJsonSet(file, set) {
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify([...set]))
  await fs.rename(tmp, file)
}

async function sh(cmd, args) {
  try {
    const { stdout } = await execFileP(cmd, args, { cwd: ROOT })
    return stdout
  } catch (e) {
    return e.stdout || ''
  }
}

/** 系统可用内存 MB(macOS 口径≈"可用" = free+inactive+speculative) */
async function availMemMB() {
  const out = await sh('vm_stat', [])
  const page = Number((out.match(/page size of (\d+)/) || [])[1] || 16384)
  const grab = (label) => Number((out.match(new RegExp(`${label}:\\s+(\\d+)\\.`)) || [])[1] || 0)
  const pages = grab('Pages free') + grab('Pages inactive') + grab('Pages speculative')
  return Math.round((pages * page) / 1048576)
}

async function diskFreeMB() {
  const out = await sh('df', ['-k', ROOT])
  const line = out.split('\n')[1]
  const kb = line ? Number(line.trim().split(/\s+/)[3] || 0) : 0
  return Math.round(kb / 1024) // df -k 是 KB,统一成 MB
}

async function pubMediaMB() {
  const out = await sh('du', ['-sk', path.join(ROOT, 'public/media')])
  const kb = Number(out.trim().split(/\t|\s+/)[0] || 0)
  return Math.round(kb / 1024) // du -sk 是 KB,统一成 MB
}

async function ledgerStats() {
  try {
    const d = JSON.parse(await fs.readFile(path.join(ROOT, 'data-cache/manifest-global.json'), 'utf8'))
    return d.stats || {}
  } catch {
    return {}
  }
}

async function writeStatus(extra = {}) {
  const s = {
    ts: new Date().toISOString(),
    collectionAlive: !!(coll && (await alive(coll.pid))),
    pushRunning: !!(push && (await alive(push.pid))),
    memAvailMB: await availMemMB(),
    diskFreeMB: await diskFreeMB(),
    pubMediaMB: await pubMediaMB(),
    zeroYield,
    ledger: await ledgerStats(),
    ...extra,
  }
  await fs.writeFile(STATUS, JSON.stringify(s, null, 2)).catch(() => {})
  return s
}

async function alive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 找已在跑的采集/推送进程(监管器被杀后孤儿子进程的收养);锚定 node 本体,避开 caffeinate 包装层 */
async function findProc(pattern) {
  const out = await sh('pgrep', ['-f', pattern])
  for (const pid of out.split('\n').map((s) => Number(s.trim())).filter(Boolean)) {
    if (pid !== process.pid && (await alive(pid))) return pid
  }
  return 0
}

async function startCollection() {
  const adopted = await findProc('^node scripts/build-bank.mjs --global')
  if (adopted) {
    coll = { pid: adopted, adopted: true, startedAt: Date.now() }
    log(`👋 收养已在跑的采集进程 pid=${adopted}(上次监管器中断遗留)`)
    return
  }
  const fd = fsSync.openSync(COLL_LOG, 'a')
  fsSync.writeSync(fd, `\n==== supervisor 启动采集 ${new Date().toISOString()} ====\n`)
  // 直接 spawn node(便于对 node 本体投递 SIGTERM);caffeinate 另起 -w 挂到该 pid 上防休眠
  const child = spawn('node', ['scripts/build-bank.mjs', ...COLL_ARGS], {
    cwd: ROOT,
    stdio: ['ignore', fd, fd],
  })
  child.on('exit', (code, signal) => log(`采集进程退出 code=${code} signal=${signal}`))
  coll = { pid: child.pid, adopted: false, startedAt: Date.now() }
  spawn('caffeinate', ['-isw', String(child.pid)], { stdio: 'ignore' }).unref()
  log(`▶️ 启动采集 pid=${child.pid}(stage + per5 + 并发${OPT_CONCURRENCY},caffeinate 防休眠已挂)`)
}

async function stopChild(child, graceMs = 60_000) {
  if (!child || !(await alive(child.pid))) return
  log(`⏹️ 优雅停止 pid=${child.pid}(SIGTERM,采集会先落盘台账)`)
  try {
    process.kill(child.pid, 'SIGTERM')
  } catch {}
  const t0 = Date.now()
  while ((await alive(child.pid)) && Date.now() - t0 < graceMs) await sleep(1000)
  if (await alive(child.pid)) {
    log(`⚠️ pid=${child.pid} 未在 ${graceMs / 1000}s 内退出,SIGKILL`)
    try {
      process.kill(child.pid, 'SIGKILL')
    } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 推送一轮;返回 { delta: Set(本轮实际上传的 key), ledger: Set(推送后台账), ok } */
async function pushCycle(reason) {
  // pushBusy 必须**同步**置位:pushCycle 内部有多处 await(算体积/读台账/质量抽检
  // spawnSync 约 1s),若等到 spawn 出 child 才置位,主循环会在这个窗口里重入,
  // 起第二个推送并发写同一批文件。
  if (pushBusy) {
    log('…推送已在跑(含抽检中),跳过本次触发')
    return null
  }
  pushBusy = true
  try {
    return await pushCycleInner(reason)
  } finally {
    pushBusy = false
  }
}

async function pushCycleInner(reason) {
  if (push && (await alive(push.pid))) {
    log('…推送已在跑,跳过本次触发')
    return null
  }
  const pubMB = await pubMediaMB()
  if (pubMB === 0) {
    log('…public/media 为空,无需推送')
    return { delta: new Set(), ledger: await readJsonSet(PUSH_LEDGER), ok: true }
  }
  const before = await readJsonSet(PUSH_LEDGER)

  // ---- 推送前质量闸 ----
  // R2 批量写入不可逆:坏文件一旦传上去, --resume 台账就会认定它「已传」不再重传,
  // 线上直接是坏图/坏音。故推送前先抽检, 只对 🔴 级问题(格式/零字节/遗漏)阻断。
  log('🔍 推送前质量抽检…')
  const qa = spawnSync('node', ['scripts/check-staged-media.mjs', '--sample', String(QA_SAMPLE)], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const qaOut = `${qa.stdout || ''}${qa.stderr || ''}`
  log(qaOut.trim().split('\n').map((l) => `│${l}`).join('\n'))
  // 退出码:0 干净 / 1 仅🟡无害 / 2 🔴数据丢失(阻断) / 3 🔴格式错配(放行但报警)
  if (qa.status === 2) {
    log('⛔ 质量抽检发现数据丢失级问题(遗漏/零字节/派生件缺失) → 本轮推送中止,不清理本地')
    log('   修好后重跑本监管器即续(--resume 会跳过已传)')
    return { delta: new Set(), ledger: before, ok: false }
  }
  if (qa.status === 3) log('⚠️ 抽检发现格式错配文件(WAV 冒充 .mp3 等)→ 放行,但需单独修')
  else if (qa.status === 1) log('🟡 抽检仅有无害项(孤儿文件)→ 放行')

  log(`⬆️ 开始推送(${reason}):本地 ${pubMB}MB,后台账 ${before.size} 键`)
  const fd = fsSync.openSync(PUSH_LOG, 'a')
  fsSync.writeSync(fd, `\n==== 推送 ${new Date().toISOString()}(${reason})====\n`)
  const child = spawn('node', ['scripts/push-r2.mjs', '--resume', '--concurrency', String(PUSH_CONCURRENCY)], {
    cwd: ROOT,
    stdio: ['ignore', fd, fd],
  })
  push = { pid: child.pid, startedAt: Date.now() }
  const code = await new Promise((resolve) => {
    const guard = setInterval(async () => {
      if (Date.now() - push.startedAt > PUSH_TIMEOUT_MS) {
        log(`⚠️ 推送超 ${PUSH_TIMEOUT_MS / 3600_000} 小时,SIGKILL(下轮续传)`)
        try {
          process.kill(push.pid, 'SIGKILL')
        } catch {}
      }
    }, 60_000)
    child.on('exit', (c) => {
      clearInterval(guard)
      resolve(c)
    })
  })
  push = null
  collStoppedByUs = false // 本轮推送收尾:解除「主动停」标记,后续崩溃统计恢复正常
  const ledger = await readJsonSet(PUSH_LEDGER)
  const delta = new Set([...ledger].filter((k) => !before.has(k)))
  log(`⬆️ 推送结束 code=${code},本轮实际上传 ${delta.size} 个文件`)
  await cleanupPushed(delta, ledger)
  return { delta, ledger, ok: code === 0 }
}

/**
 * 只删"本轮已确认上传"的本地文件;后台账声称有、但本地仍存在的键从台账移除
 * (内容已变化或上一轮漏传,下轮重传覆盖),杜绝"本地已删、R2 又没有"的丢失窗口。
 */
async function cleanupPushed(delta, ledger) {
  const mediaDir = path.join(ROOT, 'public/media')
  let deleted = 0
  let bytes = 0
  const stale = []
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        const rest = await fs.readdir(full).catch(() => ['x'])
        if (!rest.length) await fs.rmdir(full).catch(() => {})
        continue
      }
      const rel = 'media/' + path.relative(mediaDir, full).split(path.sep).join('/')
      if (delta.has(rel)) {
        const st = await fs.stat(full).catch(() => null)
        bytes += st ? st.size : 0
        await fs.rm(full, { force: true })
        deleted++
      } else if (ledger.has(rel)) {
        stale.push(rel)
      }
    }
  }
  await walk(mediaDir)
  for (const rel of stale) ledger.delete(rel)
  if (stale.length) await writeJsonSet(PUSH_LEDGER, ledger)
  log(`🧹 清理本地:删除 ${deleted} 个已上传文件(释放 ${(bytes / 1048576).toFixed(0)}MB)` +
      (stale.length ? `;${stale.length} 个键从后台账移除待重传` : ''))
}

async function finish() {
  log('🏁 采集收敛(连续零产出):做最后一次推送清理…')
  if (coll && (await alive(coll.pid))) await stopChild(coll)
  await pushCycle('完成前最后一批') // 此处需要等它跑完再收尾,保持 await
  await writeStatus({ done: true })
  log('✅ 053 采集阶段完成:R2 已是最新,台账 data-cache/manifest-global.json 可进入分片阶段')
  exitCode = 0
}

async function main() {
  log(`=== bank55-supervisor 启动 pid=${process.pid}(内存熔断 ${MEM_FLOOR_MB}MB / 批量 ${BATCH_MB}MB / 磁盘地板 ${DISK_FLOOR_MB}MB) ===`)
  process.on('SIGTERM', () => {
    stopping = true
    exitCode = 143
  })
  process.on('SIGINT', () => {
    stopping = true
    exitCode = 143
  })

  await startCollection()
  const s0 = await ledgerStats()
  lastLedgerSum = (s0.imageCount || 0) + (s0.audioCount || 0)

  let cycle = 0
  while (true) {
    cycle++
    await sleep(cycle === 1 ? 15_000 : 30_000)
    if (stopping) break

    const mem = await availMemMB()
    if (mem < MEM_FLOOR_MB) {
      log(`🚨 系统可用内存 ${mem}MB < ${MEM_FLOOR_MB}MB → 熔断:停止全部并退出(重跑本文件即续)`)
      await writeStatus({ alert: 'MEMORY_LOW', memAvailMB: mem })
      if (push && (await alive(push.pid))) await stopChild(push, 10_000)
      if (coll && (await alive(coll.pid))) await stopChild(coll)
      exitCode = 42
      break
    }

    const disk = await diskFreeMB()
    if (disk < DISK_FLOOR_MB && coll && (await alive(coll.pid)) && !push) {
      log(`⚠️ 磁盘可用 ${disk}MB < ${DISK_FLOOR_MB}MB → 暂停采集,触发推送腾空间`)
      collStoppedByUs = true
      await stopChild(coll)
      void pushCycle('磁盘地板')
    } else if (disk < DISK_RESUME_MB && coll && (await alive(coll.pid)) && push) {
      // 推送已开跑时磁盘还在掉 —— 原逻辑三处判断都被 `!push` 守卫住,
      // 推送期间磁盘跌破地板会「无人管」,采集继续灌盘直到爆盘。
      // 这里补上:只要逼近停采线就先停采集,把磁盘让给正在跑的推送。
      log(`⚠️ 磁盘可用 ${disk}MB 逼近停采线 ${DISK_RESUME_MB}MB(推送进行中) → 暂停采集`)
      collStoppedByUs = true
      await stopChild(coll)
    }

    const pubMB = await pubMediaMB()
    // 注意:这里**不能 await**。pushCycle 内含对 child.exit 的等待,一旦 await,
    // 整个主循环会被阻塞整整一轮推送(2 小时+),期间磁盘看门狗与 600MB 内存
    // 熔断全部失效 —— 那正是 2026-10-16 磁盘逼近爆盘却无人管的根因。
    // 改为即发即忘:进度靠 pushBusy / push 标志跟踪,推送自己的退出由 pushCycle
    // 内部的 child.on('exit') 处理(清理 + 落账都在那里做,不依赖主循环)。
    if (!pushBusy && pubMB >= BATCH_MB) {
      void pushCycle(`暂存达 ${pubMB}MB ≥ 1GB`)
    } else if (!pushBusy && disk < DISK_FLOOR_MB) {
      void pushCycle('磁盘低位补推')
    }

    // 采集退出 → 统计产出,决定重启/完成/告警
    if (coll && !(await alive(coll.pid))) {
      const runtimeMin = (Date.now() - coll.startedAt) / 60_000
      const s = await ledgerStats()
      const sum = (s.imageCount || 0) + (s.audioCount || 0)
      const yieldNow = sum - lastLedgerSum
      lastLedgerSum = sum
      if (!coll.adopted && runtimeMin < 3 && !collStoppedByUs) {
        crashTimes = crashTimes.filter((t) => Date.now() - t < 30 * 60_000)
        crashTimes.push(Date.now())
        log(`⚠️ 采集启动 ${runtimeMin.toFixed(1)} 分钟即退出(疑似崩溃 ${crashTimes.length}/5)`)
        if (crashTimes.length >= 5) {
          log('🚨 采集 30 分钟内崩溃 5 次 → 停止监管,人工排查 /tmp/bank55.log')
          await writeStatus({ alert: 'COLLECTION_CRASH_LOOP' })
          exitCode = 41
          break
        }
      }
      if (yieldNow === 0 && runtimeMin >= 3) {
        zeroYield++
        log(`📉 本轮零产出(${runtimeMin.toFixed(0)} 分钟,${zeroYield}/2)`)
        if (zeroYield >= 2) {
          await finish()
          break
        }
      } else {
        if (yieldNow > 0) log(`📈 本轮产出 +${yieldNow} 条素材(累计 ${sum})`)
        zeroYield = 0
      }
      const diskNow = await diskFreeMB()
      if (diskNow >= DISK_RESUME_MB) {
        await startCollection()
      } else {
        log(`…磁盘仅 ${diskNow}MB,暂缓重启采集(等推送腾空间)`)
        coll = null
      }
    } else if (!coll && !stopping) {
      // 被park 掉之后必须在这里重新拉起 —— 原逻辑一旦置 coll=null,
      // 上面的 `if (coll && !alive)` 分支就再也进不去,采集会永久停摆:
      // 推送腾出了空间也没人重启它。parked 是个「待恢复」状态,不是终止状态。
      const diskNow = await diskFreeMB()
      if (diskNow >= DISK_RESUME_MB && !pushBusy) {
        log(`📈 磁盘已回到 ${diskNow}MB ≥ ${DISK_RESUME_MB}MB → 恢复采集`)
        await startCollection()
      }
    }

    if (cycle % 10 === 0) await writeStatus()
  }

  if (exitCode === 143) {
    log('⏹️ 收到停止信号:停采集/推送后退出(重跑本文件即续)')
    if (push && (await alive(push.pid))) await stopChild(push, 15_000)
    if (coll && (await alive(coll.pid))) await stopChild(coll)
    await writeStatus({ stopped: true })
  }
  log(`=== bank55-supervisor 退出 code=${exitCode} ===`)
  process.exit(exitCode)
}

main().catch((e) => {
  log(`❌ 监管器异常退出:${e.stack || e}`)
  process.exit(1)
})
