#!/usr/bin/env node
/**
 * bank55 采集进度速览(一次性脚本,可反复跑)
 *
 *   npm run bank55:progress   (或 node scripts/bank55-progress.mjs)
 *
 * 做四件事:
 *   1. 台账档位分布(向 5图5音 靠拢的进度)
 *   2. 速率 + ETA(快照存data-cache/bank55-history.json,跨次调用才准)
 *   3. 资源水位(内存/磁盘/暂存)+ 进程存活 + 日志里的 [N/总数] 游标
 *   4. 最近告警(⚠️ / 🛑 / 429)
 *
 * 首次运行会用 053 的已知基线(2026-10-11T07:32Z 完全达标 162 种)播种,
 * 之后每次调用追加一个快照点。速率取「最早快照 → 最新快照」,故越跑越准。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(ROOT, 'data-cache/manifest-global.json')
const HISTORY = path.join(ROOT, 'data-cache/bank55-history.json')
const STATUS = path.join(ROOT, 'data-cache/bank55-status.json')
const LOG = '/tmp/bank55.log'
const SUPLOG = '/tmp/bank55-supervisor.log'
const TARGET_IMG = 5
const TARGET_AUD = 5

/**
 * 053 已知基线:暂停时的完全达标种数。
 * alive:false —— 该时刻是「跑完之后停机」,不能作为速率区间的一端,
 * 否则 5 天停机会被当成 113 小时的采集时间,ETA 直接算成上万年。
 */
const BASELINE = { ts: '2026-10-11T07:32:51.520Z', full: 162, alive: false }

const sh = (cmd) => {
  try {
    return execFileSync('bash', ['-lc', cmd], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// ---------- 1. 台账 ----------
const ledger = readJson(LEDGER)
if (!ledger) {
  console.error(`✗ 读不到台账 ${LEDGER}`)
  process.exit(1)
}
const species = ledger.species
const rows = Array.isArray(species) ? species : Object.values(species)

const cap = (n) => Math.min(n, Math.max(TARGET_IMG, TARGET_AUD))
const full = rows.filter((s) => cap((s.images || []).length) >= 5 && cap((s.audios || []).length) >= 5)
const img5 = rows.filter((s) => (s.images || []).length >= TARGET_IMG)
const aud5 = rows.filter((s) => (s.audios || []).length >= TARGET_AUD)
const imgCnt = rows.reduce((a, s) => a + (s.images || []).length, 0)
const audCnt = rows.reduce((a, s) => a + (s.audios || []).length, 0)

const dist = new Map()
for (const s of rows) {
  const k = `${Math.min((s.images || []).length, TARGET_IMG)}图${Math.min((s.audios || []).length, TARGET_AUD)}音`
  dist.set(k, (dist.get(k) || 0) + 1)
}

const pct = (a, b) => ((a / b) * 100).toFixed(1)

// ---------- 2. 快照历史 → 速率 / ETA ----------
const now = new Date()
const status = readJson(STATUS)
const collectorAlive = Boolean(status && status.collectionAlive)

let history = readJson(HISTORY) || []
history = history.filter((h) => typeof h.full === 'number')
// 首次运行:把 053 的已知基线播种进去(alive:false,不参与速率计算)
if (!history.length) history.push(BASELINE)
history.push({ ts: now.toISOString(), full: full.length, alive: collectorAlive })
if (history.length > 4000) history = history.slice(-4000)
fs.writeFileSync(HISTORY, JSON.stringify(history))

// 速率只统计「两端都在采集存活」的区间 —— 停机/崩溃时间不计入采集时长。
// 纯活区间的累计采集小时数 + 累计达标增量。
let runMs = 0
let gain = 0
for (let i = 1; i < history.length; i++) {
  const a = history[i - 1]
  const b = history[i]
  if (!a.alive || !b.alive) continue
  const dt = new Date(b.ts) - new Date(a.ts)
  if (dt <= 0) continue
  runMs += dt
  gain += b.full - a.full
}
const spanH = runMs / 3600000
const rateH = spanH > 0.02 ? gain / spanH : 0
const remaining = rows.length - full.length

// ---------- 3. 水位 / 进程 / 游标 ----------
const diskFreeMB = sh("df -k . | tail -1 | awk '{print $4}'")
const freeGB = diskFreeMB ? (Number(diskFreeMB) / 1024 / 1024).toFixed(2) : '?'
const pubMB = sh('du -sk public/media 2>/dev/null | awk "{print \\$1}"')
const procs = sh('ps aux | grep -v grep | grep -E "build-bank|bank55-supervisor|push-r2" | wc -l | tr -d " "')
const cursor = (() => {
  if (!fs.existsSync(LOG)) return ''
  const lines = fs.readFileSync(LOG, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0 && i > lines.length - 400; i--) {
    const m = lines[i].match(/\[\s*(\d+)\/(\d+)\]/)
    if (m) return { pos: m[1], total: m[2] }
  }
  return ''
})()

// ---------- 4. 告警 ----------
const warns = (() => {
  const out = []
  for (const f of [LOG, SUPLOG]) {
    if (!fs.existsSync(f)) continue
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => /⚠️|🛑|429|超时|失败/.test(l))
    out.push(...lines.slice(-3).map((l) => `${path.basename(f)}: ${l.trim()}`))
  }
  return out
})()

// ---------- 输出 ----------
const line = '─'.repeat(64)
console.log(`\n${line}\n  053 采集进度 · ${now.toLocaleString('zh-CN')}\n${line}`)

console.log(`\n【台账】${rows.length} 种`)
console.log(`  完全达标(${TARGET_IMG}图${TARGET_AUD}音)  ${full.length}  (${pct(full.length, rows.length)}%)`)
console.log(`  图 ≥${TARGET_IMG}            ${img5.length}  (${pct(img5.length, rows.length)}%)`)
console.log(`  音 ≥${TARGET_AUD}            ${aud5.length}  (${pct(aud5.length, rows.length)}%)`)
console.log(`  素材总量          图 ${imgCnt} / 音 ${audCnt}`)

console.log(`\n【档位分布】(数量降序)`)
const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1])
const width = Math.max(...sorted.map(([k]) => k.length))
for (const [k, v] of sorted) {
  const bar = '█'.repeat(Math.max(1, Math.round((v / rows.length) * 100)))
  console.log(`  ${k.padEnd(width)}  ${String(v).padStart(5)}  ${bar}`)
}

console.log(`\n【速率】(只统计采集存活的时间,停机/崩溃不计入)`)
console.log(`  累计采集时长   ${spanH.toFixed(2)} 小时(跨 ${history.length} 个快照点)`)
console.log(`  累计达标增量   ${gain >= 0 ? '+' : ''}${gain} 种(现共 ${full.length})`)
if (rateH > 0) {
  const etaH = remaining / rateH
  console.log(`  速率           ${rateH.toFixed(1)} 种/小时`)
  console.log(`  剩余           ${remaining} 种  →  ETA ${etaH.toFixed(0)} 小时 ≈ ${(etaH / 24).toFixed(1)} 天(连续跑)`)
} else {
  console.log(`  速率           样本不足(需 ≥2 分钟的连续存活跨度),隔几分钟再跑一次本脚本`)
}
console.log(`  注意:ETA 不含崩溃重启 / 429 熔断(每次 10 分钟)/ 磁盘触底等待`)

console.log(`\n【运行状态】`)
console.log(`  相关进程        ${procs ? `${procs} 个存活` : '0 —— 没在跑!  见 docs/054 §1.2 重启'}`)
if (cursor) console.log(`  日志游标        [${cursor.pos}/${cursor.total}]  (${pct(Number(cursor.pos), Number(cursor.total))}%)`)
if (status) {
  const age = ((now - new Date(status.ts)) / 1000).toFixed(0)
  console.log(`  采集存活        ${status.collectionAlive}${status.pushRunning ? '(正在推送)' : ''}`)
  console.log(`  内存可用        ${status.memAvailMB}MB  ${status.memAvailMB < 600 ? '⚠️ 低于熔断线' : ''}`)
  console.log(`  磁盘可用        ${freeGB}GB  ${Number(diskFreeMB) / 1024 < 1024 ? '⚠️ 低于 1GB 地板，将暂停采集' : ''}`)
  console.log(`  暂存 public/media ${pubMB ? (Number(pubMB) / 1024).toFixed(0) : '0'}MB / 1024MB(到量自动推送清空)`)
  console.log(`  status 文件年龄   ${age}s${Number(age) > 300 ? '  ⚠️ 监管器可能已退出' : ''}`)
} else {
  console.log(`  (无 status 文件 —— 监管器未运行)`)
}

console.log(`\n【最近告警】`)
console.log(warns.length ? warns.map((w) => `  ${w}`).join('\n') : '  无')

console.log(`\n【实时日志】tail -f ${LOG}`)
console.log(`【监管器】  tail -f ${SUPLOG}`)
console.log(`${line}\n`)