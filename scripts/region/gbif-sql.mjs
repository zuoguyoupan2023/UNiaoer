/**
 * 022 §1.7 GBIF SQL Download API runner（实验特性）。
 *
 * 提交 SQL → 轮询 → 下载 zip → 解析为 JSON（纯函数在 gbif-sql-lib.mjs）。
 * 凭据走 .env 的 GBIF_USERNAME / GBIF_PASSWORD（Basic auth），失败显式抛错。
 *
 * CLI：
 *   npm run region:gbif-sql -- --sql "SELECT ..." [--checklist-key <uuid>] [--out path]
 *   npm run region:gbif-sql -- --key 0008xxx-...        # 续传已提交的下载
 *   npm run region:gbif-sql -- --list                   # 列账号最近下载
 *   --no-wait 只提交并打印 key；--interval 30 --timeout 2400（秒）
 *   体系：GBIF Backbone=`d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`（整数 key，Aves=212）；
 *         COL XR=`7ddf754f-d193-4cc9-b351-99906754a03b`（字母数字 key，当前默认）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs, sleep } from '../lib/util.mjs'
import { parseSqlZip, planChunks } from './gbif-sql-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const API = 'https://api.gbif.org/v1'
const UA = 'uniaoer-build/1.0 (non-commercial open-source bird quiz; https://github.com/zuoguyoupan2023/UNiaoer)'

const args = parseArgs(process.argv.slice(2))
await loadEnv(path.join(ROOT, '.env'))

const user = process.env.GBIF_USERNAME
const pass = process.env.GBIF_PASSWORD
if (!user || !pass) throw new Error('缺少 GBIF_USERNAME / GBIF_PASSWORD（见 .env.example）')
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
const json = { Authorization: auth, 'content-type': 'application/json', 'User-Agent': UA }

async function api(url, opts = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 60_000)
  try {
    const res = await fetch(url, { ...opts, headers: { ...json, ...opts.headers }, signal: ctrl.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${url.split('?')[0]}${body ? `: ${body.slice(0, 300)}` : ''}`)
    }
    // 提交接口偶发返回裸文本 key（非 JSON）——尝试 JSON，失败回退原文（2026-10-03 实测 0009710）
    if (opts.raw) return res
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return text.trim().replace(/^"|"$/g, '')
    }
  } finally {
    clearTimeout(timer)
  }
}

async function listDownloads(limit = 20) {
  const j = await api(`${API}/occurrence/download/user/${encodeURIComponent(user)}?limit=${limit}`)
  for (const d of j.results || []) {
    console.log(`${d.key}  ${String(d.status).padEnd(10)} rows=${d.totalRecords ?? '?'}  ${d.created}`)
    if (d.request?.sql) console.log(`    ${d.request.sql}`)
  }
  return j
}

async function submit(sql, checklistKey = null) {
  const body = {
    sql,
    format: 'SQL_TSV_ZIP',
    creator: user,
    sendNotification: false,
    ...(checklistKey ? { checklistKey } : {}),
  }
  const res = await api(`${API}/occurrence/download/request`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: 120_000,
  })
  const key = typeof res === 'string' ? res : res.key
  if (!key) throw new Error(`提交未返回 key：${JSON.stringify(res).slice(0, 200)}`)
  return key
}

async function poll(key, { intervalSec = 30, timeoutSec = 2400 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000
  let last = ''
  for (;;) {
    const d = await api(`${API}/occurrence/download/${key}`)
    const line = `${d.status} rows=${d.totalRecords ?? '?'}`
    if (line !== last) console.log(`[${new Date().toISOString().slice(11, 19)}] ${key} ${line}`)
    last = line
    if (d.status === 'SUCCEEDED') return d
    if (['FAILED', 'CANCELLED'].includes(d.status)) throw new Error(`下载 ${key} ${d.status}`)
    if (Date.now() > deadline) throw new Error(`下载 ${key} 轮询超时（${timeoutSec}s，仍 ${d.status}）`)
    await sleep(intervalSec * 1000)
  }
}

/**
 * 下载结果 zip —— **分块（Range）下载 + 逐块校验 + 断点重试**。
 *
 * ⚠️ 2026-10-08 三个连续暴露的问题（本次全量省级查询 8.3MB 结果时踩到）：
 *   1. 原实现走 `api(..., { timeout: 300_000 })`，而 `api` 的超时是**对整段请求（含 body）**
 *      生效的 AbortController → 大结果中途被 abort，落盘成**截断 zip**；
 *   2. 改流式读取后仍复现：GBIF 下载是 **302 → occurrence-download.gbif.org**，
 *      长连接在大文件上仍会被中途掐断（实测只拿到 4.2MB / 8.3MB）；
 *   3. `parseSqlZip` 报"找不到 EOCD"——正是上面截断的表现。
 *
 * 现行做法（对服务端友好且抗断流）：先 HEAD 拿 `content-length`，再按 1MB 分块用
 * `Range` 请求逐块下载；每块校验长度，失败重试 3 次；全部到齐后拼装并校验 zip 魔数。
 * GBIF 的下载端点支持 `accept-ranges: bytes`（实测 206），故这条路可靠。
 */
async function headContentLength(url) {
  const res = await fetch(url, { method: 'HEAD', headers: json, redirect: 'follow' })
  if (!res.ok) throw new Error(`HEAD 失败 HTTP ${res.status}`)
  return Number(res.headers.get('content-length') || 0)
}

async function fetchRange(url, start, end, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { ...json, range: `bytes=${start}-${end}` },
        redirect: 'follow',
      })
      if (!(res.status === 206 || res.status === 200)) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const want = end - start + 1
      // 末尾块可能小于 CHUNK；200（无 Range 支持）时只接受"整文件一次拿全"
      if (res.status === 206 && buf.length !== want) {
        throw new Error(`分块长度不符：${buf.length} / ${want}`)
      }
      if (res.status === 200 && buf.length !== want) {
        throw new Error(`服务端未按 Range 返回（${buf.length} 字节）`)
      }
      return buf
    } catch (e) {
      if (i === attempts) throw new Error(`Range ${start}-${end} 重试 ${attempts} 次失败：${e.message}`)
      await sleep(1500)
    }
  }
  throw new Error('unreachable')
}

async function fetchZip(key) {
  const url = `${API}/occurrence/download/request/${key}.zip`
  const total = await headContentLength(url)
  if (!total) throw new Error('无法取得 zip 大小（content-length 为空）')
  const parts = []
  const chunks = planChunks(total)
  for (const [i, [start, end]] of chunks.entries()) {
    process.stdout.write(`  下载 ${Math.floor((i / chunks.length) * 100)}%…\r`)
    parts.push(await fetchRange(url, start, end))
  }
  process.stdout.write('  '.repeat(20) + '\r')
  const buf = Buffer.concat(parts)
  if (buf.length !== total) throw new Error(`拼装后长度不符：${buf.length} / ${total}`)
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`不是 zip（魔数不符，共 ${buf.length} 字节）`)
  }
  return buf
}

const outArg = args.out ? path.resolve(ROOT, args.out) : null

if (args.list) {
  await listDownloads(Number(args.limit) || 20)
} else {
  let key = args.key ? String(args.key) : null
  if (!key) {
    const sql = String(args.sql || '').trim()
    if (!sql) throw new Error('需要 --sql "..." 或 --key <key>（或 --list）')
    const checklistKey = args['checklist-key'] ? String(args['checklist-key']) : null
    console.log(`提交 SQL（format=SQL_TSV_ZIP${checklistKey ? `, checklistKey=${checklistKey}` : ''}）：\n  ${sql}`)
    key = await submit(sql, checklistKey)
    console.log(`已提交：${key}`)
  }
  if (args['no-wait']) {
    console.log(`（--no-wait）稍后用：npm run region:gbif-sql -- --key ${key}`)
  } else {
    const intervalSec = Number(args.interval) || 30
    const timeoutSec = Number(args.timeout) || 2400
    await poll(key, { intervalSec, timeoutSec })
    const buf = await fetchZip(key)
    console.log(`已下载 zip ${Math.round(buf.length / 1024)}KB，解析中…`)
    const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
    await fs.mkdir(dir, { recursive: true })
    const zipPath = outArg ? outArg.replace(/\.json$/, '.zip') : path.join(dir, `${key}.zip`)
    await fs.writeFile(zipPath, buf)
    const rows = parseSqlZip(buf)
    const jsonPath = outArg || path.join(dir, `${key}.json`)
    // 大结果用紧凑 JSON（几十万行时缩进会又慢又占空间）
    await fs.writeFile(jsonPath, JSON.stringify(rows))
    console.log(`\n✔ ${key}：${rows.length} 行 → ${path.relative(ROOT, jsonPath)}（zip：${path.relative(ROOT, zipPath)}）`)
    if (rows.length) console.log('  列：', Object.keys(rows[0]).join(', '))
  }
}
