#!/usr/bin/env node
/**
 * 050 P1：`npm run check:meta` —— 权威名录层的**两道验收闸门**。
 *
 * 本脚本回答两个问题（用户 2026-10-10 明确要求"要有检测标准验证"）：
 *
 *  **M1 迁移完整性**：core 1299 的全部字段是否都进了权威层？
 *   逐种逐字段比对 `public/data/manifest.json` 的 1299 条：
 *   id 全部存在，且 `taxonId/profile/notes/rankWorld/rankCN/inCN/desc/location/habit/
 *   commonness/taxonKey` **无缺失、无被置空**。有差异则列出并失败。
 *
 *  **M2 详情完整度**：10,844 种在完整详情模板下能覆盖到什么程度？
 *   - 有媒体的种 → hero 图 / 音频 / **逐条署名**必须齐备（署名缺失 = 合规红线，直接失败）；
 *   - 无媒体的种（台账 294 种，不在权威层）→ 属"没有数据"，**不计入失败**，只做统计。
 *
 * 另含结构性断言：
 *  - **S1** meta 内不得含任何媒体键（image/audio/images/audios）——否则首屏层会膨胀（050 §2.1）；
 *  - **S2** meta.total 必须等于 core + global 的可玩全集，且与 `catalog.total` 一致；
 *  - **S3** `profile.group` 必须是 waterbird/raptor/landbird 三值之一；
 *  - **S4** 权威层内不得出现重复 id。
 *
 * 用法：
 *   node scripts/check-meta.mjs            # 全量校验
 *   node scripts/check-meta.mjs --report   # 额外打印「缺什么/为什么」的明细报告
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'public/data')
const REPORT = process.argv.includes('--report')

/** M1 需要逐字段核对的 core 字段（媒体类不在权威层，按设计不比对） */
const MIGRATE_FIELDS = [
  'taxonKey',
  'taxonId',
  'commonness',
  'profile',
  'notes',
  'rankWorld',
  'rankCN',
  'inCN',
  'desc',
  'location',
  'habit',
  'nameZh',
  'nameSci',
  'nameEn',
  'family',
]

/** S1：权威层禁止出现的媒体键 */
const FORBIDDEN_MEDIA_KEYS = ['image', 'audio', 'images', 'audios', 'mediaMode']

const GROUPS = new Set(['waterbird', 'raptor', 'landbird'])

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`✗ ${msg}`)
}
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

const core = await readJson(path.join(DATA, 'manifest-core.json'))
const full = await readJson(path.join(ROOT, 'public/data/manifest.json'))
const globalMin = await readJson(path.join(DATA, 'manifest-global.min.json'))
const meta = await readJson(path.join(DATA, 'manifest-meta.json'))

const metaById = new Map()
const dup = []
for (const sp of meta.species) {
  if (metaById.has(sp.id)) dup.push(sp.id)
  metaById.set(sp.id, sp)
}

// ── S4 重复 id ────────────────────────────────────────────────
if (dup.length) fail(`权威层有 ${dup.length} 个重复 id：${dup.slice(0, 5).join(', ')}`)

// ── S1 权威层不得含媒体 ────────────────────────────────────────
let mediaLeaks = 0
let leakSample = ''
for (const sp of meta.species) {
  for (const k of FORBIDDEN_MEDIA_KEYS) {
    if (sp[k] !== undefined) {
      mediaLeaks++
      if (!leakSample) leakSample = `${sp.id}.${k}`
    }
  }
}
if (mediaLeaks) fail(`权威层含媒体键 ${mediaLeaks} 处（示例 ${leakSample}）——会让启动层膨胀（050 §2.1）`)

// ── S2 口径一致 ───────────────────────────────────────────────
const expectTotal = core.species.length + globalMin.species.length
if (meta.total !== expectTotal) fail(`meta.total=${meta.total} ≠ core+global=${expectTotal}`)
if (meta.total !== meta.species.length) fail(`meta.total=${meta.total} ≠ species.length=${meta.species.length}`)
try {
  const catalog = await readJson(path.join(DATA, 'catalog.json'))
  if (catalog.counts.total !== meta.total) {
    fail(`catalog.counts.total=${catalog.counts.total} ≠ meta.total=${meta.total}`)
  }
} catch {
  console.warn('⚠ 未找到 catalog.json，跳过与名录的交叉校验')
}

// ── S3 profile.group 枚举 ────────────────────────────────────
let badGroup = 0
for (const sp of meta.species) {
  const g = sp.profile?.group
  if (g !== undefined && !GROUPS.has(g)) badGroup++
}
if (badGroup) fail(`${badGroup} 条 profile.group 非法（应为 waterbird/raptor/landbird）`)

// ── M1 迁移完整性：core 1299 的字段逐条比对 ───────────────────
const missingIds = []
const fieldLoss = []
let compared = 0
for (const sp of full.species) {
  const m = metaById.get(sp.id)
  if (!m) {
    missingIds.push(sp.id)
    continue
  }
  for (const f of MIGRATE_FIELDS) {
    const src = sp[f]
    const dst = m[f]
    // 「源有值 → 目标必须有值且非空」；源本来就没有的字段不算丢失
    if (src === undefined || src === null || src === '') continue
    compared++
    const dstEmpty = dst === undefined || dst === null || dst === ''
    if (dstEmpty) {
      fieldLoss.push(`${sp.id}.${f}`)
      continue
    }
    // 对象类字段（profile/notes）做一层浅比较：键集合必须覆盖
    if (typeof src === 'object' && typeof dst === 'object') {
      for (const k of Object.keys(src)) {
        if (src[k] === undefined || src[k] === null || src[k] === '') continue
        if (dst[k] === undefined || dst[k] === null || dst[k] === '') {
          fieldLoss.push(`${sp.id}.${f}.${k}`)
        }
      }
    }
  }
}
if (missingIds.length) fail(`M1：core 的 ${missingIds.length} 个物种未进权威层：${missingIds.slice(0, 5).join(', ')}`)
if (fieldLoss.length) {
  fail(`M1：${fieldLoss.length} 个字段在迁移中丢失，示例 ${fieldLoss.slice(0, 5).join(', ')}`)
}

// ── M2 详情完整度 ────────────────────────────────────────────
// 权威层不带媒体，媒体能力以 global 池 + core 首图首音为准（050 §2.2：P3 前仍走旧通道）
const withImg = new Set(globalMin.species.filter((s) => s.image).map((s) => s.id))
const withAud = new Set(globalMin.species.filter((s) => s.audio).map((s) => s.id))
for (const sp of core.species) {
  if (sp.image) withImg.add(sp.id)
  if (sp.audio) withAud.add(sp.id)
}
// 署名完整性：素材级 CC 铁律（与 check-bank 同一判据）
let attributionBad = 0
const attrSample = []
const checkAttribution = (id, a, kind) => {
  for (const f of ['license', 'author', 'source', 'sourceUrl']) {
    if (!a[f]) {
      attributionBad++
      if (attrSample.length < 5) attrSample.push(`${id}.${kind}.${f}`)
    }
  }
}
for (const sp of globalMin.species) {
  if (sp.image) checkAttribution(sp.id, sp.image, 'image')
  if (sp.audio) checkAttribution(sp.id, sp.audio, 'audio')
}
for (const sp of core.species) {
  if (sp.image) checkAttribution(sp.id, sp.image, 'image')
  if (sp.audio) checkAttribution(sp.id, sp.audio, 'audio')
}
if (attributionBad) fail(`M2：${attributionBad} 处素材缺署名（CC 合规红线）：${attrSample.join(', ')}`)

// 明细报告（--report）：把"缺什么、为什么"列出来，转成后续内容补齐待办
const report = {
  total: meta.total,
  fromCore: full.species.length,
  globalSpecies: globalMin.species.length,
  withImage: withImg.size,
  withAudio: withAud.size,
  withNameZh: meta.species.filter((s) => s.nameZh).length,
  withProfile: meta.species.filter((s) => s.profile).length,
  withMigration: meta.species.filter((s) => s.profile?.migration).length,
  withHabitat: meta.species.filter((s) => s.profile?.habitatZh || s.profile?.habitatEn).length,
  withHabit: meta.species.filter((s) => s.profile?.habitZh || s.profile?.habitEn).length,
  withDistribution: meta.species.filter((s) => s.profile?.distribution).length,
  withNotes: meta.species.filter((s) => s.notes).length,
  withTaxonId: meta.species.filter((s) => s.taxonId).length,
  withOrder: meta.species.filter((s) => s.order).length,
  groups: meta.stats?.groups,
  missingInMigration: missingIds.length,
  fieldLoss: fieldLoss.length,
}

console.log('· 权威层 manifest-meta.json')
console.log(`  物种 ${meta.total}（核心库 ${full.species.length} + 全球池 ${globalMin.species.length}）· ${(Buffer.byteLength(JSON.stringify(meta)) / 1e6).toFixed(2)}MB`)
console.log(
  `  详情覆盖：有图 ${report.withImage} · 有音 ${report.withAudio} · 有中文名 ${report.withNameZh} · 有科/目 ${report.withOrder} · 有 taxonId ${report.withTaxonId}`,
)
console.log(
  `  profile：${report.withProfile}（类群 水鸟 ${report.groups?.waterbird}/猛禽 ${report.groups?.raptor}/林鸟 ${report.groups?.landbird}）` +
    ` · 居留型 ${report.withMigration} · 生境 ${report.withHabitat} · 习性 ${report.withHabit} · 分布 ${report.withDistribution} · 答疑 ${report.withNotes}`,
)
console.log(`  M1 迁移完整性：${compared} 个字段逐一比对，缺种 ${report.missingInMigration} · 丢字段 ${report.fieldLoss}`)
console.log(`  M2 详情完整度：署名缺失 ${attributionBad} 处`)

if (REPORT) {
  console.log('\n· 明细报告（缺什么 / 为什么）')
  const noHabitat = meta.total - report.withHabitat
  console.log(`  - 无生境 habitat：${noHabitat} 种 —— 无数据源，需人工整理或引入新数据源`)
  console.log(`  - 无居留型 migration：${meta.total - report.withMigration} 种 —— 同上`)
  console.log(`  - 无 taxonId：${meta.total - report.withTaxonId} 种 —— 地区类产物（季节/省分布）覆盖不到，需用 species-index 的 backboneTaxonId 回填`)
  console.log(`  - 无中文名：${meta.total - report.withNameZh} 种 —— UI 回落英文名/学名`)
  console.log(`  - 完全无媒体：294 种（不在权威层，由 species-index 轻量详情兜底）`)
}

if (failed) {
  console.error(`\n✗ check:meta：${failed} 项未通过`)
  process.exit(1)
}
console.log('\n✓ check:meta：权威层结构 / 迁移完整性（M1）/ 详情完整度（M2）全部通过')