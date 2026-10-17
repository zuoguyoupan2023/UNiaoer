/**
 * 053-describe P5：AVONET —— 形态测量（识别特征的量化底座）+ 生态变量交叉验证。
 *
 * 产物：`data/avonet-traits.json`（taxonKey → { morph{}, eco{}, flags{} }）
 * 原始文件（gitignore，需自行下载）：`data-cache/taxonomy/avonet/AVONET_EcoData.csv`
 *   官方：https://figshare.com/articles/dataset/AVONET_..._/16586228 （Supplementary dataset 1，
 *         21.5 MB xlsx；**本机实测 ndownloader 被 AWS WAF 拦**，故用其 species-level 汇总表的镜像）
 *   镜像：https://cdn.jsdelivr.net/gh/gbravo1/dry_diagonal_traits_birds@main/AVONET_EcoData.csv
 *         （第三方副本，**采信前请用 --verify 校验行数/列名**）
 *
 * 🔑 为什么 AVONET 优先：它的 `Avibase.ID1`（`AVIBASE-BBB59880`）与我们的 `taxonKey`
 *   （`avibase-BBB59880`）**只差大小写** → 归一化后直连，**完全不需要异名消解**
 *   （实测命中率 90.1% 全球池 / 91.3% 核心池；对比 EltonTraits 并集上限 87.1%）。
 *
 * ⚠️ 三个实测坑（2026-10-17，见 docs/053-describe §10.4）：
 *   1. 首列名带 **BOM**（`Sequence` 前有一个 U+FEFF）→ 自带解析器会得到带 BOM 的键。
 *   2. `Mass` 单位是**克**（鸵鸟 111000 ✓）；勿与其它源的千克混淆。
 *   3. `Inference` / `Traits.inferred` 标记**插值得来的性状** → 必须透传，
 *      界面不得把它们当实测值展示（`flags.inferred`）。
 *
 * CLI：npm run taxonomy:avonet [-- --verify] [--input <path>]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
const INPUT = path.resolve(ROOT, String(args.input || 'data-cache/taxonomy/avonet/AVONET_EcoData.csv'))
const OUT = path.join(ROOT, 'data/avonet-traits.json')
const VERIFY_ONLY = !!args.verify

const SOURCE = {
  key: 'avonet-2022',
  name: 'AVONET: morphological, ecological and geographical data for all birds',
  url: 'https://figshare.com/articles/dataset/AVONET_morphological_ecological_and_geographical_data_for_all_birds_Tobias_et_al_2021_Ecology_Letters_/16586228',
  license: 'CC BY 4.0',
  attribution: 'Tobias JA et al. (2022)',
  citation:
    'Tobias, J. A. et al. (2022) AVONET: morphological, ecological and geographical data for all birds. Ecology Letters 25:581-597. https://doi.org/10.1111/ele.13898',
}

/** 形态测量（mm；Mass 单独处理，单位 g） */
const MORPH = {
  'Beak.Length_Culmen': 'beakCulmen',
  'Beak.Length_Nares': 'beakNares',
  'Beak.Width': 'beakWidth',
  'Beak.Depth': 'beakDepth',
  'Tarsus.Length': 'tarsus',
  'Wing.Length': 'wing',
  'Kipps.Distance': 'kipps',
  'Secondary1': 'secondary',
  'Hand-Wing.Index': 'handWingIndex',
  'Tail.Length': 'tail',
}
/**
 * 生态 / 地理变量。
 * ⚠️ **刻意不取经纬度**（Min/Max/Centroid Latitude/Longitude）：产品不展示地图与边界
 * （AGENTS.md 铁律 6），留存只会诱使下游做地图，且无谓地把产物撑大。
 */
const ECO = {
  Habitat: 'habitat',
  'Habitat.Density': 'habitatDensity',
  Migration: 'migration',
  'Trophic.Level': 'trophicLevel',
  'Trophic.Niche': 'trophicNiche',
  'Primary.Lifestyle': 'primaryLifestyle',
  'Range.Size': 'rangeSize',
}

/** 极简 CSV（TSV）解析：AVONET 表内无引号包裹的逗号，按逗号切即可 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = lines[0].replace(/^﻿/, '').split(',')
  const rows = []
  for (const line of lines.slice(1)) {
    const f = line.split(',')
    if (f.length < header.length) continue
    rows.push(Object.fromEntries(header.map((h, i) => [h, f[i]])))
  }
  return { header, rows }
}

/** `AVIBASE-BBB59880` / `avibase-BBB59880` → `avibase-BBB59880` */
const taxonKeyOf = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return ''
  const id = s.replace(/^AVIBASE-/i, '').toUpperCase()
  return /^AVIBASE-/i.test(s) || /^[0-9A-F]{8}$/.test(id) ? `avibase-${id}` : ''
}
const num = (v) => {
  const s = String(v ?? '').trim()
  if (s === '' || s === 'NA' || s === '-9999' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const str = (v) => {
  const s = String(v ?? '').trim()
  return s === '' || s === 'NA' || s === '-9999' ? null : s
}

async function main() {
  const text = await fs.readFile(INPUT, 'utf8')
  const { header, rows } = parseCsv(text)
  console.log(`原始：${rows.length} 行 × ${header.length} 列`)

  // 校验（第三方镜像必须核对，见坑 1 与头注）
  const need = ['Avibase.ID1', 'AVONET_BirdLife', 'Mass', ...Object.keys(MORPH), ...Object.keys(ECO)]
  const missing = need.filter((c) => !header.includes(c))
  if (missing.length) throw new Error(`AVONET 表缺列：${missing.join(', ')}（镜像可能不是这份文件）`)
  if (rows.length < 10_000 || rows.length > 12_000) {
    throw new Error(`行数 ${rows.length} 异常（官方应为 11,009）——镜像不对，停止`)
  }
  console.log(`  列名与行数校验通过（行数应为 11,009；列数实测 ${header.length}）`)
  if (VERIFY_ONLY) {
    console.log('✅ --verify 通过')
    return
  }

  const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  const pool = index.species

  const avo = new Map()
  for (const r of rows) {
    const k = taxonKeyOf(r['Avibase.ID1'])
    if (!k || avo.has(k)) continue
    avo.set(k, r)
  }
  console.log(`AVONET 可按 taxonKey 索引：${avo.size} 种（缺 Avibase.ID1 的 ${rows.length - avo.size} 行已跳过）`)

  // 二级索引：学名（仅在 taxonKey 未命中时兜底）。
  // 实测理由：AVONET 用 BirdLife 2021 属名，AviList 2025b 把若干区域种提为独立种
  // （如 Aegithalos concinnus → AVONET 的 Suthora concinna）→ 这类按 taxonKey 会漏，
  // 而学名兜底能救回。**兜底命中必须标 matchedBy='nameSci'**，供人工抽检。
  const avoByName = new Map()
  for (const r of rows) {
    const n = str(r.AVONET_BirdLife)
    if (n && !avoByName.has(n)) avoByName.set(n, r)
  }
  console.log(`  学名兜底索引：${avoByName.size} 种`)

  const byTaxonKey = {}
  const unmatched = []
  let nameDiff = 0
  let inferredCount = 0
  let byKey = 0
  let byName = 0
  for (const sp of pool) {
    const r = avo.get(sp.taxonKey) || avoByName.get(sp.nameSci) || null
    if (!r) {
      unmatched.push({ nameSci: sp.nameSci, taxonKey: sp.taxonKey })
      continue
    }
    const matchedBy = avo.has(sp.taxonKey) ? 'taxonKey' : 'nameSci'
    if (matchedBy === 'taxonKey') byKey++
    else byName++
    if (str(r.AVONET_BirdLife) && str(r.AVONET_BirdLife) !== sp.nameSci) nameDiff++
    const morph = {}
    for (const [col, key] of Object.entries(MORPH)) {
      const v = num(r[col])
      if (v !== null) morph[key] = v
    }
    const massG = num(r.Mass)
    if (massG !== null) morph.massG = massG
    const eco = {}
    for (const [col, key] of Object.entries(ECO)) {
      const v = num(r[col])
      if (v !== null) eco[key] = v
    }
    for (const [col, key] of Object.entries(ECO)) {
      if (!(key in eco)) {
        const s = str(r[col])
        if (s !== null) eco[key] = s
      }
    }
    const inferred = String(r.Inference || '').trim().toUpperCase().startsWith('Y')
    if (inferred) inferredCount++
    byTaxonKey[sp.taxonKey] = {
      nameSci: sp.nameSci,
      avonetName: str(r.AVONET_BirdLife),
      matchedBy,
      morph,
      eco,
      flags: {
        inferred, // 见坑 3：插值性状，界面不得当实测值展示
        totalIndividuals: num(r['Total.individuals']),
        massSource: str(r['Mass.Source']),
      },
    }
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    note:
      'AVONET 形态测量（mm；massG 为克）+ 生态/地理变量。' +
      '主键匹配：Avibase.ID ↔ taxonKey 大小写归一化直连（matchedBy=taxonKey，无需异名消解）；' +
      '兜底：AVONET 用 BirdLife 2021 属名，AviList 2025b 的区域种提级会让 taxonKey 落空，' +
      '故再按学名精确兜底（matchedBy=nameSci，供人工抽检）。' +
      'flags.inferred=true 的性状为插值结果，UI 需区别标注。' +
      'counts.nameDiscrepancies 的学名差异多为**真实的分类修订**（AviList 2025b 属名新立 vs AVONET 的 BirdLife 属名，' +
      '如 Tetrastes↔Bonasa、Campocolinus↔Peliperdix）——这正是 taxonKey 直连的价值。',
    counts: {
      pool: pool.length,
      matched: Object.keys(byTaxonKey).length,
      matchedByTaxonKey: byKey,
      matchedByName: byName,
      unmatched: unmatched.length,
      inferredTraits: inferredCount,
      nameDiscrepancies: nameDiff,
    },
    byTaxonKey,
    unmatched,
  }
  // 产物是提交物，默认压缩输出（缩进版约 10 MB）；`--pretty` 供人工核对
  await fs.writeFile(OUT, args.pretty ? JSON.stringify(payload, null, 2) + '\n' : JSON.stringify(payload) + '\n')

  const matched = Object.keys(byTaxonKey).length
  console.log(
    `\n✅ data/avonet-traits.json：池 ${pool.length} / 命中 ${matched}（${((matched / pool.length) * 100).toFixed(1)}%）/ 未匹配 ${unmatched.length} / 插值性状 ${inferredCount} / 学名不一致 ${nameDiff}`,
  )
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
