#!/usr/bin/env node
/**
 * 构建「模型标签 → 本项目物种」的对表产物
 *
 *   npm run build:model-labels                    # 默认音频任务
 *   npm run build:model-labels -- --task audio
 *   npm run build:model-labels -- --report        # 额外打印命中率报告
 *
 * 输入：
 *   --model-labels <path>   模型标签表（每行 `学名_英文名`，顺序即模型输出索引）
 *                           默认读 data-cache/birdid/labels/en_us.txt
 *   --out <path>            产物路径，默认 public/data/model-labels-<task>.json
 *
 * 产物（运行时唯一需要的东西）：
 *   public/data/model-labels-audio.json
 *     { task, model, generatedAt, labelCount, tiers:{...}, entries: { "<标签>": {
 *         s: speciesId|null, t: tier, z: 中文名|null, g: 属名|null } } }
 *   键是**模型标签原文**（运行时模型输出什么就查什么），value 用短字段名以压体积。
 *
 * 匹配分级（docs/055 §2.2）：
 *   T1 学名精确 / T2 英文名精确 / T3 中文名 / T4 仅属名 / T5 未命中
 *   —— 只用精确规则，**不做模糊匹配**：宁可报"不认识"，也不给错物种的素材。
 *
 * 退出码：0 命中率达标 / 1 跌破门槛（门禁用）
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const argOf = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const TASK = argOf('--task', 'audio')
const LABELS = argOf('--model-labels', path.join(ROOT, `data-cache/birdid/labels/en_us.txt`))
const OUT = argOf('--out', path.join(ROOT, `public/data/model-labels-${TASK}.json`))
const MIN_TIER12 = Number(argOf('--min-exact', '0.85'))
const SHOW = args.includes('--report')

/** 小写 + 去标点 + 统一连字符/撇号/&，两侧命名差异的常见来源 */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

if (!fs.existsSync(LABELS)) {
  console.error(`✗ 找不到标签表 ${LABELS}`)
  console.error('  标签表不入库。用 experiments/birdid/README.md 里的下载步骤取到 data-cache/birdid/labels/。')
  process.exit(2)
}

const rawLabels = fs
  .readFileSync(LABELS, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

const indexRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
const index = indexRaw.species ?? indexRaw

// speciesId 只存在于台账，且台账只含「可播放」的种 —— 这正是我们要的：
// 对得上但还没采到素材的种，映射为 null，UI 会显示「已对上但暂无素材」。
const ledgerPath = path.join(ROOT, 'data-cache/manifest-global.json')
let idByTaxon = new Map()
if (fs.existsSync(ledgerPath)) {
  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  const sp = led.species ?? led
  idByTaxon = new Map(
    (Array.isArray(sp) ? sp : Object.values(sp)).filter((x) => x.taxonKey).map((x) => [x.taxonKey, x.id]),
  )
}

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

const entries = {}
const tiers = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
const genusOnly = []
const unmatched = []

for (const label of rawLabels) {
  const u = label.indexOf('_')
  const sci = u > 0 ? label.slice(0, u).trim() : ''
  const en = u > 0 ? label.slice(u + 1).trim() : label

  let tier = 5
  let hit = null

  if (sci) {
    hit = bySci.get(norm(sci))
    if (hit) tier = 1
  }
  if (!hit && en) {
    hit = byEn.get(norm(en))
    if (hit) tier = 2
  }
  if (!hit && en && !/_/.test(en)) {
    hit = byZh.get(norm(en))
    if (hit) tier = 3
  }
  let genus = null
  if (!hit) {
    const g = norm(sci).split(' ')[0]
    if (g && byGenus.has(g)) {
      genus = g
      tier = 4
    }
  }

  tiers[tier]++
  if (tier === 4) genusOnly.push({ label, genus, inProject: byGenus.get(genus)?.length ?? 0 })
  if (tier === 5) unmatched.push(label)

  entries[label] = {
    s: hit ? (idByTaxon.get(hit.taxonKey) ?? null) : null,
    t: tier,
    z: hit ? (hit.nameZh || hit.nameEn || null) : null,
    g: genus,
  }
}

const exact = tiers[1] + tiers[2] + tiers[3]
const rate = exact / rawLabels.length
const playable = Object.values(entries).filter((e) => e.s).length

const out = {
  task: TASK,
  model: path.basename(path.dirname(LABELS)) + '/' + path.basename(LABELS),
  generatedAt: new Date().toISOString(),
  labelCount: rawLabels.length,
  exactRate: Number(rate.toFixed(4)),
  tiers,
  entries,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out))

const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
console.log(`\n模型标签 → 项目物种 对表（${TASK}）`)
console.log(`  标签总数      ${rawLabels.length}`)
console.log(`  T1 学名精确   ${tiers[1]}`)
console.log(`  T2 英文名精确 ${tiers[2]}`)
console.log(`  T3 中文名     ${tiers[3]}`)
console.log(`  精确合计      ${exact}  (${(rate * 100).toFixed(1)}%)  门槛 ${(MIN_TIER12 * 100).toFixed(0)}%`)
console.log(`  T4 仅属名     ${tiers[4]}  诚实降级`)
console.log(`  T5 未命中     ${tiers[5]}`)
console.log(`  可播放映射    ${playable} / ${exact}  (${((playable / exact) * 100).toFixed(1)}%)  随 053 采集完成上升`)
console.log(`  产物          ${path.relative(ROOT, OUT)}  (${kb} KB)`)

if (SHOW) {
  console.log(`\n  T5 未命中前 10（应多为非鸟）:`)
  for (const l of unmatched.slice(0, 10)) console.log(`    ${l}`)
  console.log(`\n  T4 仅属名前 10:`)
  for (const g of genusOnly.slice(0, 10)) console.log(`    ${g.label} → ${g.genus}(项目内 ${g.inProject} 种)`)
}

if (rate < MIN_TIER12) {
  console.error(`\n⛔ 精确命中率 ${(rate * 100).toFixed(1)}% 跌破门槛 ${(MIN_TIER12 * 100).toFixed(0)}%`)
  process.exit(1)
}
console.log('')