/**
 * 021 M4 腿 B：把带坐标的观测按网格聚合为「统计意义上的观鸟点」（纯函数，不碰网络/文件，可单测）。
 *
 * 规则（021 §2.5）：
 * - 网格：floor(lat / size) × floor(lng / size)；中心取格内坐标均值（4 位小数）。
 * - 去重：同一 observer 同日同格算一条记录（无 observer 时按记录 key 计，均缺则逐条计）。
 * - 过滤圈养/逃逸/栽培：上游查询负责（adapter 只接收已过滤记录）。
 * - 阈值：`--min-records N --min-species M --min-observers K` 全部满足才成点。
 * - 不知情不编造：缺 observer / date 的字段如实计，不推断补齐。
 */
import { distanceKm } from './adapters/ebird.mjs'

/** 网格单元键（floor，负坐标同样成立）；toFixed 规避 39.9/0.1 = 398.99… 的浮点误差 */
export function cellKey(lat, lng, size) {
  const bucket = (v) => Math.floor(Number((v / size).toFixed(6)))
  return `${bucket(lat)}_${bucket(lng)}`
}

const round4 = (n) => Math.round(n * 10000) / 10000

/** 记录物种标识：优先 manifest id，回退学名 */
const speciesKey = (r) => r.speciesId || (r.sci ? `sci:${r.sci}` : null)

/** 去重键：observer + 当日 + 格；无 observer 用记录 key；都无则 null（逐条计） */
function dedupKey(r, day) {
  if (r.observer) return `o:${r.observer}|${day}`
  if (r.key) return `k:${r.key}`
  return null
}

/**
 * 聚合：records → hotspots（已应用阈值，recordCount 降序）。
 * @param {Array<{key?,speciesId?,sci?,lat,lng,country?,subnational1?,observer?,date?,source?}>} records
 * @param {{grid:number,minRecords?:number,minSpecies?:number,minObservers?:number,topN?:number,idPrefix?:string}} opts
 */
export function aggregateHotspots(records, opts) {
  const { grid } = opts
  if (!(grid > 0)) throw new Error('hotspots-lib: grid 必须为正数')
  const minRecords = Math.max(1, opts.minRecords ?? 1)
  const minSpecies = Math.max(1, opts.minSpecies ?? 1)
  const minObservers = Math.max(0, opts.minObservers ?? 0)
  const topN = Math.max(1, opts.topN ?? 5)

  /** cellKey → 聚合桶 */
  const cells = new Map()
  for (const r of records || []) {
    if (!Number.isFinite(r?.lat) || !Number.isFinite(r?.lng)) continue
    const sk = speciesKey(r)
    if (!sk) continue
    const ck = cellKey(r.lat, r.lng, grid)
    let c = cells.get(ck)
    if (!c) {
      c = {
        ck,
        n: 0,
        sumLat: 0,
        sumLng: 0,
        seen: new Set(),
        species: new Map(),
        observers: new Set(),
        country: new Map(),
        sub: new Map(),
        places: new Map(),
        sources: new Set(),
      }
      cells.set(ck, c)
    }
    c.n++
    c.sumLat += r.lat
    c.sumLng += r.lng
    const day = String(r.date || '').slice(0, 10)
    const dk = dedupKey(r, day)
    if (dk) {
      if (!c.seen.has(dk)) c.seen.add(dk)
    } else {
      c.seen.add(`u:${c.n}`)
    }
    c.species.set(sk, (c.species.get(sk) || 0) + 1)
    if (r.observer) c.observers.add(String(r.observer).trim())
    if (r.country) c.country.set(r.country, (c.country.get(r.country) || 0) + 1)
    if (r.subnational1) c.sub.set(r.subnational1, (c.sub.get(r.subnational1) || 0) + 1)
    if (r.place) c.places.set(r.place, (c.places.get(r.place) || 0) + 1)
    if (r.source) c.sources.add(r.source)
  }

  /** Map<string,number> → 取最大（并列按名字升序，保证确定性） */
  const mode = (m) => {
    let best = null
    let bestN = -1
    for (const [k, n] of m) {
      if (n > bestN || (n === bestN && best !== null && k < best)) {
        best = k
        bestN = n
      }
    }
    return best
  }

  const out = []
  for (const c of cells.values()) {
    const recordCount = c.seen.size
    const speciesCount = c.species.size
    const observerCount = c.observers.size
    if (recordCount < minRecords || speciesCount < minSpecies || observerCount < minObservers) continue
    const country = mode(c.country)
    if (!country) continue // 无国家归属的点不展示（021 §2.5 薄数据宁缺）
    const subnational1 = mode(c.sub) || undefined
    const topSpecies = [...c.species.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN)
      .map(([sk, count]) => {
        const sci = sk.startsWith('sci:') ? sk.slice(4) : undefined
        return sk.startsWith('sci:') ? { sci, count } : { id: sk, count }
      })
    const name = mode(c.places) || undefined
    out.push({
      id: `${opts.idPrefix || ''}${country}-g${grid}-${c.ck}`.replace(/[^a-zA-Z0-9._-]+/g, '-'),
      name,
      lat: round4(c.sumLat / c.n),
      lng: round4(c.sumLng / c.n),
      country,
      subnational1,
      speciesCount,
      recordCount,
      observerCount,
      topSpecies,
      sources: [...c.sources].sort(),
    })
  }

  out.sort(
    (a, b) =>
      b.recordCount - a.recordCount ||
      b.speciesCount - a.speciesCount ||
      a.country.localeCompare(b.country) ||
      a.id.localeCompare(b.id),
  )
  return out
}

/**
 * 021 M4 腿 A：用 eBird 热点名录给**无名**网格点就近命名（020 §3.3）。
 * 仅补 name/ebirdId/ebirdUrl 并把 'ebird' 计入 sources；已有名字的点不动（不覆盖 XC loc）。
 * 找不到 ≤maxKm 的最近热点则原样返回（不臆造名字）。
 * @param {Array} hotspots aggregateHotspots 的输出
 * @param {Array} ebirdHotspots adapters/ebird.hotspotRecords 的输出
 */
/** 空间分桶索引：bucketDeg 度一桶 → Map<bucketKey, hotspots[]>；配合 indexedNearest 用 */
export function buildHotspotIndex(hotspots, { bucketDeg = 0.05 } = {}) {
  const map = new Map()
  for (const h of hotspots || []) {
    if (!Number.isFinite(h?.lat) || !Number.isFinite(h?.lng)) continue
    const k = `${Math.floor(h.lat / bucketDeg)}_${Math.floor(h.lng / bucketDeg)}`
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(h)
  }
  return { map, bucketDeg }
}

/** 在分桶索引里找 ≤maxKm 的最近点（只扫邻近桶，避免 O(n) 全量） */
export function indexedNearest(index, lat, lng, maxKm) {
  const { map, bucketDeg } = index
  const dLat = Math.ceil(maxKm / 111 / bucketDeg) + 1
  const cos = Math.max(0.1, Math.cos((Number(lat) * Math.PI) / 180))
  const dLng = Math.ceil(maxKm / (111 * cos) / bucketDeg) + 1
  const la0 = Math.floor(lat / bucketDeg)
  const ln0 = Math.floor(lng / bucketDeg)
  let best = null
  let bestD = Infinity
  for (let i = la0 - dLat; i <= la0 + dLat; i++) {
    for (let j = ln0 - dLng; j <= ln0 + dLng; j++) {
      const bucket = map.get(`${i}_${j}`)
      if (!bucket) continue
      for (const h of bucket) {
        const d = distanceKm(lat, lng, h.lat, h.lng)
        if (d <= maxKm && d < bestD) {
          best = h
          bestD = d
        }
      }
    }
  }
  return best ? { ...best, distanceKm: Math.round(bestD * 1000) / 1000 } : null
}

export function applyEbirdNames(hotspots, ebirdHotspots, { maxKm = 3 } = {}) {
  // 按国家预分组 + 分桶索引：只与同国邻近热点比较（全量几十万点时 O(n) 两两会卡死）
  const byCountry = new Map()
  for (const e of ebirdHotspots || []) {
    if (!e.country) continue
    if (!byCountry.has(e.country)) byCountry.set(e.country, [])
    byCountry.get(e.country).push(e)
  }
  const idxCache = new Map()
  const idxFor = (cc) => {
    if (!idxCache.has(cc)) {
      idxCache.set(cc, buildHotspotIndex(byCountry.get(cc) || [], { bucketDeg: Math.max(0.01, maxKm / 111) }))
    }
    return idxCache.get(cc)
  }
  return (hotspots || []).map((h) => {
    if (h.name) return h
    if (!byCountry.has(h.country)) return h
    const near = indexedNearest(idxFor(h.country), h.lat, h.lng, maxKm)
    if (!near) return h
    return {
      ...h,
      name: near.name,
      subnational1: h.subnational1 ?? near.subnational1 ?? undefined,
      ebirdId: near.id,
      ebirdUrl: near.sourceUrl,
      sources: [...new Set([...(h.sources || []), 'ebird'])].sort(),
    }
  })
}
