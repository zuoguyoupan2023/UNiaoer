#!/usr/bin/env node
/**
 * I1 用量取证：按天/按小时查看 D1 的行读写（Cloudflare GraphQL Analytics）。
 *
 * 为什么需要它：`wrangler d1 info` 只给**滚动 24h 汇总**，查不了"某天某小时写了多少"。
 * 2026-10-08 的额度事故复盘就靠这份按小时数据定位到具体是哪个操作、写了多少行
 * （见 docs/032）。日常也用于 030 §7 的月度用量抽查。
 *
 * 凭证：复用本机 `wrangler login` 的 OAuth 令牌（不引入新密钥），**只读**查询。
 * 数据源：Account Analytics 数据集 d1AnalyticsAdaptiveGroups（按 databaseId × 小时聚合）。
 *
 * 用法：
 *   npm run d1:usage                    # 最近 3 天，按天×库汇总 + 今日按小时明细
 *   npm run d1:usage -- --days 7
 *   npm run d1:usage -- --db uniaoer    # 只看某个库
 *   npm run d1:usage -- --hourly-only   # 只打按小时明细（默认打最近一整天）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const DAYS = Math.max(1, Number(argOf('days') || 3))
const DB_FILTER = argOf('db')
const HOURLY_ONLY = args.includes('--hourly-only')

/** wrangler 登录态（macOS：~/Library/Preferences/.wrangler/config/default.toml；Linux：~/.config/.wrangler/…）。 */
function readOauthToken() {
  const candidates = [
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.wrangler/config/default.toml'),
  ]
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8')
      const m = raw.match(/oauth_token\s*=\s*"([^"]+)"/)
      if (m) return m[1]
    } catch {
      /* 继续找下一个 */
    }
  }
  throw new Error('找不到 wrangler OAuth 令牌——先执行 `wrangler login`')
}

const token = readOauthToken()
async function cf(pathname, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
  const body = await res.json()
  if (!body.success) {
    throw new Error(`${pathname} → ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 200)}`)
  }
  return body.result
}

const accounts = await cf('/accounts')
const account = args.includes('--account')
  ? accounts.find((a) => a.id === argOf('account'))
  : accounts.find((a) => a.name) || accounts[0]
if (!account) throw new Error('令牌下没有可访问的账号（accounts 为空）')

const dbs = await cf(`/accounts/${account.id}/d1/database`)
const nameById = new Map(dbs.map((d) => [d.uuid, d.name]))

const dayMs = 86_400_000
const now = new Date()
const from = new Date(now.getTime() - DAYS * dayMs)
const fmtDay = (d) => d.toISOString().slice(0, 10)
const fmtHour = (s) => `${s.replace('T', ' ').replace(':00:00Z', '')} UTCh`

const query = `query {
  viewer {
    accounts(filter: {accountTag: "${account.id}"}) {
      d1AnalyticsAdaptiveGroups(
        limit: 1000,
        filter: {date_geq: "${fmtDay(from)}", date_leq: "${fmtDay(new Date(now.getTime() + dayMs))}"},
        orderBy: [datetimeHour_ASC]
      ) {
        dimensions { datetimeHour databaseId }
        sum { rowsRead rowsWritten }
        count
      }
    }
  }
}`

const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query }),
})
const gql = await res.json()
if (gql.errors) throw new Error(`GraphQL: ${JSON.stringify(gql.errors).slice(0, 300)}`)
let rows = gql.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups ?? []
if (DB_FILTER) {
  rows = rows.filter((r) => nameById.get(r.dimensions.databaseId) === DB_FILTER)
}

/** 按天×库汇总 */
const byDay = new Map()
for (const r of rows) {
  const day = r.dimensions.datetimeHour.slice(0, 10)
  const name = nameById.get(r.dimensions.databaseId) || r.dimensions.databaseId.slice(0, 8)
  const key = `${day}|${name}`
  const cur = byDay.get(key) || { read: 0, write: 0, queries: 0 }
  cur.read += r.sum.rowsRead || 0
  cur.write += r.sum.rowsWritten || 0
  cur.queries += r.count || 0
  byDay.set(key, cur)
}
const fmt = (n) => n.toLocaleString('en-US')

if (!HOURLY_ONLY) {
  console.log(`账号 ${account.name} · ${DB_FILTER ? `库=${DB_FILTER} · ` : ''}最近 ${DAYS} 天（UTC）\n`)
  console.log('日期        库                       读行数        写行数     写/10万额度')
  console.log('─'.repeat(78))
  for (const [key, v] of [...byDay.entries()].sort()) {
    const [day, name] = key.split('|')
    const pct = ((v.write / 100_000) * 100).toFixed(0)
    console.log(
      `${day}  ${name.padEnd(22)} ${fmt(v.read).padStart(12)}  ${fmt(v.write).padStart(11)}   ${pct.padStart(5)}%`,
    )
  }
  const totals = [...byDay.entries()].reduce(
    (acc, [key, v]) => {
      const day = key.split('|')[0]
      acc[day] = (acc[day] || 0) + v.write
      return acc
    },
    {},
  )
  console.log('─'.repeat(78))
  for (const [day, w] of Object.entries(totals).sort()) {
    console.log(`  账号合计 ${day}：写 ${fmt(w)} 行（${((w / 100_000) * 100).toFixed(0)}% / 库×10万 参考线）`)
  }
}

/** 最近一整天的按小时明细（默认最后一条有数据的日期） */
const lastDay = rows.length ? rows[rows.length - 1].dimensions.datetimeHour.slice(0, 10) : fmtDay(now)
const target = rows.filter((r) => r.dimensions.datetimeHour.startsWith(argOf('day') || lastDay))
if (target.length) {
  console.log(`\n按小时明细（UTC ${argOf('day') || lastDay}；本地 = UTC+8）`)
  for (const r of target) {
    const name = nameById.get(r.dimensions.databaseId) || r.dimensions.databaseId.slice(0, 8)
    if ((r.sum.rowsWritten || 0) === 0 && (r.sum.rowsRead || 0) === 0) continue
    console.log(
      `  ${fmtHour(r.dimensions.datetimeHour)}  ${name.padEnd(22)} 写 ${fmt(r.sum.rowsWritten || 0).padStart(10)}  读 ${fmt(r.sum.rowsRead || 0).padStart(10)}  查询 ${fmt(r.count || 0)}`,
    )
  }
}
