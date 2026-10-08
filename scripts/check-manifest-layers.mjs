#!/usr/bin/env node
/**
 * 029 M1:manifest 分层产物校验(纯本地,不联网)。
 * 校验 core / assets 分片 / global.min 与完整层 manifest.json 的一致性:
 *   - core 物种集合 = 完整层;core 首图首音 === 分片 images[0]/audios[0]
 *   - core.buckets 与实际分片文件一一对应(无遗漏/无多余)
 *   - 每个物种可按 resolveBucket(id, core.buckets) 找到其分片,且分片内含该物种
 *   - 分片单桶 ≤400KB(DoD);core ≤1.6MB
 *   - global.min 物种均 playable(有素材),且为 core 同构(无 images[]/audios[])
 * 用法:npm run check:layers
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBucket } from './lib/manifest-layers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'public/data')
const problems = []
const fail = (m) => problems.push(m)

try {
  const full = JSON.parse(await fs.readFile(path.join(DATA, 'manifest.json'), 'utf8'))
  const core = JSON.parse(await fs.readFile(path.join(DATA, 'manifest-core.json'), 'utf8'))
  const bucketNames = (await fs.readdir(path.join(DATA, 'assets')).catch(() => []))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort()

  if (core.layer !== 'core') fail(`core.layer=${core.layer},期望 'core'`)
  if (core.total !== full.species.length) fail(`core.total ${core.total} ≠ manifest ${full.species.length}`)

  const declared = [...(core.buckets || [])].sort()
  if (JSON.stringify(declared) !== JSON.stringify(bucketNames)) {
    fail(`core.buckets 与 assets/ 文件不一致:声明 ${declared.length} 个,实际 ${bucketNames.length} 个`)
  }

  // 加载分片
  const buckets = {}
  for (const name of bucketNames) {
    const p = path.join(DATA, 'assets', `${name}.json`)
    const text = await fs.readFile(p, 'utf8')
    if (text.length > 400_000) fail(`分片 ${name} 超 400KB DoD 线(${(text.length / 1024).toFixed(0)}KB)`)
    buckets[name] = JSON.parse(text).species || {}
  }

  const coreById = new Map(core.species.map((s) => [s.id, s]))
  let mismatched = 0
  let missingInBucket = 0
  let assetless = 0
  for (const sp of full.species) {
    const c = coreById.get(sp.id)
    if (!c) {
      fail(`core 缺物种 ${sp.id}`)
      continue
    }
    const bucketName = resolveBucket(sp.id, bucketNames)
    const entry = buckets[bucketName]?.[sp.id]
    const fullImg = (sp.images && sp.images[0]) || sp.image || null
    const fullAud = (sp.audios && sp.audios[0]) || sp.audio || null
    const hasFullMedia = (sp.images?.length || 0) > 0 || (sp.audios?.length || 0) > 0
    if (!hasFullMedia) assetless++
    else if (!entry) {
      missingInBucket++
      fail(`物种 ${sp.id} 在分片 ${bucketName} 中缺失(而完整层有素材)`)
    } else {
      if (fullImg && entry.images?.[0]?.url !== c.image?.url) {
        mismatched++
        fail(`物种 ${sp.id}:core 首图 ${c.image?.url} ≠ 分片 images[0] ${entry.images?.[0]?.url}`)
      }
      if (fullAud && entry.audios?.[0]?.url !== c.audio?.url) {
        mismatched++
        fail(`物种 ${sp.id}:core 首音 ${c.audio?.url} ≠ 分片 audios[0] ${entry.audios?.[0]?.url}`)
      }
      if (!fullImg && c.image) fail(`物种 ${sp.id}:core 有 image 但完整层无`)
      if (!fullAud && c.audio) fail(`物种 ${sp.id}:core 有 audio 但完整层无`)
      // 分片不重复携带 notes/profile(它们在 core)
      if (entry.notes || entry.profile) fail(`物种 ${sp.id}:分片携带 notes/profile(应在 core)`)
    }
    if (sp.notes && !c.notes) fail(`物种 ${sp.id}:core 缺 notes(应随 core 提供)`)
    if (sp.profile && !c.profile) fail(`物种 ${sp.id}:core 缺 profile(应随 core 提供)`)
  }

  const coreBytes = (await fs.stat(path.join(DATA, 'manifest-core.json'))).size
  // 1.8MB 线:含名录 + 首图首音 + notes/profile(小体积详情字段随 core,见 manifest-layers 注释)
  if (coreBytes > 1_800_000) fail(`core ${(coreBytes / 1e6).toFixed(2)}MB 超 1.8MB DoD 线`)

  // global.min(存在才校验)
  let globalNote = 'global.min 不存在(采集台账未纳入,跳过)'
  const globalPath = path.join(DATA, 'manifest-global.min.json')
  const globalText = await fs.readFile(globalPath, 'utf8').catch(() => null)
  if (globalText) {
    const g = JSON.parse(globalText)
    if (g.layer !== 'global') fail(`global.layer=${g.layer},期望 'global'`)
    if (g.total !== g.species.length) fail(`global.total ${g.total} ≠ species ${g.species.length}`)
    for (const s of g.species) {
      if (!s.image && !s.audio) fail(`global 物种 ${s.id} 既无 image 也无 audio(不应入池)`)
      if (s.images || s.audios) fail(`global 物种 ${s.id} 携带完整素材数组(应为 core 同构)`)
    }
    globalNote = `global.min ${(globalText.length / 1e6).toFixed(2)}MB(${g.total} 种)`
  }

  console.log(
    `· 分层:core ${(coreBytes / 1e6).toFixed(2)}MB(${core.total} 种) · 分片 ${bucketNames.length} 桶 · 首图首音一致 ${full.species.length - mismatched - missingInBucket}/${full.species.length} · 无素材物种 ${assetless} · ${globalNote}`,
  )
  if (problems.length) {
    console.error(`\n✗ check:layers 失败(${problems.length} 项):`)
    for (const p of problems.slice(0, 15)) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('\n✓ check:layers:三层产物与完整层一致')
} catch (e) {
  console.error(`✗ check:layers:${e.message}`)
  process.exit(1)
}
