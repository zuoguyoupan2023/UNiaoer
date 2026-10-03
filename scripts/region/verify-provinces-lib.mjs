/**
 * 022 §1.7 D-022-1/3：把 GBIF SQL 省级矩阵（0008688）与 public/data/region-provinces.json
 * 做**对照校验**（仅报告差异，不改现有构建路径）。纯函数，可单测。
 *
 * SQL 行为 { countrycode, stateprovince, scientificname, n }；key 为 COL XR，需按学名映射回 manifest。
 * 映射失败/省级名未识别 → 计数并丢弃（不臆造）。
 */
import { matchSubdivision } from './adapters/iso3166.mjs'

/** 学名归一化：去变音符/标点、小写、取前两词（亚种归并到种）。对齐 manifest nameSci。 */
export function normBinomial(sci) {
  return String(sci || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
}

/** manifest.species → Map<normalized nameSci, id>（后写不覆盖，保证确定性） */
export function buildSpeciesMap(species) {
  const map = new Map()
  for (const sp of species || []) {
    const k = normBinomial(sp.nameSci)
    if (k && !map.has(k)) map.set(k, sp.id)
  }
  return map
}

/**
 * SQL 行 → { bySpecies: {id:{CC:{code:count}}}, unmatchedNames, unmatchedProvinces, mappedRows, totalRows }。
 * 同 (species,country,code) 累加（亚种/同名变体归并）。
 */
export function aggregateSqlRows(rows, { index, speciesMap }) {
  const bySpecies = {}
  const unmatchedNames = new Map()
  const unmatchedProvinces = new Map()
  let mappedRows = 0
  let totalRows = 0
  for (const r of rows || []) {
    const n = Number(r?.n) || 0
    if (n <= 0) continue
    totalRows++
    const country = String(r?.countrycode || '').toUpperCase()
    const id = speciesMap.get(normBinomial(r?.scientificname))
    if (!id) {
      unmatchedNames.set(String(r?.scientificname || ''), (unmatchedNames.get(String(r?.scientificname || '')) || 0) + n)
      continue
    }
    const code = matchSubdivision(index, country, r?.stateprovince)
    if (!code) {
      const key = `${country}\t${r?.stateprovince || ''}`
      unmatchedProvinces.set(key, (unmatchedProvinces.get(key) || 0) + n)
      continue
    }
    const byCc = (bySpecies[id] ??= {})
    const byCode = (byCc[country] ??= {})
    byCode[code] = (byCode[code] || 0) + n
    mappedRows++
  }
  return { bySpecies, unmatchedNames, unmatchedProvinces, mappedRows, totalRows }
}

/**
 * 对照：existing / sql 均为 {id:{CC:{code:count}}}。
 * 返回物种/单元格/记录数三级统计 + 每国汇总 + 仅一方存在的样例。
 */
export function compareProvinces(existing, sql) {
  const ids = new Set([...Object.keys(existing || {}), ...Object.keys(sql || {})])
  const stats = {
    species: { existing: Object.keys(existing || {}).length, sql: Object.keys(sql || {}).length, both: 0 },
    cells: { existing: 0, sql: 0, both: 0, onlyExisting: 0, onlySql: 0 },
    records: { existing: 0, sql: 0, bothExisting: 0, bothSql: 0 },
    byCountry: {},
    onlyExistingSamples: [],
    onlySqlSamples: [],
  }
  const country = (cc) =>
    (stats.byCountry[cc] ??= { cellsExisting: 0, cellsSql: 0, cellsBoth: 0, recordsExisting: 0, recordsSql: 0 })

  for (const id of ids) {
    const e = existing?.[id] || {}
    const s = sql?.[id] || {}
    let touched = false
    const ccs = new Set([...Object.keys(e), ...Object.keys(s)])
    for (const cc of ccs) {
      const ec = e[cc] || {}
      const sc = s[cc] || {}
      const codes = new Set([...Object.keys(ec), ...Object.keys(sc)])
      for (const code of codes) {
        touched = true
        const ev = ec[code]
        const sv = sc[code]
        const c = country(cc)
        if (ev != null) {
          stats.cells.existing++
          stats.records.existing += ev
          c.cellsExisting++
          c.recordsExisting += ev
        }
        if (sv != null) {
          stats.cells.sql++
          stats.records.sql += sv
          c.cellsSql++
          c.recordsSql += sv
        }
        if (ev != null && sv != null) {
          stats.cells.both++
          stats.records.bothExisting += ev
          stats.records.bothSql += sv
          c.cellsBoth++
        } else if (ev != null) {
          stats.cells.onlyExisting++
          if (stats.onlyExistingSamples.length < 15) stats.onlyExistingSamples.push(`${id} ${cc}/${code} existing=${ev}`)
        } else {
          stats.cells.onlySql++
          if (stats.onlySqlSamples.length < 15) stats.onlySqlSamples.push(`${id} ${cc}/${code} sql=${sv}`)
        }
      }
    }
    if (touched && e && Object.keys(e).length && s && Object.keys(s).length) stats.species.both++
  }
  return stats
}
