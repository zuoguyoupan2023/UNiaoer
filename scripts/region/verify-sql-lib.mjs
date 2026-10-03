/**
 * 022 §1.7 两条 SQL（季节 month `0008810` / 热点网格 `0008811`）的纯函数对照逻辑，可单测。
 * 仅报告差异，不改构建路径。
 */
import { normBinomial } from './verify-provinces-lib.mjs'

/** SQL `scientificname, "month", n` → { bySpecies:{id:{month:n}}, unmatchedNames, mappedRows, totalRows } */
export function aggregateSqlMonths(rows, speciesMap) {
  const bySpecies = {}
  const unmatchedNames = new Map()
  let mappedRows = 0
  let totalRows = 0
  for (const r of rows || []) {
    const n = Number(r?.n) || 0
    const m = Number(r?.month)
    if (n <= 0 || !(m >= 1 && m <= 12)) continue
    totalRows++
    const name = String(r?.scientificname || '')
    const id = speciesMap.get(normBinomial(name))
    if (!id) {
      unmatchedNames.set(name, (unmatchedNames.get(name) || 0) + n)
      continue
    }
    const bs = (bySpecies[id] ??= {})
    bs[m] = (bs[m] || 0) + n
    mappedRows++
  }
  return { bySpecies, unmatchedNames, mappedRows, totalRows }
}

/** existing = seasonality.bySpecies（months 为 12 长度计数数组）；sql = aggregateSqlMonths().bySpecies */
export function compareSeasonality(existing, sql) {
  const ids = new Set([...Object.keys(existing || {}), ...Object.keys(sql || {})])
  const stats = {
    species: { existing: Object.keys(existing || {}).length, sql: Object.keys(sql || {}).length, both: 0 },
    months: { existing: 0, sql: 0, both: 0, onlyExisting: 0, onlySql: 0 },
    bothMonthsMatched: 0,
    bothMonthsTotal: 0,
    onlyExistingSamples: [],
    onlySqlSamples: [],
  }
  for (const id of ids) {
    const e = existing?.[id]
    const s = sql?.[id]
    const em = new Set((e?.months || []).map((v, i) => (v > 0 ? i + 1 : 0)).filter(Boolean))
    const sm = new Set(Object.keys(s || {}).map(Number))
    if (e && s) {
      stats.species.both++
      stats.bothMonthsTotal += sm.size
      for (const m of sm) if (em.has(m)) stats.bothMonthsMatched++
    }
    for (const m of em) {
      stats.months.existing++
      if (sm.has(m)) stats.months.both++
      else {
        stats.months.onlyExisting++
        if (stats.onlyExistingSamples.length < 15) stats.onlyExistingSamples.push(`${id} M${m}`)
      }
    }
    for (const m of sm) {
      stats.months.sql++
      if (!em.has(m)) {
        stats.months.onlySql++
        if (stats.onlySqlSamples.length < 15) stats.onlySqlSamples.push(`${id} M${m}`)
      }
    }
  }
  return stats
}

/** SQL 网格行 {countrycode,latb,lngb,records,species,observers} → 达阈值的热点（cell 中心坐标） */
export function sqlCellsToHotspots(rows, { grid = 0.1, minRecords = 5, minSpecies = 3, minObservers = 3 } = {}) {
  const out = []
  for (const r of rows || []) {
    const records = Number(r?.records) || 0
    const species = Number(r?.species) || 0
    const observers = Number(r?.observers) || 0
    const latb = Number(r?.latb)
    const lngb = Number(r?.lngb)
    const country = String(r?.countrycode || '').toUpperCase()
    if (!country || !Number.isFinite(latb) || !Number.isFinite(lngb)) continue
    if (records < minRecords || species < minSpecies || observers < minObservers) continue
    out.push({
      id: `${country}-g${grid}-${latb}_${lngb}`.replace(/[^a-zA-Z0-9._-]+/g, '-'),
      country,
      lat: Math.round((latb + 0.5) * grid * 10000) / 10000,
      lng: Math.round((lngb + 0.5) * grid * 10000) / 10000,
      recordCount: records,
      speciesCount: species,
      observerCount: observers,
    })
  }
  return out
}

/** 两个热点集合按 country 汇总 + 坐标近邻（同 grid）命中率 */
export function compareHotspotSets(existing, sql, { grid = 0.1 } = {}) {
  const byCountry = {}
  const keyOf = (h) => `${h.country}|${Math.floor(h.lat / grid)}|${Math.floor(h.lng / grid)}`
  const sqlKeys = new Set((sql || []).map(keyOf))
  const exKeys = new Set((existing || []).map(keyOf))
  for (const h of existing || []) {
    ;(byCountry[h.country] ??= { existing: 0, sql: 0, both: 0 }).existing++
  }
  for (const h of sql || []) {
    ;(byCountry[h.country] ??= { existing: 0, sql: 0, both: 0 }).sql++
  }
  let both = 0
  for (const k of exKeys) if (sqlKeys.has(k)) both++
  return {
    counts: { existing: existing?.length || 0, sql: sql?.length || 0, both, onlyExisting: exKeys.size - both, onlySql: sqlKeys.size - both },
    byCountry,
  }
}
