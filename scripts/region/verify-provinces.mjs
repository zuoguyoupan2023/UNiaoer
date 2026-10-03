/**
 * 022 §1.7：省级矩阵**对照校验**（D-022-1=省级矩阵，D-022-3=仅对照，不改构建路径）。
 * 输入：GBIF SQL 结果（默认 data-cache/region/gbif-sql 内最新 0008688-*.json）
 *       + public/data/region-provinces.json + manifest + ISO 3166-2 基准。
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
const [manifest, rp, subsRaw, rows] = await Promise.all([
  readJson(path.join(ROOT, 'public/data/manifest.json')),
  readJson(path.join(ROOT, 'public/data/region-provinces.json')),
  readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json')),
  readJson(sqlFile),
])

const subdivisions = subsRaw.subdivisions || subsRaw
const index = buildIndex(subdivisions, rp.countries || null)
const speciesMap = buildSpeciesMap(manifest.species)

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
