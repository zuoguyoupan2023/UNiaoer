#!/usr/bin/env node
/**
 * 把物种档案（C1）增量并入已生成的 manifest（build-bank 也会自动并入）。
 *
 * 组成：类群（按科派生，可人工覆盖）+ 分布（data/distribution.json，按 taxonId 关联）
 *      + 居留型/生境/习性（data/species-profiles.json，人工稀疏）。
 * 不重跑 bank（抓取/转码）时用它更新：就地写 species[].profile。
 *
 * 用法：node scripts/apply-profiles.mjs [--manifest public/data/manifest.json]
 * 退出码：0 成功；1 人工 id 在 manifest 中不存在（多为拼写错误）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, ensureDir } from './lib/util.mjs'
import {
  loadDistribution,
  loadSpeciesProfiles,
  applyProfiles,
  buildCountryIndex,
  unmatchedProfileIds,
} from './lib/profiles.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const MANIFEST = path.resolve(ROOT, args.manifest || 'public/data/manifest.json')
const COUNTRY_INDEX = path.join(ROOT, 'public/data/distribution.json')

const [dist, curated] = await Promise.all([loadDistribution(ROOT), loadSpeciesProfiles(ROOT)])
const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
if (!Array.isArray(manifest.species)) {
  console.error(`❌ ${path.relative(ROOT, MANIFEST)} 的 species 不是数组`)
  process.exit(1)
}

const applied = applyProfiles(manifest.species, dist, curated)
await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2))

// 国家码列表另存为精简索引（组件按需加载），保持 manifest 体积可控
const bySpecies = buildCountryIndex(manifest.species, dist)
await ensureDir(path.dirname(COUNTRY_INDEX))
await fs.writeFile(
  COUNTRY_INDEX,
  JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), bySpecies }),
)

const groups = {}
let withDist = 0
let countries = 0
for (const sp of manifest.species) {
  const g = sp.profile?.group
  if (g) groups[g] = (groups[g] || 0) + 1
  const n = sp.profile?.distribution?.count ?? 0
  if (n) {
    withDist++
    countries += n
  }
}
console.log(
  `✅ 物种档案：${path.relative(ROOT, MANIFEST)} 并入 ${applied}/${manifest.species.length} 条` +
    `（人工 ${Object.keys(curated).length}，分布 ${withDist}，平均 ${withDist ? (countries / withDist).toFixed(1) : 0} 国）`,
)
console.log(`   类群：${JSON.stringify(groups)}；国家索引 → ${path.relative(ROOT, COUNTRY_INDEX)}`)

const orphan = unmatchedProfileIds(manifest.species, curated)
if (orphan.length) {
  console.error(`❌ 以下档案 id 在 manifest 中不存在（检查拼写）：${orphan.join('、')}`)
  process.exit(1)
}
