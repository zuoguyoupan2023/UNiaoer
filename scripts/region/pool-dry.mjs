/**
 * 087 P2：省级/国家级**出题池子干跑**（只读，零网络，不产 git 产物）。
 *
 * 目的：回答「哪些省级区域池子太小」——池子是**三重交集**：
 *   ① 地区档位表（province-commonness，D-036-8 排除式语义：表外 = 本地罕见/无记录）
 *   ② 可播素材（meta 的 playableImage/playableAudio，且未被 quizExcluded 隔离）
 *   ③ 卷别名字（zh 只收有中文名的种；en 收英文名；sci 全量）
 * 三者相乘后的池子决定「选了这个地区，一轮最多能出几题」。
 *
 * 口径与线上出题链路严格一致（quiz.store mergedSpecies → questionEngine buildPool）：
 *   池(region, type, mode) = meta 物种
 *     ∧ !quizExcluded ∧ playable(type)
 *     ∧ 区系层有该国记录（species-distribution byCountry，省码取国家级）
 *     ∧ 该地区档位表（国家级 = <CC>.country.json tiers；省级 = <CC>.json tiersByCode[省]）
 *     ∧ nameMode 名字（zh→nameZh / en→nameEn / sci→恒真）
 *
 * 分级（docs/087 §2.3）：A 充足 ≥30 · B 可用 10–29 · C 薄 6–9 · D 极薄 1–5 · E 空 0。
 * （一轮标准 10 题；C/D 会触发 072-a 短轮说明。）
 *
 * CLI：
 *   node scripts/region/pool-dry.mjs                    # 全部有档位数据的国家
 *   node scripts/region/pool-dry.mjs --countries CN,TH
 *   node scripts/region/pool-dry.mjs --json             # 报告 → data-cache/region/pool-report.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const P = (rel) => path.join(ROOT, rel)

const args = parseArgs(process.argv.slice(2))
const requested = String(args.countries || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

// ---- 数据装载（全部本地只读） ----
const meta = JSON.parse(await fs.readFile(P('public/data/manifest-meta.json'), 'utf8'))
const dist = JSON.parse(await fs.readFile(P('public/data/species-distribution.json'), 'utf8'))
const provIndex = JSON.parse(
  await fs.readFile(P('public/data/region-provinces/index.json'), 'utf8'),
).byCountry

/** 与 src/core/provinces.ts PROVINCE_HIDDEN_COUNTRIES 同名单（083：镇级/微型/低覆盖收起二级）。
 *  脚本侧不 import TS，改动那张表时同步这里。 */
const PROVINCE_HIDDEN_COUNTRIES = new Set(['SI', 'LV', 'MK', 'MT', 'SG', 'NR', 'TV', 'KI', 'MH'])

const species = (meta.species || []).filter((sp) => !sp.quizExcluded)

// 区系层：短码集合按国建索引（省码按国家级过滤，与 globalPool.countryOfRegion 同语义）
const presenceCache = new Map()
function presenceOf(cc) {
  let set = presenceCache.get(cc)
  if (!set) {
    const codes = dist.byCountry?.[cc]
    set = new Set(Array.isArray(codes) ? codes : [])
    presenceCache.set(cc, set)
  }
  return set
}

const MODES = [
  ['zh', (sp) => !!sp.nameZh],
  ['en', (sp) => !!sp.nameEn],
  ['sci', () => true],
]
const TYPES = ['image', 'audio']
const playableOf = (sp, type) => (type === 'image' ? sp.playableImage === true : sp.playableAudio === true)

/** 池子计算：传入「该地区档位表」的物种 id 集合 */
function poolSize(tableIds, type, modeCheck) {
  let n = 0
  for (const sp of species) {
    if (!tableIds.has(sp.id)) continue
    if (!playableOf(sp, type)) continue
    if (!modeCheck(sp)) continue
    n++
  }
  return n
}

function grade(n) {
  if (n >= 30) return 'A'
  if (n >= 10) return 'B'
  if (n >= 6) return 'C'
  if (n >= 1) return 'D'
  return 'E'
}

// 有档位数据的国家 = province-commonness 下的 <CC>.country.json（出题真实可用的集合）
const pubDir = P('public/data/province-commonness')
const pubFiles = await fs.readdir(pubDir)
const countryCodes = pubFiles
  .filter((f) => f.endsWith('.country.json'))
  .map((f) => f.replace('.country.json', ''))
  .filter((cc) => !requested.length || requested.includes(cc))

const rows = []
for (const cc of countryCodes) {
  const countryTier = JSON.parse(
    await fs.readFile(path.join(pubDir, `${cc}.country.json`), 'utf8'),
  )
  const countryTable = new Set(Object.keys(countryTier.tiers || {}))
  const pres = presenceOf(cc)

  /** (type, mode) 池子（国家级） */
  const countryPools = {}
  for (const type of TYPES)
    for (const [mode, check] of MODES)
      countryPools[`${type}:${mode}`] = poolSize(countryTable, type, check)

  // 省级：来自 <CC>.json tiersByCode
  let provDoc = { tiersByCode: {} }
  try {
    provDoc = JSON.parse(await fs.readFile(path.join(pubDir, `${cc}.json`), 'utf8'))
  } catch {
    /* 无省级分片（非 194 国）：省级记 0 个 */
  }
  const provinces = []
  for (const [code, tiers] of Object.entries(provDoc.tiersByCode || {})) {
    if (PROVINCE_HIDDEN_COUNTRIES.has(cc)) continue // 083：二级收起名单，线上到不了这里
    const table = new Set(Object.keys(tiers || {}))
    const pools = {}
    for (const type of TYPES)
      for (const [mode, check] of MODES) pools[`${type}:${mode}`] = poolSize(table, type, check)
    provinces.push({
      code,
      name: provIndex?.[cc]?.[code] ?? code,
      // 主口径：看图 × 中文卷（中文用户默认卷）；其余维度进 pools
      pool: pools['image:zh'],
      grade: grade(pools['image:zh']),
      pools,
    })
  }
  provinces.sort((a, b) => a.pool - b.pool)

  rows.push({
    cc,
    countryTable: countryTable.size,
    inCountry: pres.size,
    countryPool: countryPools['image:zh'],
    countryGrade: grade(countryPools['image:zh']),
    countryPools,
    provinces,
    provinceGrades: provinces.reduce((acc, p) => ((acc[p.grade] = (acc[p.grade] ?? 0) + 1), acc), {}),
  })
}

// ---- 汇总 ----
const hist = { A: 0, B: 0, C: 0, D: 0, E: 0 }
let provTotal = 0
for (const r of rows) {
  for (const p of r.provinces) {
    hist[p.grade]++
    provTotal++
  }
}
const countryHist = rows.reduce((acc, r) => ((acc[r.countryGrade] = (acc[r.countryGrade] ?? 0) + 1), acc), {})

const pad = (s, n) => String(s).padEnd(n)
console.log(
  `\n出题池子干跑 · ${rows.length} 国 · ${provTotal} 个省级区划（口径：看图 × 中文卷 = 档位表 ∩ 可播 ∩ 区系 ∩ 有中文名）\n`,
)
console.log(`${pad('国', 4)}${pad('档位表', 8)}${pad('区系种', 8)}${pad('国家池', 8)}${pad('判定', 4)}省级分布 (C/D/E 是薄池)`)
for (const r of rows) {
  const pg = r.provinceGrades
  const detail = r.provinces.length
    ? `A${pg.A ?? 0} B${pg.B ?? 0} C${pg.C ?? 0} D${pg.D ?? 0} E${pg.E ?? 0}` +
      (pg.C || pg.D || pg.E
        ? `  最薄: ${r.provinces.slice(0, 3).map((p) => `${p.name}(${p.pool})`).join(' ')}`
        : '')
    : '-'
  console.log(
    `${pad(r.cc, 4)}${pad(r.countryTable, 8)}${pad(r.inCountry, 8)}${pad(r.countryPool, 8)}${pad(r.countryGrade, 4)}${detail}`,
  )
}
console.log(
  `\n国家级分布: ${JSON.stringify(countryHist)} · 省级分布(${provTotal}): ${JSON.stringify(hist)}`,
)
console.log(`\n判定: A ≥30 · B 10–29 · C 6–9（薄，会短轮） · D 1–5（极薄） · E 0`)

if (args.json) {
  const out = args.json === true ? P('data-cache/region/pool-report.json') : path.resolve(ROOT, args.json)
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), rows, hist, countryHist, provTotal }, null, 1),
  )
  console.log(`报告 → ${path.relative(ROOT, out)}`)
}
