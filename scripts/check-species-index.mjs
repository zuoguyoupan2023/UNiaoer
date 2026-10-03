/**
 * 023 P0:全球物种骨架 + manifest 映射校验(纯本地,不联网;对齐 check-region 惯例)。
 * 校验对象:public/data/species-index.json(骨架)+ public/data/manifest.json(taxonKey/playable 只增字段)。
 * 敏感项:产物中不得出现坐标/几何类字段(骨架是纯分类名录,与铁律 6 一致)。
 * 用法:npm run check:index [-- --index <path>] [--no-net]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'
import { normalizeSciName } from './taxonomy/avilist-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const INDEX_PATH = path.resolve(ROOT, args.index || 'public/data/species-index.json')
const MANIFEST_PATH = path.join(ROOT, 'public/data/manifest.json')

const problems = []
const fail = (msg) => problems.push(msg)

/** 坐标/几何类字段黑名单(精确键名,大小写不敏感)。 */
const GEO_KEYS = new Set(['lat', 'lng', 'lon', 'latitude', 'longitude', 'coordinates', 'coordinate', 'geometry', 'geojson', 'bbox', 'bounds'])

function checkGeoKeys(obj, where) {
  for (const k of Object.keys(obj)) {
    if (GEO_KEYS.has(k.toLowerCase())) fail(`${where}:出现几何类字段「${k}」(骨架只做分类名录,禁止坐标/边界数据)`)
  }
}

try {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'))
  const rel = path.relative(ROOT, INDEX_PATH)

  if (index.schemaVersion !== 1) fail(`schemaVersion=${index.schemaVersion},期望 1`)
  if (!index.checklistVersion) fail('缺 checklistVersion(如 v2025b)')
  if (!index.generatedAt) fail('缺 generatedAt')
  if (!Array.isArray(index.sources) || !index.sources.length) {
    fail('缺 sources[](署名铁律:必须带 AviList 数据集声明)')
  } else {
    const avi = index.sources.find((s) => s.key === 'avilist')
    if (!avi) fail('sources[] 缺 avilist 条目')
    else {
      if (!/CC BY 4\.0/.test(avi.license || '')) fail(`avilist.license=${avi.license},期望 CC BY 4.0`)
      if (!avi.citation || !/AviList Core Team/.test(avi.citation)) fail('avilist.citation 缺失或不含官方引用(AviList Core Team + DOI)')
      if (!avi.url) fail('avilist.url 缺失')
    }
  }

  if (!Array.isArray(index.species) || !index.species.length) {
    fail('species 为空,骨架未产出')
  } else {
    if (index.species.length < 10_000) fail(`species=${index.species.length}(<10,000),疑似残缺骨架`)
    if (index.counts?.species !== index.species.length) {
      fail(`counts.species(${index.counts?.species})与 species.length(${index.species.length})不一致`)
    }

    const seenKey = new Map()
    const seenName = new Map()
    let noOrder = 0
    let extinct = 0
    let withEbird = 0
    let withBackbone = 0
    for (const [i, e] of index.species.entries()) {
      const where = `species[${i}]`
      if (typeof e.taxonKey !== 'string' || !e.taxonKey) fail(`${where}:缺 taxonKey(AvibaseID)`)
      else if (seenKey.has(e.taxonKey)) fail(`${where}:taxonKey 重复 ${e.taxonKey}(与 species[${seenKey.get(e.taxonKey)}])`)
      else seenKey.set(e.taxonKey, i)
      if (typeof e.nameSci !== 'string' || !e.nameSci) fail(`${where}:缺 nameSci`)
      else {
        const k = normalizeSciName(e.nameSci)
        if (seenName.has(k)) fail(`${where}:学名重复 ${e.nameSci}(与 species[${seenName.get(k)}])`)
        else seenName.set(k, i)
      }
      if (!e.order || !e.family) noOrder++
      if (e.extinct === true) extinct++
      if (e.ebirdCode) withEbird++
      if (e.backboneTaxonId != null) withBackbone++
      checkGeoKeys(e, where)
    }
    if (noOrder) fail(`${noOrder} 条 species 缺 order/family`)
    if (index.checklistVersion && extinct === 0) fail('0 条 extinct 标记,异常(全球名录必然含灭绝种)')
    console.log(
      `· 骨架:species ${index.species.length} · taxonKey 唯一 ✓ · 学名唯一 ✓ · eBird 码 ${withEbird} · backbone ${withBackbone} · 灭绝种 ${extinct}`,
    )
  }

  checkGeoKeys(index, '顶层')

  // manifest 交叉校验:现有 1299 全部 playable=true 且 taxonKey 能对回骨架。
  // 学名不一致仅在 bankMappingNotes 有注记时放行(概念合并:AviList 并入父种,manifest 保留旧学名)。
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'))
  const notes = Array.isArray(index.bankMappingNotes) ? index.bankMappingNotes : []
  const noteByKeyId = new Map(notes.map((n) => [`${n.id}|${n.taxonKey}`, n]))
  if (!Array.isArray(manifest.species) || !manifest.species.length) {
    fail('manifest.species 为空(无法交叉校验)')
  } else {
    const byKey = new Map(index.species.map((e) => [e.taxonKey, e]))
    const noKey = []
    const noPlayable = []
    const keyMismatch = []
    let noted = 0
    for (const s of manifest.species) {
      if (!s.taxonKey) {
        noKey.push(s.id)
        continue
      }
      if (s.playable !== true) noPlayable.push(s.id)
      const e = byKey.get(s.taxonKey)
      if (!e) {
        keyMismatch.push(`${s.id}:taxonKey=${s.taxonKey} 不在骨架`)
        continue
      }
      if (normalizeSciName(e.nameSci) !== normalizeSciName(s.nameSci)) {
        const n = noteByKeyId.get(`${s.id}|${s.taxonKey}`)
        if (n && n.resolvedTo && normalizeSciName(n.resolvedTo) === normalizeSciName(e.nameSci)) noted++
        else keyMismatch.push(`${s.id}:骨架学名 ${e.nameSci} ≠ manifest ${s.nameSci}(同 taxonKey,无 bankMappingNotes 注记)`)
      }
    }
    if (noKey.length) fail(`${noKey.length} 个 manifest 物种缺 taxonKey(如 ${noKey.slice(0, 5).join(', ')})`)
    if (noPlayable.length) fail(`${noPlayable.length} 个 manifest 物种 playable≠true`)
    if (keyMismatch.length) for (const x of keyMismatch.slice(0, 10)) fail(`映射不一致:${x}`)
    console.log(
      `· manifest 交叉:${manifest.species.length} 物种 · taxonKey 全存在 ✓ · playable 全 true ✓ · 概念合并注记 ${notes.length} 条(命中 ${noted})${keyMismatch.length ? ` · 映射不一致 ${keyMismatch.length} ✗` : ''}`,
    )
  }

  if (problems.length) {
    console.error(`\n✗ check:index 失败(${problems.length} 项):`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`\n✓ check:index:骨架结构与 1299 映射校验通过(${rel})`)
} catch (e) {
  console.error(`✗ check:index:${e.message}`)
  process.exit(1)
}
