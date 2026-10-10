#!/usr/bin/env node
/**
 * A3 / S6：构建后一致性校验 —— **权威层 meta + 全量 assets 分片**。
 *   1) 结构：meta.total/stats 与实际一致；id 唯一；基础字段齐备（中文名可缺）。
 *   2) 可玩：meta 的 playableImage/playableAudio 与 assets 分片实际素材一致。
 *   3) 署名与归属：每条素材必须带完整署名（author/license/source/sourceUrl）；
 *      媒体 URL 必须指向 R2 公开域名（防 Pages 构建跑 bank 覆盖成 remote 版）。
 *   4) 抽查：随机抽 N 个 R2 媒体 HEAD 一次，期望 200（--no-net 跳过）。
 *
 * 用法：node scripts/check-bank.mjs [--public-base https://… ] [--max-source 8] [--sample 5] [--no-net]
 * 环境变量：R2_PUBLIC_BASE（也可写在 .env）
 * 退出码：0 全部通过；1 存在问题
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, loadEnv } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
await loadEnv(path.join(ROOT, '.env'))

const DEFAULT_PUBLIC_BASE = 'https://bird.wewalk.world'
let PUBLIC_BASE = String(args['public-base'] || process.env.R2_PUBLIC_BASE || DEFAULT_PUBLIC_BASE)
if (!/^https?:\/\//i.test(PUBLIC_BASE)) PUBLIC_BASE = 'https://' + PUBLIC_BASE
PUBLIC_BASE = PUBLIC_BASE.replace(/\/$/, '')
const MAX_SOURCE_URL = args['max-source'] ? Number(args['max-source']) : 8
const SAMPLE = args.sample ? Number(args.sample) : 5
const DO_NET = !args['no-net']

const DATA = path.join(ROOT, 'public/data')
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

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

// ---- 0. 读取 meta + assets ----
let meta
try {
  meta = await readJson(path.join(DATA, 'manifest-meta.json'))
} catch (e) {
  console.error(`❌ 无法读取 manifest-meta.json：${e.message}`)
  process.exit(1)
}
const assetFiles = (await fs.readdir(path.join(DATA, 'assets')).catch(() => [])).filter((f) => f.endsWith('.json'))
const assetById = new Map()
for (const f of assetFiles) {
  const doc = await readJson(path.join(DATA, 'assets', f))
  for (const [id, e] of Object.entries(doc.species || {})) {
    assetById.set(id, { images: e.images || [], audios: e.audios || [] })
  }
}

// ---- 1. 结构 ----
if (!Array.isArray(meta.species) || !meta.species.length) {
  fail('meta.species 为空或不是数组')
} else {
  if (meta.total !== meta.species.length) {
    fail(`total(${meta.total}) 与 species.length(${meta.species.length}) 不一致`)
  }
  const seenIds = new Set()
  let badPlayable = 0
  let missOriginal = 0
  let missSourceId = 0
  let withImg = 0
  let withAud = 0
  for (const sp of meta.species) {
    // 中文名可缺（长尾全球种约半数无中文名）；id/学名/科必填
    if (!sp.id || !sp.nameSci || !sp.family) {
      fail(`物种缺少基础字段：${sp.id || sp.nameSci || JSON.stringify(sp).slice(0, 60)}`)
    }
    if (seenIds.has(sp.id)) fail(`物种 id 重复：${sp.id}`)
    seenIds.add(sp.id)

    const e = assetById.get(sp.id)
    const pi = (e?.images?.length || 0) >= 1
    const pa = (e?.audios?.length || 0) >= 1
    if (pi) withImg++
    if (pa) withAud++
    if (sp.playableImage !== pi || sp.playableAudio !== pa || sp.playable !== (pi || pa)) {
      badPlayable++
      if (badPlayable <= 5) fail(`playable* 与素材不一致：${sp.id}(image ${sp.playableImage}/${pi} audio ${sp.playableAudio}/${pa})`)
    }

    // 答疑专栏说明（011 §9）：出现时四字段必须非空
    if (sp.notes) {
      for (const f of ['titleZh', 'titleEn', 'bodyZh', 'bodyEn']) {
        const v = sp.notes[f]
        if (typeof v !== 'string' || !v.trim()) fail(`${sp.id}.notes.${f} 缺失或为空`)
      }
    }
    // 物种档案（C1）：枚举合法
    if (sp.profile) {
      const { group, migration, distribution } = sp.profile
      if (group && !['waterbird', 'raptor', 'landbird'].includes(group)) fail(`${sp.id}.profile.group 非法：${group}`)
      if (migration && !['resident', 'summer', 'winter', 'passage', 'migrant', 'vagrant'].includes(migration)) {
        fail(`${sp.id}.profile.migration 非法：${migration}`)
      }
      if (distribution && typeof distribution.count !== 'number') fail(`${sp.id}.profile.distribution.count 不是数字`)
    }
  }
  if (badPlayable > 5) fail(`playable* 与素材不一致共 ${badPlayable} 处（仅列前 5）`)

  // universe 口径与 assets 实际一致
  if (meta.universe) {
    if (meta.universe.withImage !== withImg) fail(`universe.withImage(${meta.universe.withImage}) ≠ 分片实际(${withImg})`)
    if (meta.universe.withAudio !== withAud) fail(`universe.withAudio(${meta.universe.withAudio}) ≠ 分片实际(${withAud})`)
  }

  // ---- 2. 署名 + 归属（逐条素材） ----
  const nonR2 = []
  const sampleUrls = []
  for (const [id, e] of assetById) {
    for (const [kind, list] of [['image', e.images], ['audio', e.audios]]) {
      for (const a of list) {
        if (!a.url) fail(`${id}.${kind} 缺少 url`)
        for (const f of ['license', 'author', 'source', 'sourceUrl']) {
          if (!a[f]) fail(`${id}.${kind} 署名缺少 ${f}（CC 合规要求）`)
        }
        if (!a.originalUrl) missOriginal++
        if (!a.sourceId) missSourceId++
        for (const field of ['url', 'thumbUrl', 'xlUrl', 'avifUrl']) {
          const u = a[field]
          if (u && !isR2Url(u)) nonR2.push(`${id}.${kind}.${field}: ${u}`)
        }
        if (a.url && isR2Url(a.url)) sampleUrls.push(a.url)
      }
    }
  }
  if (missOriginal) warn.push(`有 ${missOriginal} 个素材缺少 originalUrl（重跑 M3 后应归零）`)
  if (missSourceId) warn.push(`有 ${missSourceId} 个素材缺少 sourceId（可接受但建议补）`)
  if (nonR2.length > MAX_SOURCE_URL) {
    fail(`非 R2 媒体地址 ${nonR2.length} 个，超过阈值 ${MAX_SOURCE_URL}（疑似被 remote 版覆盖）`)
    nonR2.slice(0, 5).forEach((u) => fail(`  · ${u}`))
  } else if (nonR2.length) {
    warn.push(`非 R2 媒体地址 ${nonR2.length} 个（源站 404 保留原址，可接受）`)
  }

  // ---- 3. 抽查 ----
  let checked = 0
  let bad = 0
  if (DO_NET) {
    const picked = [...sampleUrls].sort(() => Math.random() - 0.5).slice(0, Math.max(0, SAMPLE))
    console.log(`🌐 抽查 ${picked.length}/${sampleUrls.length} 个 R2 媒体…`)
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
    `\n✅ 一致性校验通过：${meta.total} 个物种 · ${assetFiles.length} 分片 · 媒体归属 ${PUBLIC_BASE}` +
      (DO_NET ? `，抽查 ${checked} 个（失败 ${bad}）` : '，未联网抽查（--no-net）'),
  )
}
