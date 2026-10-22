/**
 * 021 §2 / 074 P1-4：省级层**扩国前的覆盖率干跑**（只读，不产产物）。
 *
 * 目的：GBIF 的 `stateProvince` 是自由文本，各国写法差异极大（历史省名、旧转写、大区名、
 * 甚至把国名当省名）。扩国前先量一次「**按记录加权的可映射比例**」，低于门槛（默认 90%）
 * 就不该发布该国的省级明细（宁缺勿错）。
 *
 * CLI：
 *   node scripts/region/report-coverage.mjs                     # 报告 subs.json 里所有国家
 *   node scripts/region/report-coverage.mjs --countries TH,MY,ID
 *   node scripts/region/report-coverage.mjs --min 90 --json out.json
 *
 * 口径：`occurrence/search?taxonKey=212&country=<CC>&facet=stateProvince`（Aves，PRESENT），
 *      可映射比例 = Σ(能映射到 ISO 3166-2 的省名计数) / Σ(所有省名计数)。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/http.mjs'
import { parseArgs } from '../lib/util.mjs'
import { buildIndex, matchSubdivision } from './adapters/iso3166.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const GBIF = 'https://api.gbif.org/v1'
const SUBS = path.join(ROOT, 'data-cache/region/iso3166-2/subs.json')

const args = parseArgs(process.argv.slice(2))
const MIN = Number(args.min) || 90

const subs = JSON.parse(await fs.readFile(SUBS, 'utf8')).subdivisions || {}
const countries = String(args.countries || Object.keys(subs).join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

const client = createClient({
  name: 'gbif-coverage',
  cacheDir: path.join(ROOT, 'data-cache/region/gbif-coverage'),
  qps: 3,
  timeoutMs: 90_000,
  retries: 4,
})

const index = buildIndex(subs, countries)
const rows = []
for (const cc of countries) {
  if (!subs[cc]) {
    rows.push({ cc, error: 'subs.json 无该国家区划' })
    continue
  }
  let payload
  try {
    payload = await client.getJson(
      `${GBIF}/occurrence/search?taxonKey=212&country=${cc}` +
        `&facet=stateProvince&facetLimit=1000&limit=0&occurrenceStatus=PRESENT`,
      { cacheFile: `${cc}.json` },
    )
  } catch (e) {
    rows.push({ cc, error: e.message })
    continue
  }
  const counts = payload.facets?.[0]?.counts || []
  let mapped = 0
  let total = 0
  const codes = new Set()
  const unmatched = []
  for (const { name, count } of counts) {
    total += count
    const code = matchSubdivision(index, cc, name)
    if (code) {
      codes.add(code)
      mapped += count
    } else unmatched.push([name, count])
  }
  rows.push({
    cc,
    divisions: Object.keys(subs[cc]).length,
    avesRecords: payload.count,
    facetNames: counts.length,
    withProvince: total,
    coverage: total ? mapped / total : 0,
    mappedCodes: codes.size,
    unmatched: unmatched.sort((a, b) => b[1] - a[1]).slice(0, 8),
  })
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`\n省级层覆盖率干跑（阈值 ${MIN}%）· 口径：GBIF Aves × facet=stateProvince\n`)
console.log(`${pad('国', 4)}${pad('区划数', 8)}${pad('Aves 记录', 14)}${pad('有省字段', 14)}${pad('可映射', 9)}${pad('码', 5)}判定`)
let pass = 0
for (const r of rows) {
  if (r.error) {
    console.log(`${pad(r.cc, 4)}${pad('-', 8)}${pad('-', 14)}${pad('-', 14)}${pad('-', 9)}${pad('-', 5)}✗ ${r.error}`)
    continue
  }
  const pct = (r.coverage * 100).toFixed(1)
  const ok = r.coverage * 100 >= MIN
  if (ok) pass++
  console.log(
    `${pad(r.cc, 4)}${pad(r.divisions, 8)}${pad(r.avesRecords.toLocaleString(), 14)}` +
      `${pad(r.withProvince.toLocaleString(), 14)}${pad(pct + '%', 9)}${pad(r.mappedCodes, 5)}${ok ? '✅' : '✗ 低于门槛'}`,
  )
  if (!ok && r.unmatched.length) {
    console.log(`      未映射 Top：${r.unmatched.map(([n, c]) => `${n} (${c.toLocaleString()})`).join(' · ')}`)
  }
}
console.log(`\n通过 ${pass}/${rows.filter((r) => !r.error).length} 国（阈值 ${MIN}%）`)

if (args.json) {
  const out = path.resolve(ROOT, args.json)
  await fs.writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), min: MIN, rows }, null, 1))
  console.log(`报告 → ${path.relative(ROOT, out)}`)
}
