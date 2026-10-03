/**
 * 022 §2.6 eBird adapter（纯函数，不碰网络/文件系统，可单测）。
 * 021 M4 腿 A：eBird Hotspots 名录 + subnational1 区划。
 *
 * 端点与响应（见 docs/022 §2.2）：
 *  - `/ref/hotspot/{regionCode}?fmt=json` → [{ locId, locName, countryCode,
 *      subnational1Code, subnational2Code, lat, lng, latestObsDt,
 *      numSpeciesAllTime, numChecklistsAllTime }]
 *  - `/ref/region/list/subnational1/{CC}` → [{ code, name }]
 *
 * 规则：缺坐标/缺 id/缺国家丢弃（不臆造）；字段缺失留 null。
 * 署名：eBird 数据仅限非商业，展示必须署名且不得再分发原始数据集（docs/022 §2.5）。
 */

/** 距离（km，haversine），用于把网格观鸟点命名到最近的 eBird 热点。 */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = (d) => (Number(d) * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)

/** `/ref/hotspot/{regionCode}` 响应 → 观鸟点记录[]（无坐标/无 id/无国家丢弃）。 */
export function hotspotRecords(payload, { source = 'ebird', fetchedAt = null } = {}) {
  return (Array.isArray(payload) ? payload : [])
    .map((h) => {
      const id = h?.locId || h?.locid || null
      return {
        id,
        name: String(h?.locName || h?.name || '').trim() || null,
        lat: Number(h?.lat),
        lng: Number(h?.lng),
        country: String(h?.countryCode || '').toUpperCase() || null,
        subnational1: h?.subnational1Code || null,
        subnational2: h?.subnational2Code || null,
        latestObsDt: h?.latestObsDt || null,
        speciesCount: int(h?.numSpeciesAllTime),
        checklistsAllTime: int(h?.numChecklistsAllTime),
        source,
        sourceUrl: id ? `https://ebird.org/hotspot/${id}` : null,
        fetchedAt,
      }
    })
    .filter((h) => h.id && h.country && Number.isFinite(h.lat) && Number.isFinite(h.lng))
}

/** `/ref/region/list/subnational1/{CC}` 响应 → [{ code, name }]。 */
export function subnational1Regions(payload) {
  return (Array.isArray(payload) ? payload : [])
    .map((r) => ({ code: String(r?.code || '').trim(), name: String(r?.name || '').trim() }))
    .filter((r) => r.code && r.name)
}

/** 在 hotspots 中找距 (lat,lng) 最近且 ≤ maxKm 的；没找到返回 null（不臆造名字）。 */
export function nearestHotspot(lat, lng, hotspots, { maxKm = 10 } = {}) {
  let best = null
  let bestD = Infinity
  for (const h of hotspots || []) {
    if (!Number.isFinite(h?.lat) || !Number.isFinite(h?.lng)) continue
    const d = distanceKm(lat, lng, h.lat, h.lng)
    if (d <= maxKm && d < bestD) {
      best = h
      bestD = d
    }
  }
  return best ? { ...best, distanceKm: Math.round(bestD * 1000) / 1000 } : null
}
