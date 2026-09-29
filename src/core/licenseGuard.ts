import type { LicensePolicy } from '@/types'

/**
 * 许可证判断与署名工具。
 *
 * 兼容两种来源格式：
 * - Xeno-canto v3：完整 URL，如 https://creativecommons.org/licenses/by-sa/4.0/
 * - iNaturalist：短码，如 cc-by、cc-by-sa、cc0
 *
 * 见 000 文档第 11.5 节：XC v3 的 lic 字段是 URL 而非短码，按短码匹配会误杀 BY/BY-SA。
 */

/** 判断字符串是否包含某个以分隔符界定的许可段（by / sa / nc / nd / zero ...） */
function hasSegment(lic: string, seg: string): boolean {
  return new RegExp('(^|[/\\s-])' + seg + '([/\\s-]|$)').test(lic)
}

/** 是否为"开放许可"：CC0 / CC-BY / CC-BY-SA（排除一切 NC 与 ND） */
export function isOpenLicense(lic?: string | null): boolean {
  if (!lic) return false
  const l = String(lic).toLowerCase()
  if (hasSegment(l, 'nc') || hasSegment(l, 'nd')) return false
  if (l.includes('publicdomain') || hasSegment(l, 'zero') || l.includes('cc0')) return true
  if (hasSegment(l, 'by')) return true
  return false
}

/** 是否为"非商业"许可（含 NC） */
export function isNonCommercial(lic?: string | null): boolean {
  return !!lic && hasSegment(String(lic).toLowerCase(), 'nc')
}

/** 是否允许转码/修改（ND 不允许） */
export function canTranscode(lic?: string | null): boolean {
  if (!lic) return false
  return !hasSegment(String(lic).toLowerCase(), 'nd')
}

/**
 * 在某许可策略下是否放行该素材。
 * - strict：仅开放许可
 * - relaxed：放行全部（项目非商业，允许 NC；但转码仍需另查 canTranscode）
 */
export function licenseAllowed(lic: string | null | undefined, policy: LicensePolicy): boolean {
  if (!lic) return false
  return policy === 'relaxed' ? true : isOpenLicense(lic)
}

export interface AttributionInput {
  author?: string
  source?: string
  license?: string
  sourceUrl?: string
}

/** 生成一行署名文案（CC 要求必须展示作者 / 许可证 / 来源） */
export function formatAttribution(a: AttributionInput): string {
  const parts: string[] = []
  if (a.source) parts.push(a.source)
  parts.push(a.author?.trim() ? a.author.trim() : 'Unknown author')
  if (a.license) parts.push(a.license)
  return parts.join(' · ')
}
