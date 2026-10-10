#!/usr/bin/env node
/**
 * S6/P5：`npm run check:meta` —— 权威名录层（meta）+ 全量素材（assets）的验收闸门。
 *
 *  **M2 详情完整度**：全量可玩种在完整详情模板下的覆盖，并校验**逐条署名**（合规红线）。
 *    署名读自 `assets/<bucket>.json`（P5 起媒体只有这一处）。
 *
 * 另含结构性断言：
 *  - **S1** meta 内不得含任何媒体键（image/audio/images/audios）——否则启动层膨胀（050 §2.1）；
 *  - **S2** meta.total = meta.species.length = catalog.counts.total；
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

/** S1：权威层禁止出现的媒体键 */
const FORBIDDEN_MEDIA_KEYS = ['image', 'audio', 'images', 'audios', 'mediaMode']
const GROUPS = new Set(['waterbird', 'raptor', 'landbird'])

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`✗ ${msg}`)
}
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

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

// ── M2 详情完整度（媒体读 assets 分片） ───────────────────────
const assetsDir = path.join(DATA, 'assets')
const assetFiles = (await fs.readdir(assetsDir).catch(() => [])).filter((f) => f.endsWith('.json'))
const withImg = new Set()
const withAud = new Set()
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
for (const f of assetFiles) {
  const doc = JSON.parse(await fs.readFile(path.join(assetsDir, f), 'utf8'))
  for (const [id, e] of Object.entries(doc.species || {})) {
    for (const a of e.images || []) {
      withImg.add(id)
      checkAttribution(id, a, 'image')
    }
    for (const a of e.audios || []) {
      withAud.add(id)
      checkAttribution(id, a, 'audio')
    }
  }
}
if (attributionBad) fail(`M2：${attributionBad} 处素材缺署名（CC 合规红线）：${attrSample.join(', ')}`)

// 明细报告
const report = {
  total: meta.total,
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
}

console.log('· 权威层 manifest-meta.json（唯一名单源）')
console.log(
  `  物种 ${meta.total} · ${(Buffer.byteLength(JSON.stringify(meta)) / 1e6).toFixed(2)}MB · assets ${assetFiles.length} 分片`,
)
console.log(
  `  详情覆盖：有图 ${report.withImage} · 有音 ${report.withAudio} · 有中文名 ${report.withNameZh} · 有科/目 ${report.withOrder} · 有 taxonId ${report.withTaxonId}`,
)
console.log(
  `  profile：${report.withProfile}（类群 水鸟 ${report.groups?.waterbird}/猛禽 ${report.groups?.raptor}/林鸟 ${report.groups?.landbird}）` +
    ` · 居留型 ${report.withMigration} · 生境 ${report.withHabitat} · 习性 ${report.withHabit} · 分布 ${report.withDistribution} · 答疑 ${report.withNotes}`,
)
console.log(`  M2 详情完整度：署名缺失 ${attributionBad} 处（assets 分片逐条校验）`)
console.log(
  `  类群分布：水鸟 ${meta.stats?.groups?.waterbird} · 猛禽 ${meta.stats?.groups?.raptor} · 林鸟 ${meta.stats?.groups?.landbird}（水/涉/林/猛/攀/游六分法见 data/class-records.json）`,
)

if (REPORT) {
  console.log('\n· 明细报告（缺什么 / 为什么）')
  console.log(`  - 无生境 habitat：${meta.total - report.withHabitat} 种 —— 无数据源，需人工整理或引入新数据源`)
  console.log(`  - 无居留型 migration：${meta.total - report.withMigration} 种 —— 同上`)
  console.log(`  - 无 taxonId：${meta.total - report.withTaxonId} 种 —— gbif-match 缓存里也没有，需联网补（npm run taxonomy:gbif-match -- --limit N）`)
  console.log(`  - 无中文名：${meta.total - report.withNameZh} 种 —— UI 回落英文名/学名；出题池需按 nameMode 过滤（docs/051 §1）`)
  console.log(`  - 类群留空：${meta.stats?.groupBlank ?? '-'} 种 —— 无依据不填（050 P0 修订）`)
  const noMedia = meta.species.filter((s) => !withImg.has(s.id) && !withAud.has(s.id)).length
  console.log(`  - 完全无媒体：${noMedia} 种（不在权威层，由 species-index 轻量详情兜底）`)
}

if (failed) {
  console.error(`\n✗ check:meta：${failed} 项未通过`)
  process.exit(1)
}
console.log('\n✓ check:meta：权威层结构 / 全量素材署名（M2）通过')
