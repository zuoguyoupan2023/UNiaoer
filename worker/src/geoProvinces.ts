/**
 * 076 · 省级归属地派生（**只做聚合，不存 IP**）
 *
 * Cloudflare 在 `request.cf` 里已经给出粗粒度归属地：
 *   `country`（ISO 3166-1 alpha-2：CN / US / HK…）
 *   `regionCode`（**不带国家前缀**的区划码：中国给 BJ/GD，美国给 CA，日本给 13）
 *
 * 坑：中国的两字母码**不是** ISO 3166-2（ISO 是 CN-11/CN-44），必须查表；
 * 港澳台按铁律 6 归并进中国省级（CN-91/92/71），**不作为独立国家**出现。
 *
 * 隐私：本文件只把 `request.cf` 的字段映射成省码字符串，原始 IP 既不读也不存。
 * 是否落库由调用方按用户同意（`g: 1`）决定。
 */

/** 中国省级：CF 两字母码 → ISO 3166-2（34 个省级行政区全覆盖） */
export const CN_REGION_TO_ISO: Record<string, string> = {
  BJ: 'CN-11', // 北京
  TJ: 'CN-12', // 天津
  HE: 'CN-13', // 河北
  SX: 'CN-14', // 山西
  NM: 'CN-15', // 内蒙古
  LN: 'CN-21', // 辽宁
  JL: 'CN-22', // 吉林
  HL: 'CN-23', // 黑龙江
  SH: 'CN-31', // 上海
  JS: 'CN-32', // 江苏
  ZJ: 'CN-33', // 浙江
  AH: 'CN-34', // 安徽
  FJ: 'CN-35', // 福建
  JX: 'CN-36', // 江西
  SD: 'CN-37', // 山东
  HA: 'CN-41', // 河南
  HB: 'CN-42', // 湖北
  HN: 'CN-43', // 湖南
  GD: 'CN-44', // 广东
  GX: 'CN-45', // 广西
  HI: 'CN-46', // 海南
  CQ: 'CN-50', // 重庆
  SC: 'CN-51', // 四川
  GZ: 'CN-52', // 贵州
  YN: 'CN-53', // 云南
  XZ: 'CN-54', // 西藏
  SN: 'CN-61', // 陕西
  GS: 'CN-62', // 甘肃
  QH: 'CN-63', // 青海
  NX: 'CN-64', // 宁夏
  XJ: 'CN-65', // 新疆
  TW: 'CN-71', // 台湾（中国台湾）
  HK: 'CN-91', // 香港（中国香港）
  MO: 'CN-92', // 澳门（中国澳门）
}

/** 港澳台：CF 会当成独立 country 返回，统计层必须归并进中国省级（铁律 6） */
const CN_SAR_TO_ISO: Record<string, string> = { HK: 'CN-91', MO: 'CN-92', TW: 'CN-71' }

/** 省码形态：`CN`（国家级兜底）或 `CN-32` / `US-CA` / `JP-13` */
const PROVINCE_RE = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/

/**
 * 从请求上下文派生「做题者归属地」。
 *
 * @returns 省码 / 国家码；**取不到就返回 null**（绝不猜测）。
 *   中国以外的国家优先 `COUNTRY-regionCode`（多数国家即为 ISO 3166-2），
 *   区划码缺失或不合法时退回国家码（展示层标「省级未细分」）。
 */
export function clientProvince(cf: unknown): string | null {
  if (!cf || typeof cf !== 'object') return null
  const src = cf as Record<string, unknown>
  const country = String(src.country ?? '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return null
  const sar = CN_SAR_TO_ISO[country]
  if (sar) return sar
  const regionCode = String(src.regionCode ?? '').toUpperCase()
  if (country === 'CN') {
    // 映射不到（如直辖市返回异常值）→ 退回国家码，不猜省
    return CN_REGION_TO_ISO[regionCode] ?? 'CN'
  }
  if (/^[A-Z0-9]{1,3}$/.test(regionCode)) {
    const code = `${country}-${regionCode}`
    return PROVINCE_RE.test(code) ? code : country
  }
  return country
}
