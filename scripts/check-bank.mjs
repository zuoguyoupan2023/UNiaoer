#!/usr/bin/env node
/**
 * A3 构建后一致性校验
 * 校验 public/data/manifest.json 的结构与媒体地址归属：
 *   1) 结构：total/stats 与实际一致；媒体必须带完整署名（author/license/source/sourceUrl）
 *   2) 归属：媒体 URL 必须指向 R2 公开域名（防止 Pages 构建跑 bank 覆盖成 remote 版 manifest）
 *   3) 抽查：随机抽 N 个 R2 媒体 HEAD 一次，期望 200（可用 --no-net 跳过）
 *
 * 用法：node scripts/check-bank.mjs [--public-base https://… ] [--max-source 8]
 *                 [--sample 5] [--no-net] [--manifest public/data/manifest.json]
 * 环境变量：R2_PUBLIC_BASE（也可写在 .env）
 * 退出码：0 全部通过；1 存在问题（详情见输出）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, loadEnv } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))

await loadEnv(path.join(ROOT, '.env'))

// 与 SUMMARY §3.7 对应： Pages 构建若误跑 bank 会生成 remote 版 manifest（URL 指向源站），
// 这里默认按仓库里提交的 R2 域名断言；域名变更时用 --public-base / R2_PUBLIC_BASE 覆盖。
const DEFAULT_PUBLIC_BASE = 'https://bird.wewalk.world'
let PUBLIC_BASE = String(args['public-base'] || process.env.R2_PUBLIC_BASE || DEFAULT_PUBLIC_BASE)
if (!/^https?:\/\//i.test(PUBLIC_BASE)) PUBLIC_BASE = 'https://' + PUBLIC_BASE
PUBLIC_BASE = PUBLIC_BASE.replace(/\/$/, '')
const MAX_SOURCE_URL = args['max-source'] ? Number(args['max-source']) : 8
const SAMPLE = args.sample ? Number(args.sample) : 5
const DO_NET = !args['no-net']
const MANIFEST = path.resolve(ROOT, args.manifest || 'public/data/manifest.json')

const problems = []
const warn = []
const fail = (msg) => problems.push(msg)

function isR2Url(url) {
  return url.startsWith(`${PUBLIC_BASE}/`)
}

async function headOk(url) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

// ---- 1. 结构 ----
let manifest
try {
  manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
} catch (e) {
  console.error(`❌ 无法读取 manifest（${MANIFEST}）：${e.message}`)
  process.exit(1)
}

if (!Array.isArray(manifest.species) || !manifest.species.length) {
  fail('species 为空或不是数组')
} else {
  if (manifest.total !== manifest.species.length) {
    fail(`total(${manifest.total}) 与 species.length(${manifest.species.length}) 不一致`)
  }
  const withImage = manifest.species.filter((s) => s.image).length
  const withAudio = manifest.species.filter((s) => s.audio).length
  if (manifest.stats?.withImage !== withImage) {
    fail(`stats.withImage(${manifest.stats?.withImage}) 与实际(${withImage}) 不一致`)
  }
  if (manifest.stats?.withAudio !== withAudio) {
    fail(`stats.withAudio(${manifest.stats?.withAudio}) 与实际(${withAudio}) 不一致`)
  }

  const seenIds = new Set()
  for (const sp of manifest.species) {
    if (!sp.id || !sp.nameZh || !sp.nameSci || !sp.family) {
      fail(`物种缺少基础字段：${sp.id || sp.nameZh || JSON.stringify(sp).slice(0, 60)}`)
    }
    if (seenIds.has(sp.id)) fail(`物种 id 重复：${sp.id}`)
    seenIds.add(sp.id)

    for (const kind of ['image', 'audio']) {
      const a = sp[kind]
      if (!a) continue
      if (!a.url) fail(`${sp.id}.${kind} 缺少 url`)
      for (const f of ['license', 'author', 'source', 'sourceUrl']) {
        if (!a[f]) fail(`${sp.id}.${kind} 署名缺少 ${f}（CC 合规要求）`)
      }
    }
  }
}

// ---- 2. 归属：媒体 URL 必须是 R2 公开域名 ----
const nonR2 = []
for (const sp of manifest.species) {
  for (const kind of ['image', 'audio']) {
    const a = sp[kind]
    if (a?.url && !isR2Url(a.url)) nonR2.push(`${sp.id}.${kind}: ${a.url}`)
  }
}
if (nonR2.length > MAX_SOURCE_URL) {
  fail(`非 R2 媒体地址 ${nonR2.length} 个，超过阈值 ${MAX_SOURCE_URL}（疑似被 remote 版 manifest 覆盖）`)
  nonR2.slice(0, 5).forEach((u) => fail(`  · ${u}`))
} else if (nonR2.length) {
  warn.push(`非 R2 媒体地址 ${nonR2.length} 个（源站 404 保留原址，可接受）：`)
  nonR2.forEach((u) => warn.push(`  · ${u}`))
}

// ---- 3. 抽查可达 ----
let checked = 0
let bad = 0
if (DO_NET) {
  const r2Urls = []
  for (const sp of manifest.species) {
    for (const kind of ['image', 'audio']) {
      const a = sp[kind]
      if (a?.url && isR2Url(a.url)) r2Urls.push(a.url)
    }
  }
  const picked = [...r2Urls].sort(() => Math.random() - 0.5).slice(0, Math.max(0, SAMPLE))
  console.log(`🌐 抽查 ${picked.length}/${r2Urls.length} 个 R2 媒体…`)
  for (const url of picked) {
    checked++
    if (!(await headOk(url))) {
      bad++
      fail(`R2 媒体不可达（HEAD 非 2xx）：${url}`)
    }
  }
}

// ---- 汇总 ----
for (const w of warn) console.log(`⚠️  ${w}`)
if (problems.length) {
  console.error(`\n❌ 一致性校验未通过（${problems.length} 项）：`)
  problems.forEach((p) => console.error('   ' + p))
  process.exit(1)
}
console.log(
  `\n✅ 一致性校验通过：${manifest.species.length} 个物种，媒体归属 ${PUBLIC_BASE}` +
    (DO_NET ? `，抽查 ${checked} 个（失败 ${bad}）` : '，未联网抽查（--no-net）'),
)
