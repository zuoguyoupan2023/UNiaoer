#!/usr/bin/env node
/**
 * 构建「模型标签 → 本项目物种」的对表产物
 *
 *   npm run build:model-labels                    # 默认音频任务
 *   npm run build:model-labels -- --task audio
 *   npm run build:model-labels -- --task image --format speciesnet   # 旧 SpeciesNet
 *   npm run build:model-labels -- --task image --format osea \
 *     --model-labels experiments/birdid/cache/model/osea/bird_info.json --classes 11000
 *   npm run build:model-labels -- --report         # 额外打印 Tier4/5 清单
 *
 * 输入：
 *   --model-labels <path>   模型标签表，顺序即模型输出索引
 *                           audio：每行 `学名_英文名`（默认 data-cache/birdid/labels/en_us.txt）
 *                           image/speciesnet：`uuid;class;order;family;genus;species;俗名`
 *                           image/osea：`bird_info.json` = [[中文名, 英文名, 学名], ...]
 *   --format <fmt>            audio | speciesnet | osea（默认 audio；task=image 时默认 speciesnet）
 *   --out <path>            产物路径，默认 public/data/model-labels-<task>.json
 *   --overrides <path>      人工兜底表（默认 data/model-label-overrides.json；
 *                           OSEA 默认 data/model-label-overrides-osea.json）
 *                           键 = 模型标签原文，值 = 本项目 speciesId；**优先级高于五级匹配**
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
 *   —— T0 之外还有 overrides：分类拆分/合并造成对不上的种由人工指定（docs/057），
 *      优先级最高，直接记为 T1。
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
const IMAGE_TASK = TASK === 'image'
/**
 * 图像标签有两种格式：
 *   speciesnet = 结构化分号标签（docs/057 §1.1）
 *   osea       = HF `bird_info.json`（[[中文名, 英文名, 学名], ...]）
 * 音频 = BirdNET（`学名_英文名`）。
 */
const FORMAT = argOf('--format', IMAGE_TASK ? 'speciesnet' : 'birdnet')
const IS_OSEA = IMAGE_TASK && FORMAT === 'osea'
const IS_IMAGE = IMAGE_TASK
const LABELS = argOf(
  '--model-labels',
  IS_OSEA
    ? path.join(ROOT, 'experiments/birdid/cache/model/osea/bird_info.json')
    : IS_IMAGE
      ? path.join(ROOT, 'experiments/birdid/cache/model/speciesnet-labels.txt')
      : path.join(ROOT, 'data-cache/birdid/labels/en_us.txt'),
)
const OUT = argOf('--out', path.join(ROOT, `public/data/model-labels-${TASK}.json`))
const MIN_TIER12 = Number(argOf('--min-exact', '0.85'))
const SHOW = args.includes('--report')
const OVERRIDES_PATH = argOf(
  '--overrides',
  path.join(ROOT, IS_OSEA ? 'data/model-label-overrides-osea.json' : 'data/model-label-overrides.json'),
)

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
  console.error('  标签表不入库。取法见 experiments/birdid/README.md（BirdNET 在 data-cache/birdid/labels/，SpeciesNet 在 cache/model/）。')
  process.exit(2)
}

/**
 * 读取标签表。OSEA 是 JSON 数组（[中文名, 英文名, 学名]），其余是逐行文本。
 */
let rawLineCount = 0
let rawEntries = []
if (IS_OSEA) {
  const info = JSON.parse(fs.readFileSync(LABELS, 'utf8'))
  if (!Array.isArray(info)) {
    console.error(`✗ OSEA 标签表必须是数组：${LABELS}`)
    process.exit(2)
  }
  rawLineCount = info.length
  rawEntries = info.map((row, i) => ({
    zh: String(row?.[0] ?? '').trim(),
    en: String(row?.[1] ?? '').trim(),
    sci: String(row?.[2] ?? '').trim(),
    i,
  }))
} else {
  const rawLines = fs
    .readFileSync(LABELS, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  rawLineCount = rawLines.length
  rawEntries = rawLines.map((line) => ({ line }))
}

/**
 * 解析成统一形状 { label, sci, en, zh }。
 *  - audio：BirdNET 的 `学名_英文名`；无 `_` 时整行当英文名。
 *  - image/speciesnet：`uuid;class;order;family;genus;species;俗名`
 *    只留 `class === 'aves'` 的**种级**标签（species 字段是 order/family/genus/species
 *    这类上位分类占位符的直接丢掉 —— 它们根本不是种，展示没有意义，见 docs/057 §0）。
 *  - image/osea：`[中文名, 英文名, 学名]`，全部都是鸟种，不做非鸟过滤。
 *
 * ⚠️ `orderedLabels` 必须**保留每一行**（含被过滤掉的），顺序即模型输出下标：
 * 运行时按 `labels[i]` 取标签（src/core/birdId/labels.ts），一旦这里少一行，
 * 后面所有下标全部错位 → 每个预测都会挂到不相干的物种上。实测踩过这个坑。
 */
const UPPER_RANK = new Set(['order', 'family', 'genus', 'species', 'subspecies', 'suborder', 'subfamily'])
const parsed = []
const orderedLabels = []
let skippedNonAves = 0
let skippedUpper = 0

for (const entry of rawEntries) {
  if (IS_OSEA) {
    const { zh, en, sci, i } = entry
    // 标签键保持 `学名_英文名`，与 BirdNET/对表习惯一致；极端情况下回退到非空字段。
    const label = sci && en ? `${sci}_${en}` : sci || en || `unlabeled-${i}`
    orderedLabels.push(label)
    parsed.push({ label, sci, en, zh })
    continue
  }
  if (IS_IMAGE) {
    const line = entry.line
    if (/^uuid\b/i.test(line)) continue // 元数据表头，不是类别
    const p = line.split(';')
    const genus = (p[4] || '').trim()
    const species = (p[5] || '').trim().toLowerCase()
    const en = (p[6] || '').trim()
    const aves = (p[1] || '').trim().toLowerCase() === 'aves'
    const isSpecies = aves && genus && species && !UPPER_RANK.has(species)
    // 非鸟 / 上位分类标签也占一个模型下标，必须占位，否则下标错位
    orderedLabels.push(genus && species ? `${genus} ${species}${en ? '_' + en : ''}` : en)
    if (!isSpecies) {
      if (!aves) skippedNonAves++
      else skippedUpper++
      continue
    }
    const sci = `${genus} ${species}`
    parsed.push({ label: en ? `${sci}_${en}` : sci, sci, en, zh: '' })
  } else {
    const line = entry.line
    const u = line.indexOf('_')
    const sci = u > 0 ? line.slice(0, u).trim() : ''
    const en = u > 0 ? line.slice(u + 1).trim() : line
    orderedLabels.push(line)
    parsed.push({ label: line, sci, en, zh: '' })
  }
}
const rawLabels = parsed.map((x) => x.label)

// 模型输出类别数对不上就别写产物：宁可什么都不产出，也不要一个下标错位的产物。
// OSEA 的 bird_info.json 只有 10,964 条，而 fc 是 11,000 类 → 末尾 36 个输出没有标签，
// 用无下划线的 `unlabeled-<i>` 占位（运行时 entries 查不到，会自动被过滤）。
const EXPECT_CLASSES = Number(argOf('--classes', '0'))
if (EXPECT_CLASSES > 0 && orderedLabels.length !== EXPECT_CLASSES) {
  if (IS_OSEA && orderedLabels.length < EXPECT_CLASSES) {
    const missing = EXPECT_CLASSES - orderedLabels.length
    for (let i = 0; i < missing; i++) orderedLabels.push(`unlabeled-${orderedLabels.length}`)
    console.warn(`⚠ OSEA 标签 ${rawLabels.length} 条 < 模型输出 ${EXPECT_CLASSES} 类，末尾 ${missing} 类按无标签占位`)
  } else {
    console.error(
      `✗ 标签表 ${orderedLabels.length} 行 ≠ 模型输出 ${EXPECT_CLASSES} 类；` +
        `产物下标会错位，拒绝写入。核对模型版本或用 --classes 显式声明类别数。`,
    )
    process.exit(2)
  }
}

const indexRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
const index = indexRaw.species ?? indexRaw

// speciesId 的来源顺序（2026-10-17 修）：
//   ① 名录权威层 manifest-meta.json —— 随前端一起发布的产物，覆盖全部 10,844 种，
//      含 taxonKey 与 playableImage/playableAudio；
//   ② 采集台账 data-cache/manifest-global.json —— 只是**构建期**的采集状态，会滞后，
//      而且**不含核心库的种**（实测：白头鹎 pycnonotus-sinensis 在名录里 img/audio 都有，
//      台账里却没有）→ 旧实现只查台账，把这类种全判成 s:null，UI 就对用户说
//      「已对上但暂无素材」，而素材其实就在。
const byIdTaxon = new Map() // taxonKey -> { id, hasMedia }
const addSource = (doc, pick) => {
  const list = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc.species ?? doc) : doc
  for (const s of Array.isArray(list) ? list : Object.values(list || {})) {
    if (!s || !s.taxonKey || !s.id || byIdTaxon.has(s.taxonKey)) continue
    byIdTaxon.set(s.taxonKey, { id: s.id, hasMedia: pick(s) })
  }
}

const metaPath = path.join(ROOT, 'public/data/manifest-meta.json')
if (fs.existsSync(metaPath)) {
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  addSource(meta, (s) => Boolean(s.playableImage || s.playableAudio))
}
const ledgerPath = path.join(ROOT, 'data-cache/manifest-global.json')
if (fs.existsSync(ledgerPath)) {
  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  addSource(led, (s) => Boolean((s.images || []).length || (s.audios || []).length))
}
const idByTaxon = new Map([...byIdTaxon].map(([k, v]) => [k, v.id]))
const mediaByTaxon = new Map([...byIdTaxon].map(([k, v]) => [k, v.hasMedia]))

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

// overrides（docs/057）：键 = 模型标签原文 → 值 = 本项目 speciesId。
// 分类学变动（拆分/合并）造成的对不上的种由人工指定，**优先级高于五级匹配**。
// 只对 image（SpeciesNet）生效：这张表里的键全是 SpeciesNet 标签原文，
// 音频侧走 BirdNET/eBird 体系且命中率已达标，不需要兜底（docs/057 §3）。
let overrides = {}
if (IS_IMAGE && fs.existsSync(OVERRIDES_PATH)) {
  const parsedOv = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
  for (const [k, v] of Object.entries(parsedOv)) {
    if (typeof v !== 'string' || !v) {
      console.error(`✗ overrides["${k}"] 的值必须是 speciesId 字符串，得到 ${JSON.stringify(v)}`)
      process.exit(2)
    }
    overrides[k] = v
  }
}

/** speciesId → 展示名（overrides 命中后要显示中文名；id 不在 index 里，只有台账/产物有） */
const nameById = new Map()
const collectIds = (file) => {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) return
  const d = JSON.parse(fs.readFileSync(p, 'utf8'))
  const list = d.species ?? d
  for (const x of Array.isArray(list) ? list : Object.values(list)) {
    if (x && x.id && !nameById.has(x.id)) nameById.set(x.id, x.nameZh || x.nameEn || null)
  }
}
collectIds('public/data/manifest-meta.json')
collectIds('data/taxa.json')

const entries = {}
const tiers = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
const genusOnly = []
const unmatched = []
const overridden = []
const staleOverrides = []

for (const { label, sci, en, zh } of parsed) {
  let tier = 5
  let hit = null
  let forcedId = null

  // overrides 最高优先：直接把标签钉到指定 speciesId（记为 T1）
  if (Object.hasOwn(overrides, label)) {
    forcedId = overrides[label]
    tier = 1
    overridden.push({ label, speciesId: forcedId, exists: nameById.has(forcedId) })
  }

  if (!hit && !forcedId) {
    if (sci) {
      hit = bySci.get(norm(sci))
      if (hit) tier = 1
    }
    if (!hit && en) {
      hit = byEn.get(norm(en))
      if (hit) tier = 2
    }
    // OSEA 的 bird_info 第 1 列是中文名，但**不拿它做匹配**：
    // DIB-10K 的中文名与 AviList 拆分/合并后的种不是一一对应（同名不同种），
    // 按中文名硬匹配会把 251 条分类拆分标签静默指到错误物种。
    // 中文名只用于展示（entries[].z），匹配只认学名/英文名。
    if (!hit && zh && !IS_OSEA) {
      hit = byZh.get(norm(zh))
      if (hit) tier = 3
    }
    if (!hit && en && !/_/.test(en)) {
      hit = byZh.get(norm(en))
      if (hit) tier = 3
    }
  }
  let genus = null
  if (!hit && !forcedId) {
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
    s: forcedId ?? (hit ? (idByTaxon.get(hit.taxonKey) ?? null) : null),
    t: tier,
    z: forcedId ? (nameById.get(forcedId) ?? null) : hit ? (hit.nameZh || hit.nameEn || null) : zh || null,
    g: genus,
    // 有无素材（名录权威层口径）：false 时 UI 才能诚实说「本项目收录了，但暂无素材」；
    // 未参与 overrides 的种按 taxonKey 查，overrides 的种按 id 判（无台账信息时给 null）
    p: forcedId
      ? null
      : hit
        ? (mediaByTaxon.get(hit.taxonKey) ?? null)
        : null,
  }
}

// overrides 里写了、但这次标签表里根本不存在的键 —— 多半是手滑打错或模型换版
for (const [k, v] of Object.entries(overrides)) {
  if (!Object.hasOwn(entries, k)) staleOverrides.push({ label: k, speciesId: v })
}

const exact = tiers[1] + tiers[2] + tiers[3]
const rate = exact / rawLabels.length
const playable = Object.values(entries).filter((e) => e.s).length

const out = {
  task: TASK,
  model: path.basename(path.dirname(LABELS)) + '/' + path.basename(LABELS),
  generatedAt: new Date().toISOString(),
  /** 模型输出类别数 = labels.length（运行时按下标取标签，两者必须相等） */
  classCount: orderedLabels.length,
  /** labels[i] = 模型第 i 类输出的标签原文，**顺序即下标，不可过滤** */
  labels: orderedLabels,
  /** labels.length（含被过滤的非鸟/上位分类标签） */
  labelCount: orderedLabels.length,
  /** entries 的条数（种级标签数） */
  speciesLabelCount: rawLabels.length,
  exactRate: Number(rate.toFixed(4)),
  tiers,
  entries,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out))

const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
console.log(`\n模型标签 → 项目物种 对表（${TASK}）`)
if (IS_IMAGE && !IS_OSEA) {
  console.log(`  原始行数      ${rawLineCount}（非鸟 ${skippedNonAves} · 上位分类标签 ${skippedUpper} 已丢弃）`)
} else if (IS_OSEA) {
  console.log(`  OSEA 标签     ${rawLineCount} 条（模型输出 ${orderedLabels.length} 类，末尾无标签已占位）`)
}
console.log(`  标签总数      ${rawLabels.length}（模型类别 ${orderedLabels.length}）`)
console.log(`  T1 学名精确   ${tiers[1]}`)
console.log(`  T2 英文名精确 ${tiers[2]}`)
console.log(`  T3 中文名     ${tiers[3]}`)
console.log(`  精确合计      ${exact}  (${(rate * 100).toFixed(1)}%)  门槛 ${(MIN_TIER12 * 100).toFixed(0)}%`)
console.log(`  T4 仅属名     ${tiers[4]}  诚实降级`)
console.log(`  T5 未命中     ${tiers[5]}`)
console.log(`  可播放映射    ${playable} / ${exact}  (${((playable / exact) * 100).toFixed(1)}%)  随 053 采集完成上升`)
console.log(`  产物          ${path.relative(ROOT, OUT)}  (${kb} KB)`)
if (IS_IMAGE) console.log(`  overrides     ${overridden.length} 条生效  ${path.relative(ROOT, OVERRIDES_PATH)}`)

if (overridden.some((o) => !o.exists)) {
  console.error(`\n⛔ 有 overrides 的 speciesId 在 manifest-meta.json / taxa.json 里不存在：`)
  for (const o of overridden.filter((x) => !x.exists)) console.error(`    ${o.label} → ${o.speciesId}`)
  process.exit(1)
}
if (staleOverrides.length) {
  console.error(`\n⛔ 有 ${staleOverrides.length} 条 overrides 的键在本次标签表里找不到（打错？模型换版？）：`)
  for (const o of staleOverrides.slice(0, 20)) console.error(`    ${o.label} → ${o.speciesId}`)
  process.exit(1)
}

if (SHOW) {
  console.log(`\n  ── T4 仅属名（共 ${genusOnly.length}，人工判断是否分类拆分）:`)
  for (const g of genusOnly) console.log(`    ${g.label} → ${g.genus}（项目内 ${g.inProject} 种）`)
  console.log(
    `\n  ── T5 未命中（共 ${unmatched.length}，填进 ${path.relative(ROOT, OVERRIDES_PATH)} 的是真漏配）:`,
  )
  for (const l of unmatched) console.log(`    ${l}`)
}

if (rate < MIN_TIER12) {
  console.error(`\n⛔ 精确命中率 ${(rate * 100).toFixed(1)}% 跌破门槛 ${(MIN_TIER12 * 100).toFixed(0)}%`)
  process.exit(1)
}
console.log('')