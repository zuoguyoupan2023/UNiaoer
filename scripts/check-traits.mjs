/**
 * 053-describe 门禁：结构化性状产物（iucn-habitats / avonet-traits / elton-traits）。
 *
 * 只做**硬约束**，覆盖率只报告不设阈值（内容工作不该阻断构建，见 docs/053-describe §5）：
 *   1. 三个产物若存在，`source.license` + `source.citation` 必须齐备（许可留痕，docs/024 §2 的兑现）
 *   2. byTaxonKey 的键必须是合法的 `avibase-XXXXXXXX`（避免与骨架脱钩）
 *   3. EltonTraits：食性之和 |sum-100| <= 1（有 diet 的条目）
 *   4. AVONET：`flags.inferred=true` 的条目必须带 `flags.totalIndividuals`（插值来源可追溯）
 *   5. 不允许空对象噪声（`habitats: []` / `morph: {}` / `diet: {}` 这类整条皆空的记录）
 *   6. counts 字段自洽（matched + unmatched <= pool）
 *
 * CLI：npm run check:traits
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILES = [
  { key: 'iucn', file: 'data/iucn-habitats.json', label: 'IUCN 结构化生境' },
  { key: 'avonet', file: 'data/avonet-traits.json', label: 'AVONET 形态/生态' },
  { key: 'elton', file: 'data/elton-traits.json', label: 'EltonTraits 习性' },
]
const KEY_RE = /^avibase-[0-9A-F]{8}$/

let failed = 0
const err = (m) => {
  console.error(`❌ ${m}`)
  failed++
}
const warn = (m) => console.warn(`⚠️  ${m}`)

for (const { key, file, label } of FILES) {
  const p = path.join(ROOT, file)
  if (!existsSync(p)) {
    console.log(`· ${label}：产物不存在（${file}），跳过`)
    continue
  }
  const d = JSON.parse(readFileSync(p, 'utf8'))
  const problems = []

  // 1. 许可与引用留痕
  if (!d.source?.license) problems.push('source.license 缺失')
  if (!d.source?.citation) problems.push('source.citation 缺失')
  if (!d.source?.url) problems.push('source.url 缺失')

  const entries = Object.entries(d.byTaxonKey || {})
  if (!entries.length) problems.push('byTaxonKey 为空（先跑对应的 npm run taxonomy:* ）')
  if (!Array.isArray(d.unmatched)) problems.push('unmatched 必须是数组（未匹配清单必须落盘，不猜不补）')

  // 2/5. 键合法性 + 空对象噪声
  let badKey = 0
  let emptyRow = 0
  for (const [k, v] of entries) {
    if (!KEY_RE.test(k)) badKey++
    if (key === 'iucn' && !(v.habitats?.length || v.systems?.length)) emptyRow++
    if (key === 'avonet' && !Object.keys(v.morph || {}).length) emptyRow++
    if (key === 'elton' && !(v.diet || v.foraging)) emptyRow++
  }
  if (badKey) problems.push(`${badKey} 个键不是 avibase-XXXXXXXX`)
  if (emptyRow) problems.push(`${emptyRow} 条是空记录（噪声）`)

  // 3. EltonTraits 食性和
  if (key === 'elton') {
    let bad = 0
    for (const [, v] of entries) {
      if (v.diet && v.dietSum !== null && Math.abs(v.dietSum - 100) > 1) bad++
    }
    if (bad) problems.push(`${bad} 条食性之和偏离 100 超过 1`)
  }

  // 4. AVONET 插值条目须可追溯
  if (key === 'avonet') {
    let bad = 0
    for (const [, v] of entries) if (v.flags?.inferred && v.flags.totalIndividuals === null) bad++
    if (bad) problems.push(`${bad} 条 inferred=true 但缺 totalIndividuals（插值来源不可追溯）`)
  }

  // 6. counts 自洽
  const c = d.counts || {}
  if (c.matched !== undefined && c.matched !== entries.length) problems.push('counts.matched 与实际条目数不符')
  if (c.pool !== undefined && c.matched + c.unmatched > c.pool) problems.push('counts: matched+unmatched > pool')
  if (c.matched !== undefined && c.pool) {
    const pct = ((c.matched / c.pool) * 100).toFixed(1)
    console.log(`· ${label}：命中 ${c.matched}/${c.pool}（${pct}%）`)
  }

  if (problems.length) problems.forEach(err)
  else console.log(`✅ ${label}：${label} 校验通过（${entries.length} 条）`)
}

// 覆盖率只报告，不阻断
const av = path.join(ROOT, 'data/avonet-traits.json')
if (existsSync(av)) {
  const d = JSON.parse(readFileSync(av, 'utf8'))
  const pct = ((d.counts.matched / d.counts.pool) * 100).toFixed(1)
  warn(`AVONET 覆盖 ${pct}%（未匹配 ${d.counts.unmatched} 条已落 unmatched，留人工，不自动猜异名）`)
}

// IUCN 码表：产物里出现的每个 habitat code 都必须有中文对照（前端按 code 查表，产物不放译名）
const codeFile = path.join(ROOT, 'data/iucn-habitat-codes.json')
const habFile = path.join(ROOT, 'data/iucn-habitats.json')
if (existsSync(codeFile) && existsSync(habFile)) {
  const t = JSON.parse(readFileSync(codeFile, 'utf8'))
  const h = JSON.parse(readFileSync(habFile, 'utf8'))
  const used = new Set((h.habitatCodes || []).map((c) => c.code))
  const missing = [...used].filter((c) => !t.codes?.[c])
  if (missing.length) {
    err(`habitat code 缺中文对照 ${missing.length} 条：${missing.slice(0, 8).join(', ')}`)
  } else {
    const total = Object.keys(t.codes || {}).length
    const unreviewed = Object.values(t.codes).filter((v) => v.review === false).length
    console.log(`✅ IUCN 码表：${used.size} 个 code 全部有中文对照`)
    if (unreviewed) warn(`码表 ${unreviewed}/${total} 条仍是初稿（review:false），建议人工过一遍再改 true`)
  }
}

if (failed) {
  console.error(`\n❌ check:traits 失败（${failed} 项）`)
  process.exit(1)
}
console.log('\n✅ check:traits 通过')
