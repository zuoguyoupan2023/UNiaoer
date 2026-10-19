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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

// 合并产物（构建期生成）：核心层注入表的覆盖率必须与各源产物一致，防止合并时悄悄丢数据
const coreFile = path.join(ROOT, 'data-cache/trait-core.json')
if (existsSync(coreFile)) {
  const core = JSON.parse(readFileSync(coreFile, 'utf8'))
  const hab = existsSync(habFile) ? JSON.parse(readFileSync(habFile, 'utf8')) : null
  const avo = existsSync(av) ? JSON.parse(readFileSync(av, 'utf8')) : null
  const eln = path.join(ROOT, 'data/elton-traits.json')
  const el = existsSync(eln) ? JSON.parse(readFileSync(eln, 'utf8')) : null
  const pln = path.join(ROOT, 'data/plumage-colours.json')
  const pl = existsSync(pln) ? JSON.parse(readFileSync(pln, 'utf8')) : null
  const pairs = [
    ['生境', hab?.counts?.matched, core.counts?.habitat],
    ['食性', el?.counts?.matched, core.counts?.diet],
    ['形态', avo?.counts?.matched, core.counts?.morph],
    ['羽色', pl?.counts?.matched, core.counts?.plumage],
  ]
  for (const [label, src, merged] of pairs) {
    if (src === undefined || merged === undefined) continue
    if (src !== merged) err(`${label}：源产物命中 ${src} 条，合并表只有 ${merged} 条 —— 合并丢了数据`)
  }
  if (core.counts?.droppedTagUnknownCode) {
    err(`有 ${core.counts.droppedTagUnknownCode} 个生境 code 查不到中文而跳过（码表缺条目）`)
  }
  if (!pairs.some(([, s]) => s === undefined)) console.log('✅ 合并表：各维度覆盖率与源产物一致')
  const tagOver = Object.values(core.byTaxonKey).filter((v) => (v.habitatCodes || []).length > (core.tagCap || 6)).length
  if (tagOver) err(`${tagOver} 条超过 tagCap=${core.tagCap}`)
  else console.log(`✅ 核心层：${Object.keys(core.byTaxonKey).length} 条 · 生境 code 上限 ${core.tagCap} 未被突破`)
}


// 062 C1/C3：核心层注入 + 前端码表 + 详情层分片的联动校验
// - public/data/iucn-habitat-codes.json 必须存在，且与 data/ 源表 code 数一致
// - manifest-meta 若已合并性状：每条的 habitatCodes 必须能在码表查到；覆盖数必须等于 trait-core.counts
// - traitsBuckets 必须等于 public/data/traits/*.json（index 除外）
{
  const pubCodesFile = path.join(ROOT, 'public/data/iucn-habitat-codes.json')
  const srcCodesFile = path.join(ROOT, 'data/iucn-habitat-codes.json')
  if (!existsSync(pubCodesFile)) {
    err('public/data/iucn-habitat-codes.json 不存在（先跑 npm run traits:layers）')
  } else if (existsSync(srcCodesFile)) {
    const pub = JSON.parse(readFileSync(pubCodesFile, 'utf8'))
    const src = JSON.parse(readFileSync(srcCodesFile, 'utf8'))
    const a = Object.keys(pub.codes || {}).length
    const b = Object.keys(src.codes || {}).length
    if (a !== b) err(`前端码表 ${a} 条 ≠ 源表 ${b} 条（重跑 npm run traits:layers）`)
    else console.log(`✅ 前端码表：${a} 条，与 data/ 源表一致`)
  }

  const metaFile = path.join(ROOT, 'public/data/manifest-meta.json')
  if (existsSync(metaFile) && existsSync(coreFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    const core = JSON.parse(readFileSync(coreFile, 'utf8'))
    const pub = existsSync(pubCodesFile)
      ? JSON.parse(readFileSync(pubCodesFile, 'utf8')).codes || {}
      : {}
    let withTags = 0
    let withHas = 0
    const badCode = new Set()
    for (const sp of meta.species || []) {
      const p = sp.profile || {}
      if (Array.isArray(p.habitatCodes) && p.habitatCodes.length) {
        withTags++
        for (const code of p.habitatCodes) if (!pub[code]) badCode.add(code)
      }
      if (p.hasTraits) withHas++
    }
    if (badCode.size) err(`核心层 ${badCode.size} 个 habitatCode 在码表查不到：${[...badCode].slice(0, 8).join(', ')}`)
    if (!withTags) {
      warn('manifest-meta 还没有 habitatCodes（C1 合并尚未在产物上生效；D1 重建后复核）')
    } else {
      // 正确口径：与 meta 的 taxonKey 求交集后再比，不能用全池 counts.habitat
      // （meta 排除了 112 个无素材种；trait-core 里还有些种不在 meta）。
      // 按 meta 物种逐条算期望（同一 taxonKey 可能对应多个别名种，不能只算唯一键）
      const wantTags = (meta.species || []).filter((s) => {
        const e = s.taxonKey ? core.byTaxonKey?.[s.taxonKey] : null
        return !!e?.habitatCodes?.length
      }).length
      const wantHas = (meta.species || []).filter((s) => {
        const e = s.taxonKey ? core.byTaxonKey?.[s.taxonKey] : null
        return !!e?.hasTraits
      }).length
      if (withTags !== wantTags) {
        err(`核心层 habitatCodes 覆盖 ${withTags} 种 ≠ 交集期望 ${wantTags} 种（合并丢数据）`)
      }
      if (withHas !== wantHas) {
        err(`核心层 hasTraits 覆盖 ${withHas} 种 ≠ 交集期望 ${wantHas} 种（合并丢数据）`)
      }
      console.log(`✅ 核心层：${withTags} 种带 habitatCodes · ${withHas} 种带 hasTraits`)
      const metaBuckets = [...(meta.traitsBuckets || [])].sort()
      const actual = existsSync(path.join(ROOT, 'public/data/traits'))
        ? (await import('node:fs')).readdirSync(path.join(ROOT, 'public/data/traits'))
            .filter((f) => f.endsWith('.json') && f !== 'index.json')
            .map((f) => f.slice(0, -5))
            .sort()
        : []
      if (JSON.stringify(metaBuckets) !== JSON.stringify(actual)) {
        err(`meta.traitsBuckets(${metaBuckets.length}) ≠ traits/*.json(${actual.length})——重跑 traits:layers/layers`)
      } else {
        console.log(`✅ traitsBuckets：${metaBuckets.length} 个分片，与 traits/*.json 一致`)
      }
    }
  }
}

// 064：叙述文本门禁 ——「数字必须与输入一致」+「非权威标注不可丢」
// 口径（`053-describe §11.5b` 硬规则 1）：叙述里出现的每个数字，都必须能在该种的结构化事实
// （食性百分比 / 体重）里找到；找不到就说明措辞改写了事实 → 阻断。
{
  const marksFile = path.join(ROOT, 'data/field-marks.json')
  const traitsDir = path.join(ROOT, 'public/data/traits')
  if (existsSync(marksFile)) {
    const marks = JSON.parse(readFileSync(marksFile, 'utf8'))
    const byKey = marks.byTaxonKey || {}
    const shards = existsSync(traitsDir)
      ? readdirSync(traitsDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
      : []
    const allowed = new Map()
    for (const f of shards) {
      const d = JSON.parse(readFileSync(path.join(traitsDir, f), 'utf8'))
      for (const [k, e] of Object.entries(d.byTaxonKey || {})) {
        const nums = new Set()
        for (const v of Object.values(e.diet || {})) if (typeof v === 'number') nums.add(v)
        const m = e.morph?.massG
        if (typeof m === 'number') nums.add(m)
        allowed.set(k, nums)
      }
    }
    let bad = 0
    let checked = 0
    for (const [k, v] of Object.entries(byKey)) {
      const nums = allowed.get(k) || new Set()
      // 中英双语同规则校验（英文叙述同样不许改写数字）
      for (const field of ['zh', 'en']) {
        const text = v?.[field]
        if (!text) continue
        if (!Array.isArray(v.textSources) || !v.textSources.some((s) => s?.field === field)) {
          if (bad < 8) err(`叙述缺 textSources.${field}：${k}`)
          bad++
        }
        for (const s of String(text).match(/\d+(?:\.\d+)?(?=\s*%|\s*g\b)/g) || []) {
          const n = Number(s)
          const ok = [...nums].some((x) => Math.abs(x - n) < 0.06)
          if (!ok) {
            if (bad < 8) err(`叙述数字 ${s} 在结构化事实里找不到：${k}[${field}]「${text}」`)
            bad++
          }
          checked++
        }
      }
    }
    if (bad) err(`叙述文本：${bad} 处不一致`)
    else console.log(`✅ 叙述文本：${Object.keys(byKey).length} 条 · ${checked} 个数字全部可追溯到结构化事实`)
  }
}

// ⚠️ 失败判定必须放在**文件最末**：此前它写在中部，导致其后新增的检查（064 叙述文本）
//    即使报错也不影响退出码 —— 门禁形同虚设（2026-10-19 修）。
if (failed) {
  console.error(`\n❌ check:traits 失败（${failed} 项）`)
  process.exit(1)
}
console.log('\n✅ check:traits 通过')
