#!/usr/bin/env node
/**
 * [实验/P0] BirdNET 2.4 标签 → 本项目物种 的对表命中率测量
 *
 *   node experiments/birdid/label-match.mjs
 *
 * 这是 docs/055 §8 的 P0:在写任何前端代码之前,先回答
 * 「模型输出能不能对上我们项目里的鸟」。
 * 对不上,整个功能就没有价值 —— 这个结论不需要写一行 UI 就能拿到。
 *
 * 标签格式(BirdNET 2.4 实测):`学名_英文名`,6,522 行,顺序即模型输出索引。
 * 例:`Abroscopus albogularis_Rufous-faced Warbler`
 * 另附 labels/zh.txt 给中文名,可对上本项目 nameZh。
 *
 * 匹配分级(与 docs/055 §2.2 一致):
 *   T1 学名精确   nameSci  —— 标签自带学名,应是最强路径
 *   T2 英文名精确 nameEn
 *   T3 ebirdCode  (借 BirdNET-Analyzer 的 eBird 2024E 代码表)
 *   T4 仅属名命中(诚实降级,不冒充具体种)
 *   T5 未命中
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const LABELS = path.join(ROOT, 'experiments/birdid/cache/model/labels/en_us.txt')
const ZH = path.join(ROOT, 'experiments/birdid/cache/model/labels/zh.txt')
const EBIRD = path.join(ROOT, 'experiments/birdid/vendor/ebird_taxonomy_2024E.json')
const INDEX = path.join(ROOT, 'public/data/species-index.json')
const LEDGER = path.join(ROOT, 'data-cache/manifest-global.json')
const OUT = path.join(ROOT, 'experiments/birdid/out')

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

const rawLabels = fs.readFileSync(LABELS, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const zhLines = fs.existsSync(ZH) ? fs.readFileSync(ZH, 'utf8').split('\n') : []
const indexRaw = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
const index = indexRaw.species ?? (Array.isArray(indexRaw) ? indexRaw : Object.values(indexRaw))

// speciesId 不在 species-index 里(它只有 taxonKey),要从台账补 ——
// 台账同时只含「可播放」的种,这正是我们要的:对不上的种本来就没素材可展示
const ledgerRaw = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
const ledgerSp = ledgerRaw.species ?? (Array.isArray(ledgerRaw) ? ledgerRaw : Object.values(ledgerRaw))
const idByTaxon = new Map(ledgerSp.filter((x) => x.taxonKey).map((x) => [x.taxonKey, x.id]))

// ---- 建索引 ----
const bySci = new Map()
const byEn = new Map()
const byZh = new Map()
const byGenus = new Map()
for (const s of index) {
  if (s.nameSci) bySci.set(norm(s.nameSci), s)
  if (s.nameEn) byEn.set(norm(s.nameEn), s)
  if (s.nameZh) byZh.set(norm(s.nameZh), s)
  const g = String(s.nameSci || '').split(' ')[0].toLowerCase()
  if (g) {
    if (!byGenus.has(g)) byGenus.set(g, [])
    byGenus.get(g).push(s)
  }
}

// eBird 代码表: `学名_英文名` -> code,以及 code -> 同一串
const ebird = fs.existsSync(EBIRD) ? JSON.parse(fs.readFileSync(EBIRD, 'utf8')) : {}
const ebirdByName = new Map()
for (const [k, v] of Object.entries(ebird)) {
  if (typeof v === 'string' && v.length <= 12) ebirdByName.set(norm(k), v) // code -> name 方向
}

// ---- 逐标签匹配 ----
const rows = []
for (let i = 0; i < rawLabels.length; i++) {
  const label = rawLabels[i]
  const us = label.indexOf('_')
  const sci = us > 0 ? label.slice(0, us).trim() : ''
  const en = us > 0 ? label.slice(us + 1).trim() : label
  const zh = (zhLines[i] || '').trim()

  let tier = 5
  let hit = null
  let matchedBy = null

  // T1 学名精确 —— 标签自带学名,先试它
  if (sci) {
    hit = bySci.get(norm(sci))
    if (hit) {
      tier = 1
      matchedBy = 'nameSci'
    }
  }
  // T2 英文名精确
  if (!hit && en) {
    hit = byEn.get(norm(en))
    if (hit) {
      tier = 2
      matchedBy = 'nameEn'
    }
  }
  // T3 中文名(BirdNET 自带 zh 标签 ↔ 本项目 nameZh)
  if (!hit && zh && !/_/.test(zh)) {
    hit = byZh.get(norm(zh))
    if (hit) {
      tier = 3
      matchedBy = 'nameZh'
    }
  }
  // T4 仅属名
  let genus = null
  if (!hit) {
    const g = norm(sci).split(' ')[0]
    if (g && byGenus.has(g)) {
      genus = g
      tier = 4
      matchedBy = 'genusOnly'
    }
  }

  rows.push({ idx: i, label, sci, en, zh, tier, matchedBy, hit, genus })
}

// ---- 统计 ----
const total = rows.length
const count = (t) => rows.filter((r) => r.tier === t).length
const t1 = count(1)
const t2 = count(2)
const t3 = count(3)
const t4 = count(4)
const t5 = count(5)
const exact = t1 + t2 + t3

const speciesSet = new Set(rows.filter((r) => r.hit).map((r) => r.hit.taxonKey))

console.log(`\n${'='.repeat(68)}`)
console.log(`  BirdNET 2.4 标签 → UNiaoer 物种 对表测量(P0)`)
console.log(`${'='.repeat(68)}\n`)
console.log(`  标签总数        ${total}`)
console.log(`  本项目物种      ${index.length}`)
console.log(`  标签格式        \`学名_英文名\`(实测)\n`)
console.log(`  ── 匹配结果 ──`)
console.log(`  T1 学名精确     ${String(t1).padStart(5)}  (${((t1 / total) * 100).toFixed(1)}%)`)
console.log(`  T2 英文名精确   ${String(t2).padStart(5)}  (${((t2 / total) * 100).toFixed(1)}%)`)
console.log(`  T3 中文名       ${String(t3).padStart(5)}  (${((t3 / total) * 100).toFixed(1)}%)`)
console.log(`  ─────────────────────`)
console.log(`  精确命中合计    ${String(exact).padStart(5)}  (${((exact / total) * 100).toFixed(1)}%)  ← 顶到 85% 即达标`)
console.log(`  T4 仅属名       ${String(t4).padStart(5)}  (${((t4 / total) * 100).toFixed(1)}%)  诚实降级`)
console.log(`  T5 完全未命中   ${String(t5).padStart(5)}  (${((t5 / total) * 100).toFixed(1)}%)`)
console.log(`\n  命中标签覆盖到的不同物种: ${speciesSet.size} / ${index.length}`)

// 未命中的样本:判断是真没有,还是命名差异
const miss = rows.filter((r) => r.tier === 5)
console.log(`\n  ── T5 未命中样本(前 15)──`)
for (const r of miss.slice(0, 15)) console.log(`    ${r.label}`)
console.log(`\n  ── T4 仅属名样本(前 8)──`)
for (const r of rows.filter((r) => r.tier === 4).slice(0, 8)) {
  console.log(`    ${r.label}   → 本项目 ${r.genus} 属 ${byGenus.get(r.genus).length} 种`)
}

// 中文名覆盖:能否多一条对表路径
const zhUsable = rows.filter((r) => r.zh && !/_/.test(r.zh))
console.log(`\n  ── 中文名标签可用性 ──`)
console.log(`    zh 标签非回退英文的条数: ${zhUsable.length} / ${total}`)
console.log(`    其中经中文名命中本项目的  : ${t3}(可能已被 T1/T2 抢先命中)`)

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(
  path.join(OUT, 'label-match-report.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      labelFile: path.relative(ROOT, LABELS),
      total,
      tiers: { t1, t2, t3, t4, t5 },
      exactRate: exact / total,
      distinctSpeciesCovered: speciesSet.size,
      projectSpecies: index.length,
      rows: rows.map(({ idx, label, sci, en, zh, tier, matchedBy, genus }) => ({
        idx,
        label,
        tier,
        matchedBy,
        genus,
        taxonKey: rows[idx].hit?.taxonKey ?? null,
        speciesId: rows[idx].hit ? (idByTaxon.get(rows[idx].hit.taxonKey) ?? null) : null,
        nameZh: rows[idx].hit?.nameZh ?? null,
      })),
    },
    null,
    2,
  ),
)
console.log(`\n  报告: ${path.relative(ROOT, path.join(OUT, 'label-match-report.json'))}\n`)