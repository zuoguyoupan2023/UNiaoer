/**
 * 053-describe P2：EltonTraits 1.0 —— 结构化习性（食性比例 / 取食层次 / 夜行性 / 体重）。
 *
 * 产物：`data/elton-traits.json`（taxonKey → { diet, foraging, nocturnal, massG, … }）
 * 原始文件（gitignore，需自行下载）：`data-cache/taxonomy/elton/BirdFuncDat.txt`
 *   官方可下载地址（本机实测 figshare 被 AWS WAF 拦，ESA 出版方档案可用）：
 *     https://esapubs.org/archive/ecol/E095/178/BirdFuncDat.txt      （主表，2.2 MB）
 *     https://esapubs.org/archive/ecol/E095/178/BirdFuncSources.txt  （引用文献对应表，署名用）
 *
 * ⚠️ 四个实测坑（2026-10-17，见 docs/053-describe §10.3）：
 *   1. **编码不是 UTF-8**（含 0x92 等 Windows-1252 字节）→ 必须按 latin-1 解码，
 *      否则 Node 会抛 UnicodeDecodeError。**这是最容易卡住的一步。**
 *   2. **末尾 2 行是空行**（学名/英文名皆空）→ 按字段判空丢弃，否则产出 2 条垃圾记录。
 *   3. 食性 10 列之和 ≈100（实测 9,993/9,995 行合格）→ 产物里带 `dietSum`，供门禁核对。
 *   4. `BodyMass-Value` 单位是**克**（鸵鸟 111000 ✓）。
 *
 * 匹配口径（诚实记录，不猜）：本数据集**没有稳定 ID**，只能按学名/英文名精确匹配后取并集。
 * 实测命中率：学名 70.7% · 英文名 77.1% · 并集 87.1%（未命中全是 2014 年后的区域种拆分）。
 * 未命中清单写进产物 `unmatched`，**不自动猜异名**。
 *
 * CLI：npm run taxonomy:elton [-- --input <path>]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
const INPUT = path.resolve(ROOT, String(args.input || 'data-cache/taxonomy/elton/BirdFuncDat.txt'))
const OUT = path.join(ROOT, 'data/elton-traits.json')

const SOURCE = {
  key: 'eltontraits-1.0',
  name: 'EltonTraits 1.0: Species-level foraging attributes of the world’s birds and mammals',
  url: 'https://esapubs.org/archive/ecol/E095/178/',
  license: '论文数据，引用即可（具体以数据集页声明为准）',
  attribution: 'Wilman H, Belmaker J, Simpson J, de la Rosa C, Rivadeneira MM, Jetz W (2014)',
  citation: 'Wilman, H., Belmaker, J., Simpson, J., de la Rosa, C., Rivadeneira, M. M., & Jetz, W. (2014). EltonTraits 1.0: Species-level foraging attributes of the world’s birds and mammals. Ecology 95:2027. https://doi.org/10.1890/13-1917.1',
}

const DIET_COLS = [
  ['invert', 'Diet-Inv'],
  ['vert', 'Diet-Vend'],
  ['ectVert', 'Diet-Vect'],
  ['fish', 'Diet-Vfish'],
  ['unkVert', 'Diet-Vunk'],
  ['scav', 'Diet-Scav'],
  ['fruit', 'Diet-Fruit'],
  ['nect', 'Diet-Nect'],
  ['seed', 'Diet-Seed'],
  ['plantOther', 'Diet-PlantO'],
]
const STRATUM_COLS = [
  ['waterBelowSurface', 'ForStrat-watbelowsurf'],
  ['waterAroundSurface', 'ForStrat-wataroundsurf'],
  ['ground', 'ForStrat-ground'],
  ['understory', 'ForStrat-understory'],
  ['midHigh', 'ForStrat-midhigh'],
  ['canopy', 'ForStrat-canopy'],
  ['aerial', 'ForStrat-aerial'],
]

const normName = (s) => String(s || '').trim().toLowerCase()

async function main() {
  const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  const pool = index.species

  let raw
  try {
    // 坑 1：latin-1
    raw = await fs.readFile(INPUT, 'latin1')
  } catch {
    throw new Error(`读不到原始文件 ${INPUT}\n先下载：\n  https://esapubs.org/archive/ecol/E095/178/BirdFuncDat.txt`)
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const header = lines[0].split('\t').map((h) => h.trim())
  const col = (name) => header.indexOf(name)

  const iSci = col('Scientific')
  const iEn = col('English')
  const needed = [
    ...DIET_COLS.map(([, c]) => c),
    ...STRATUM_COLS.map(([, c]) => c),
    'Nocturnal',
    'BodyMass-Value',
    'Diet-Certainty',
    'ForStrat-SpecLevel',
    'BodyMass-SpecLevel',
  ]
  const missingCols = needed.filter((c) => col(c) === -1)
  if (missingCols.length) throw new Error(`原始表缺列：${missingCols.join(', ')}`)

  // 坑 2：按学名判空丢行
  const bySci = new Map()
  const byEn = new Map()
  let parsed = 0
  let skipped = 0
  for (const line of lines.slice(1)) {
    const f = line.split('\t')
    const sci = (f[iSci] || '').trim()
    const en = (f[iEn] || '').trim()
    if (!sci) {
      skipped++
      continue
    }
    const num = (name) => {
      const v = (f[col(name)] || '').trim()
      if (v === '' || v === '-9999' || v === 'NA' || v === '-') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const diet = {}
    let sum = 0
    for (const [key, name] of DIET_COLS) {
      const v = num(name)
      if (v !== null) {
        diet[key] = v
        sum += v
      }
    }
    const foraging = {}
    for (const [key, name] of STRATUM_COLS) {
      const v = num(name)
      if (v !== null) foraging[key] = v
    }
    const rec = {
      sci,
      en: en || null,
      diet: Object.keys(diet).length ? diet : null,
      dietSum: Object.keys(diet).length ? Math.round(sum * 10) / 10 : null,
      foraging: Object.keys(foraging).length ? foraging : null,
      nocturnal: num('Nocturnal') === 1,
      massG: num('BodyMass-Value'),
      certainty: (f[col('Diet-Certainty')] || '').trim() || null,
      specLevel: {
        diet: (f[col('ForStrat-SpecLevel')] || '').trim() || null,
        mass: (f[col('BodyMass-SpecLevel')] || '').trim() || null,
      },
    }
    parsed++
    if (!bySci.has(sci)) bySci.set(sci, rec)
    if (en && !byEn.has(normName(en))) byEn.set(normName(en), rec)
  }
  console.log(`原始行 ${parsed}（丢弃空行 ${skipped}）· 唯一种 ${bySci.size}`)

  const byTaxonKey = {}
  const unmatched = []
  const bySciHit = new Set()
  const byEnHit = new Set()
  let badSum = 0
  for (const sp of pool) {
    const hit = bySci.get(sp.nameSci) || byEn.get(normName(sp.nameEn)) || null
    if (!hit) {
      unmatched.push({ nameSci: sp.nameSci, taxonKey: sp.taxonKey, nameEn: sp.nameEn ?? null })
      continue
    }
    if (bySci.has(sp.nameSci)) bySciHit.add(sp.nameSci)
    if (!bySci.has(sp.nameSci) && byEn.get(normName(sp.nameEn))) byEnHit.add(sp.nameSci)
    if (hit.dietSum !== null && Math.abs(hit.dietSum - 100) > 1) badSum++
    byTaxonKey[sp.taxonKey] = {
      nameSci: sp.nameSci,
      sourceSci: hit.sci,
      matchedBy: bySci.has(sp.nameSci) ? 'nameSci' : 'nameEn',
      diet: hit.diet,
      dietSum: hit.dietSum,
      foraging: hit.foraging,
      nocturnal: hit.nocturnal,
      massG: hit.massG,
      certainty: hit.certainty,
      specLevel: hit.specLevel,
    }
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    note:
      'EltonTraits 结构化习性：diet（10 类食性比例，%）/ foraging（7 层取食层次，%）/ nocturnal / massG（克）。' +
      '本数据集无稳定 ID，按学名或英文名精确匹配（matchMethod 见每条 matchedBy），未命中不入库（见 unmatched）。' +
      'dietSum 供门禁核对（|sum-100|<=1）。',
    counts: {
      pool: pool.length,
      matched: Object.keys(byTaxonKey).length,
      matchedBySci: bySciHit.size,
      matchedByEnOnly: byEnHit.size,
      unmatched: unmatched.length,
      dietSumOutliers: badSum,
    },
    byTaxonKey,
    unmatched,
  }
  // 产物是提交物，11k 条记录按 2 空格缩进会到 ~7 MB；默认压缩输出，`--pretty` 供人工核对
  await fs.writeFile(OUT, args.pretty ? JSON.stringify(payload, null, 2) + '\n' : JSON.stringify(payload) + '\n')

  console.log(
    `\n✅ data/elton-traits.json：池 ${pool.length} / 命中 ${Object.keys(byTaxonKey).length}（学名 ${bySciHit.size} · 仅英文名 ${byEnHit.size}）/ 未匹配 ${unmatched.length} / 食性和异常 ${badSum}`,
  )
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
