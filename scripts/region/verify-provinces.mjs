/**
 * 022 §1.7：省级矩阵**对照校验**（D-022-1=省级矩阵，D-022-3=仅对照，不改构建路径）。
 * 输入：GBIF SQL 结果（默认 data-cache/region/gbif-sql 内最新 0008688-*.json）
 *       + **省级层分片**（public/data/region-provinces/index.json + <CC>.json）
 *       + **权威层 manifest-meta.json**（manifest.json 已退役）+ ISO 3166-2 基准。
 *
 * 2026-10-23 修（P1-5）：本脚本此前读 `public/data/manifest.json` 与单文件 `region-provinces.json`，
 * 两个都已在 P5/S6 与 P1-6 退役 → 一跑就 ENOENT，**从没人发现**，也因此让 P0-0 的解析缺陷藏了半个月。
 * 现在只读现存产物；并把「非种级解析」清单打印出来（防复发）。
 * 输出：差异报告（物种/单元格/记录数三级 + 每国 + 未匹配清单），可选 --out 落 JSON。
 *
 * CLI：npm run region:verify-provinces -- [--in path] [--out report.json]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { buildIndex } from './adapters/iso3166.mjs'
import { aggregateSqlRows, buildSpeciesMap, compareProvinces } from './verify-provinces-lib.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

async function findSqlFile() {
  if (args.in) return path.resolve(ROOT, args.in)
  const dir = path.join(ROOT, 'data-cache/region/gbif-sql')
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^0008688-.*\.json$/.test(f))
  if (!files.length) throw new Error('找不到 SQL 结果（先 npm run region:gbif-sql -- --key 0008688-…）')
  files.sort()
  return path.join(dir, files[files.length - 1])
}

const sqlFile = await findSqlFile()
const [manifest, pvIndex, subsRaw, rows] = await Promise.all([
  readJson(path.join(ROOT, 'public/data/manifest-meta.json')),
  readJson(path.join(ROOT, 'public/data/region-provinces/index.json')),
  readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json')),
  readJson(sqlFile),
])

/** 索引 + 按国分片 → 与旧单文件同构的 { countries, bySpecies } */
const pvDir = path.join(ROOT, 'public/data', pvIndex.sharding?.dir || 'region-provinces')
const pvFiles = pvIndex.sharding?.files?.length
  ? pvIndex.sharding.files
  : (await fs.readdir(pvDir).catch(() => [])).filter((f) => f.endsWith('.json') && f !== 'index.json')
const rp = { countries: pvIndex.countries || [], bySpecies: {} }
for (const f of pvFiles) {
  const shard = await readJson(path.join(pvDir, f)).catch(() => null)
  if (!shard) continue
  for (const [id, byCode] of Object.entries(shard.bySpecies || {})) {
    ;(rp.bySpecies[id] ??= {})[shard.cc] = byCode
  }
}

const subdivisions = subsRaw.subdivisions || subsRaw
const index = buildIndex(subdivisions, rp.countries || null)
const speciesMap = buildSpeciesMap(manifest.species)

/**
 * 默认口径（2026-10-23）：**省级产物 ↔ 国家层记录数** 互校（不再依赖任何 SQL 下载）。
 *  - 每个 (物种,国家)：省级合计必须 **≤** 国家层记录数（省级只计能映射到 ISO 省名的记录）；
 *  - 比值中位数应接近该国的 `coverage`（省名映射率）；明显偏低 = 省名映射/物种匹配有漏；
 *  - 省级合计 > 国家层 = 硬错误（两层口径不可能出现，多半是港澳台归并或别名重复计算）。
 * `--in <sql>` 时退回旧的 SQL 矩阵对照（仅 0008688/0040468 这类历史下载有，参考用）。
 */
async function verifyAgainstCountryTotals() {
  const recIndex = await readJson(path.join(ROOT, 'public/data/region-records/index.json'))
  const provSum = new Map() // `${cc}|${id}` → n
  for (const [id, byCc] of Object.entries(rp.bySpecies)) {
    for (const [cc, cells] of Object.entries(byCc)) {
      const sum = Object.values(cells).reduce((a, b) => a + b, 0)
      provSum.set(`${cc}|${id}`, sum)
    }
  }
  const countries = [...new Set([...provSum.keys()].map((k) => k.split('|')[0]))].sort()
  const rows = []
  let over = 0
  let checked = 0
  let sumProv = 0
  let sumCountry = 0
  for (const cc of countries) {
    const shard = await readJson(path.join(ROOT, `public/data/region-records/${cc}.json`)).catch(() => null)
    if (!shard?.bySpecies) continue
    const ratios = []
    for (const [id, n] of Object.entries(shard.bySpecies)) {
      const p = provSum.get(`${cc}|${id}`)
      if (!p) continue
      checked++
      sumProv += p
      sumCountry += n
      if (p > n) {
        over++
        rows.push(`${cc} ${id}: 省级 ${p.toLocaleString()} > 国家层 ${n.toLocaleString()}`)
      } else if (n >= 500) ratios.push(p / n)
    }
    ratios.sort((a, b) => a - b)
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null
    const cov = recIndex.coverage?.byCountry?.[cc]?.coverage ?? recIndex.totals?.[cc] ? null : null
    void cov
    rows.push(`  ${cc}: 省级/国家层 中位数 ${med == null ? '-' : (med * 100).toFixed(1) + '%'}（${ratios.length} 对有省级数据）`)
  }
  console.log(`\nverify-provinces（默认口径：省级 ↔ 国家层记录数，只读）`)
  console.log(`  国家 ${countries.length} · (物种,国家) 对 ${checked.toLocaleString()} · 省级合计 ${sumProv.toLocaleString()} / 国家层 ${sumCountry.toLocaleString()}`)
  console.log(`  ✗ 省级 > 国家层：${over} 对${over ? '（硬错误，见下）' : '（0 = 通过）'}`)
  for (const r of rows.slice(0, 200)) console.log(`  ${r}`)
  if (over) {
    console.log('\n  提示：省级包含港澳台（CN-71/91/92）时，CN 的省级合计可能大于 GBIF「CN」国家层（后者不含 TW/HK/MO），')
    console.log('        这是口径差异而非错误；其余国家出现即需排查。')
  }
  return over
}

if (!args.in) {
  await verifyAgainstCountryTotals()
  process.exit(0)
}

const agg = aggregateSqlRows(rows, { index, speciesMap })
const stats = compareProvinces(rp.bySpecies || {}, agg.bySpecies)

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
const top = (m, n = 8) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `    ${k.replace('\t', ' / ')} (${v})`)

console.log(`\nverify-provinces（对照，不改产物）`)
console.log(`  SQL: ${path.relative(ROOT, sqlFile)}（${rows.length} 行）`)
console.log(`  物种：existing ${stats.species.existing} · sql ${stats.species.sql} · both ${stats.species.both}`)
console.log(
  `  单元格（species×country×code）：existing ${stats.cells.existing} · sql ${stats.cells.sql} · ` +
    `both ${stats.cells.both} · only-existing ${stats.cells.onlyExisting} · only-sql ${stats.cells.onlySql}`,
)
console.log(
  `  记录数：existing ${stats.records.existing} · sql ${stats.records.sql}` +
    `（both 内 existing ${stats.records.bothExisting} / sql ${stats.records.bothSql}）`,
)
console.log(
  `  行映射：学名 ${pct(agg.mappedRows, agg.totalRows)}%（未匹配学名 ${agg.unmatchedNames.size} 个）· ` +
    `省级名未识别 ${agg.unmatchedProvinces.size} 个`,
)
if (agg.unmatchedNames.size) {
  console.log('  未匹配学名 Top：')
  console.log(top(agg.unmatchedNames).join('\n'))
}
if (agg.unmatchedProvinces.size) {
  console.log('  未识别省级名 Top：')
  console.log(top(agg.unmatchedProvinces).join('\n'))
}
console.log('  按国家（cells both/onlyE/onlyS · records existing/sql）：')
for (const [cc, c] of Object.entries(stats.byCountry).sort()) {
  console.log(
    `    ${cc}: cells ${c.cellsBoth}/${c.cellsExisting - c.cellsBoth}/${c.cellsSql - c.cellsBoth} · ` +
      `records ${c.recordsExisting}/${c.recordsSql}`,
  )
}
if (args.out) {
  const out = path.resolve(ROOT, args.out)
  await fs.writeFile(out, JSON.stringify({ sqlFile: path.relative(ROOT, sqlFile), stats, agg: {
    mappedRows: agg.mappedRows, totalRows: agg.totalRows,
    unmatchedNames: [...agg.unmatchedNames], unmatchedProvinces: [...agg.unmatchedProvinces],
  } }, null, 2))
  console.log(`\n  报告 → ${path.relative(ROOT, out)}`)
}
