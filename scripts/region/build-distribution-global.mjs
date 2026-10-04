/**
 * 025 M1(P1-c):构建全球区系产物 public/data/species-distribution.json(不进 manifest,按需加载)。
 * 数据链:GBIF SQL 国家矩阵(022 runner 下载,`npm run region:gbif-sql`)→ 学名二名法归并 →
 *        骨架 taxonKey(AvibaseID 短码)→ 按国倒排。
 * 口径:GBIF 观测(含引入种群),presence 不带 count——与现有 distribution.json 一致(025 §2)。
 *
 * CLI:npm run region:distribution [-- --in path] [--mock] [--out path]
 *   --in 缺省自动取 data-cache/region/gbif-sql/ 最新 JSON;--mock 读夹具全离线(必须显式 --out)。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { normBinomial } from './verify-provinces-lib.mjs'
import { aggregateCountryMatrix, shortCode, toByCountryObject } from './distribution-global-lib.mjs'
import { GBIF_SQL_SOURCE } from './config.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const INDEX_PATH = path.join(ROOT, 'public/data/species-index.json')
const SQL_DIR = path.join(ROOT, 'data-cache/region/gbif-sql')
const MOCK_FIXTURE = path.join(ROOT, 'tests/fixtures/region/distribution-global/sql-sample.json')

const args = parseArgs(process.argv.slice(2))

try {
  // 骨架学名 → 短码
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'))
  const nameToCode = new Map()
  for (const e of index.species) {
    nameToCode.set(normBinomial(e.nameSci), shortCode(e.taxonKey))
  }
  console.log(`骨架学名映射:${nameToCode.size}(${index.species.length} 条;二名法归并重复 ${index.species.length - nameToCode.size})`)

  // SQL 行
  let rows
  if (args.mock) {
    if (!args.out) throw new Error('--mock 必须显式 --out(防止夹具数据污染真产物)')
    rows = JSON.parse(await fs.readFile(MOCK_FIXTURE, 'utf8')).rows
    console.log(`--mock:读夹具 ${path.relative(ROOT, MOCK_FIXTURE)}(${rows.length} 行)`)
  } else {
    let inFile = args.in ? path.resolve(ROOT, args.in) : null
    if (!inFile) {
      const files = (await fs.readdir(SQL_DIR).catch(() => [])).filter((f) => /^.*-\d+\.json$/.test(f)).sort()
      if (!files.length) throw new Error(`未找到 SQL 结果(先 npm run region:gbif-sql 提交/续传下载)`)
      inFile = path.join(SQL_DIR, files[files.length - 1])
      console.log(`使用最新 SQL 结果:${path.relative(ROOT, inFile)}`)
    }
    rows = JSON.parse(await fs.readFile(inFile, 'utf8'))
    if (!Array.isArray(rows)) throw new Error('SQL 结果应为行对象数组')
    console.log(`SQL 行:${rows.length}`)
  }

  const { byCountry, skipped } = aggregateCountryMatrix(rows, nameToCode)
  const byCountryObj = toByCountryObject(byCountry)
  const pairs = Object.values(byCountryObj).reduce((n, arr) => n + arr.length, 0)
  console.log(
    `聚合:国家 ${Object.keys(byCountryObj).length} · (国家,物种)对 ${pairs} · 丢弃 未收录学名 ${skipped.unknownName} / 非法国家码 ${skipped.badCountry} / 排除码(ZZ/XK/XZ) ${skipped.deniedCountry}`,
  )

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: `GBIF SQL occurrence(country matrix, class='Aves'), presence-only; names matched to AviList v2025b via binomial normalization`,
    sources: [GBIF_SQL_SOURCE],
    counts: {
      countries: Object.keys(byCountryObj).length,
      pairs,
      unmatchedNames: skipped.unknownName,
      badCountry: skipped.badCountry,
      deniedCountry: skipped.deniedCountry,
    },
    byCountry: byCountryObj,
  }
  // 注:下载 key/DOI 由 sources[].attribution 说明 + docs/024 §2.2 登记(构建时无法回查 DOI)
  const outPath = path.resolve(ROOT, args.out || 'public/data/species-distribution.json')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, JSON.stringify(out))
  const mb = (Buffer.byteLength(JSON.stringify(out)) / 1e6).toFixed(2)
  console.log(`✓ 全球区系已产出:${path.relative(ROOT, outPath)}(${mb}MB)`)
} catch (e) {
  console.error(`✗ build-distribution-global:${e.message}`)
  process.exit(1)
}
