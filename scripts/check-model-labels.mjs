/**
 * 057:模型标签对表门禁(纯本地,不联网;对齐 check-species-index 惯例)。
 *
 * 校验三件事:
 *  1. data/model-label-overrides.json 里每个 speciesId **真实存在于本项目**
 *     (拼错 id 会静默失效:标签照样报 T1,却指到一个不存在的物种);
 *  2. 同一 speciesId 不被多条 overrides 重复占用(一个种被两个模型标签抢,
 *     等于承认其中一条是错的);
 *  3. 产物的精确命中率 ≥ 门槛(默认 85%),跌破即 exit 1。
 *
 * 另外打印**全部 Tier4/Tier5 清单** —— 这就是下一轮填 overrides 的待办列表。
 *
 * 用法:
 *   npm run check:model-labels                     # 音频侧(默认)
 *   npm run check:model-labels -- --task image     # 图像侧(SpeciesNet)
 *   npm run check:model-labels -- --min-exact 0.9
 *   npm run check:model-labels -- --quiet          # 只报问题,不打印清单
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const TASK = args.task || 'audio'
const MIN_EXACT = Number(args['min-exact'] ?? 0.85)
const QUIET = Boolean(args.quiet)
const OUT = path.join(ROOT, `public/data/model-labels-${TASK}.json`)
const OVERRIDES = path.join(ROOT, 'data/model-label-overrides.json')

const problems = []
const fail = (msg) => problems.push(msg)
const read = async (p, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    return fallback
  }
}

/** 本项目认识的 speciesId 全集:manifest-meta(上线产物) ∪ taxa(1299) ∪ 台账(可播放种)。 */
async function loadKnownIds() {
  const ids = new Map() // id -> 来源
  const add = (doc, source) => {
    const list = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc.species ?? doc) : doc
    for (const s of Array.isArray(list) ? list : Object.values(list || {})) {
      if (s && typeof s.id === 'string' && s.id && !ids.has(s.id)) ids.set(s.id, source)
    }
  }
  const meta = await read(path.join(ROOT, 'public/data/manifest-meta.json'))
  add(meta && (meta.species ?? meta), 'manifest-meta')
  add(await read(path.join(ROOT, 'data/taxa.json')), 'taxa')
  add(await read(path.join(ROOT, 'data-cache/manifest-global.json')), '台账')
  return ids
}

const knownIds = await loadKnownIds()
const overrides = (await read(OVERRIDES, {})) || {}

// ── 1. overrides 的 speciesId 有效性 + 重复占用 ────────────────────────────────
const owner = new Map() // speciesId -> 标签原文
for (const [label, id] of Object.entries(overrides)) {
  if (typeof id !== 'string' || !id) {
    fail(`overrides["${label}"] 的值必须是 speciesId 字符串,得到 ${JSON.stringify(id)}`)
    continue
  }
  if (!knownIds.has(id)) {
    fail(`overrides["${label}"] → "${id}":本项目没有这个 speciesId(拼错了?或该种还没进 manifest-meta/taxa)`)
  }
  if (owner.has(id)) {
    fail(`overrides 里 speciesId "${id}" 被重复占用:「${owner.get(id)}」与「${label}」`)
  } else {
    owner.set(id, label)
  }
}

// ── 2. 产物结构 + 命中率 ────────────────────────────────────────────────────────
const doc = await read(OUT)
if (!doc) {
  console.error(`✗ 找不到产物 ${path.relative(ROOT, OUT)};先跑 npm run build:model-labels -- --task ${TASK}`)
  process.exit(2)
}
if (doc.task !== TASK) fail(`产物 task="${doc.task}" 与校验任务 "${TASK}" 不一致`)
if (!doc.entries || typeof doc.entries !== 'object') fail('产物缺 entries')

const labels = Object.keys(doc.entries || {})
if (!labels.length) fail('产物 entries 为空')

// overrides 的键必须真的在产物里(打错键 = 静默失效)
for (const label of Object.keys(overrides)) {
  if (!Object.hasOwn(doc.entries, label)) fail(`overrides 的键「${label}」在产物里不存在(标签表换版?打错?)`)
}

const tiers = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
const needWork = []
for (const [label, e] of Object.entries(doc.entries || {})) {
  const t = Number(e && e.t)
  if (!(t >= 1 && t <= 5)) {
    fail(`条目「${label}」的 tier 非法:${JSON.stringify(e && e.t)}`)
    continue
  }
  tiers[t]++
  if (t >= 4) needWork.push({ label, tier: t, genus: e.g ?? null, zh: e.z ?? null })
  if (e.s && !knownIds.has(e.s)) fail(`条目「${label}」指向未知 speciesId "${e.s}"`)
  if (t <= 3 && !e.s) {
    // 对上了但还没采到素材是可接受的(053 采集完成后上升),不算问题
  }
}

const exact = tiers[1] + tiers[2] + tiers[3]
const rate = labels.length ? exact / labels.length : 0
if (rate < MIN_EXACT) {
  fail(`精确命中率 ${(rate * 100).toFixed(1)}% 跌破门槛 ${(MIN_EXACT * 100).toFixed(0)}%`)
}

// ── 3. 报告 ────────────────────────────────────────────────────────────────────
console.log(`\n模型标签对表门禁（${TASK}）`)
console.log(`  产物          ${path.relative(ROOT, OUT)}  (${labels.length} 条)`)
console.log(`  精确命中率    ${(rate * 100).toFixed(1)}%  (T1 ${tiers[1]} / T2 ${tiers[2]} / T3 ${tiers[3]})  门槛 ${(MIN_EXACT * 100).toFixed(0)}%`)
console.log(`  T4 仅属名     ${tiers[4]}`)
console.log(`  T5 未命中     ${tiers[5]}`)
console.log(`  overrides     ${Object.keys(overrides).length} 条（speciesId 全部校验）`)

if (!QUIET) {
  const t5 = needWork.filter((x) => x.tier === 5)
  const t4 = needWork.filter((x) => x.tier === 4)
  console.log(`\n  ── 待人工判定清单（T5 ${t5.length} 条：真漏配就填进 data/model-label-overrides.json）:`)
  for (const x of t5) console.log(`    ${x.label}`)
  console.log(`\n  ── T4 仅属名（${t4.length} 条：同种异名才需要 overrides）:`)
  for (const x of t4) console.log(`    ${x.label}${x.genus ? `  → ${x.genus}` : ''}`)
}

if (problems.length) {
  console.error(`\n⛔ ${problems.length} 项不通过:`)
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
console.log(`\n✅ 通过\n`)