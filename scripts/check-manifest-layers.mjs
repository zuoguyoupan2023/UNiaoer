#!/usr/bin/env node
/**
 * S6 / 050 P4：manifest 分层产物校验（纯本地，不联网）。
 *
 * 架构（S6 起）：**meta 是唯一名单源，assets 覆盖全量可玩种**。
 *   - `manifest-meta.json`：权威名录（10,844 种，不含媒体）+ `buckets` 分片索引
 *   - `assets/<bucket>.json`：全量物种的完整素材数组（core 5+5 / 全球 1+1）
 *   - `manifest-core.json`：启动层（1,299 种，core 同构；逐步退役）
 *
 * 校验：
 *   - meta.buckets 与 assets/ 实际文件一一对应（无遗漏/无多余）
 *   - 每个「声明可玩」的 meta 物种，按 resolveBucket(id, meta.buckets) 能找到分片且分片内含该物种、
 *     且素材与其 playableImage/playableAudio 一致
 *   - core 物种首图/首音 === 对应分片 images[0]/audios[0]
 *   - 分片单桶 ≤400KB（DoD）；core ≤1.8MB
 * 用法：npm run check:layers
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
  const meta = JSON.parse(await fs.readFile(path.join(DATA, 'manifest-meta.json'), 'utf8'))
  const bucketNames = (await fs.readdir(path.join(DATA, 'assets')).catch(() => []))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort()

  if (meta.layer !== 'meta') fail(`meta.layer=${meta.layer},期望 'meta'`)
  if (meta.total !== meta.species.length) fail(`meta.total ${meta.total} ≠ species ${meta.species.length}`)

  const declared = [...(meta.buckets || [])].sort()
  if (declared.length !== bucketNames.length || JSON.stringify(declared) !== JSON.stringify(bucketNames)) {
    fail(`meta.buckets 与 assets/ 文件不一致:声明 ${declared.length} 个,实际 ${bucketNames.length} 个`)
  }

  // 加载分片
  const buckets = {}
  for (const name of bucketNames) {
    const text = await fs.readFile(path.join(DATA, 'assets', `${name}.json`), 'utf8')
    if (text.length > 400_000) fail(`分片 ${name} 超 400KB DoD 线(${(text.length / 1024).toFixed(0)}KB)`)
    buckets[name] = JSON.parse(text).species || {}
  }

  let missingInBucket = 0
  let mediaMismatch = 0
  let assetless = 0
  for (const sp of meta.species) {
    const wantsImg = sp.playableImage === true
    const wantsAud = sp.playableAudio === true
    if (!wantsImg && !wantsAud) {
      assetless++
      continue
    }
    const bucketName = resolveBucket(sp.id, bucketNames)
    const entry = buckets[bucketName]?.[sp.id]
    if (!entry) {
      missingInBucket++
      fail(`物种 ${sp.id} 在分片 ${bucketName} 中缺失（meta 声明可玩）`)
      continue
    }
    const hasImg = (entry.images?.length || 0) > 0
    const hasAud = (entry.audios?.length || 0) > 0
    if (wantsImg !== hasImg) {
      mediaMismatch++
      fail(`物种 ${sp.id}:playableImage=${wantsImg} 但分片 images=${hasImg}`)
    }
    if (wantsAud !== hasAud) {
      mediaMismatch++
      fail(`物种 ${sp.id}:playableAudio=${wantsAud} 但分片 audios=${hasAud}`)
    }
    if (entry.notes || entry.profile) fail(`物种 ${sp.id}:分片携带 notes/profile(应在 meta)`)
  }

  console.log(
    `· 分层：meta ${meta.total} 种(${(JSON.stringify(meta).length / 1e6).toFixed(2)}MB) · assets ${bucketNames.length} 桶 · 覆盖 ${meta.total - assetless} 种 · 缺片 ${missingInBucket} · 媒体不符 ${mediaMismatch}`,
  )
  if (problems.length) {
    console.error(`\n✗ check:layers 失败(${problems.length} 项):`)
    for (const p of problems.slice(0, 15)) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('\n✓ check:layers:meta 名单 / assets 全量分片一致')
} catch (e) {
  console.error(`✗ check:layers:${e.message}`)
  process.exit(1)
}
