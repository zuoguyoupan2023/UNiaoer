/**
 * 许可判断（与 src/core/licenseGuard.ts 逻辑保持一致）。
 * 兼容 Xeno-canto v3 的完整 URL 与 iNaturalist 的短码。
 */

function hasSegment(lic, seg) {
  return new RegExp('(^|[/\\s-])' + seg + '([/\\s-]|$)').test(lic)
}

/** 开放许可：CC0 / CC-BY / CC-BY-SA（排除一切 NC 与 ND） */
export function isOpenLicense(lic) {
  if (!lic) return false
  const l = String(lic).toLowerCase()
  if (hasSegment(l, 'nc') || hasSegment(l, 'nd')) return false
  if (l.includes('publicdomain') || hasSegment(l, 'zero') || l.includes('cc0')) return true
  if (hasSegment(l, 'by')) return true
  return false
}

/** 是否允许转码/修改（ND 不允许） */
export function canTranscode(lic) {
  if (!lic) return false
  return !hasSegment(String(lic).toLowerCase(), 'nd')
}

/**
 * 在某策略下是否放行：
 * - strict：仅开放许可
 * - relaxed：放行全部（含 NC；ND 仍不能转码，另查 canTranscode）
 */
export function licenseAllowed(lic, policy) {
  if (!lic) return false
  return policy === 'relaxed' ? true : isOpenLicense(lic)
}

/** 生成 iNaturalist 的 photo_license / sound_license 查询值 */
export function inatLicenseQuery(policy) {
  return policy === 'relaxed'
    ? 'cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa,cc-by-nd,cc-by-nc-nd'
    : 'cc0,cc-by,cc-by-sa'
}

/** 规范化许可证展示名（URL → 短码风格） */
export function normalizeLicense(lic) {
  if (!lic) return 'UNKNOWN'
  const l = String(lic).toLowerCase()
  if (l.includes('publicdomain') || hasSegment(l, 'zero') || l.includes('cc0')) return 'CC0'
  const parts = ['by', 'nc', 'sa', 'nd'].filter((s) => hasSegment(l, s))
  if (parts.length) return 'CC-' + parts.join('-').toUpperCase()
  return String(lic).toUpperCase()
}
