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

/**
 * 从 iNat 的 `attribution` 原文里提取**纯作者名**（2026-11-02）。
 *
 * ## 为什么需要它
 * 构建期把 iNat 的 attribution 整串存进了 `author` 字段：
 * `(c) Paul Werner Süss, some rights reserved (CC BY-NC), uploaded by Paul Werner Süss`。
 * 海报署名行宽度有限，原样画必然被截断——用户看到「作者 许可证 后面还有 uploaded by…
 * 结尾被隐藏」。许可证由旁边的独立字段展示，故这里只留**创作者**。
 *
 * ## 为什么不用「枚举语种」
 * iNat 按**访问者语言**返回本地化的 attribution。实测 15,783 条去重后混有十几种语言：
 * 英语 `some rights reserved`、西语 `algunos derechos reservados`、葡语 `alguns direitos
 * reservados`、芬兰语 `osa oikeuksista pidätetään`、韩语 `일부 권리 보유`、阿拉伯语
 * `بعض الحقوق محفوظة`、中文 `保留部分权利`、土耳其语 `bazı hakları saklıdır`…。
 * 早期版本靠正则枚举语言，全量审计后仍漏 45 条（葡语/中文那批），不可维护。
 *
 * ## 结构化规则（不依赖任何语种）
 * iNat 的 attribution 结构恒定：`(c) <作者>[, <作者2>…], <保留权声明> (CC <许可>)`。
 * 于是：
 *   1. 在 `(CC …)` 处**截断**——许可与其后的 `uploaded by …` 一并丢弃；
 *   2. 按逗号（含全角 `，`、阿拉伯 `،`）分段，**丢掉最后一段**（= 保留权声明）；
 *   3. 保住其余段——多人合著（`김대환, 이선미`）不会被切掉；
 *   4. 剥 `(c)` / `©` / `copyright` 前缀。
 * 全量 15,783 条实测残留 0、多人合著完好。
 *
 * ## 合规性
 * CC BY 要求的署名三要素是**作者 + 许可证 + 来源**，三者都完整保留：
 * 作者（本函数结果）、许可证（独立字段）、来源（页脚「数据来源」）。被剥掉的
 * `(c)` 与「保留部分权利」是 **iNat 的界面文案**，不是 CC 协议的法定内容；
 * 上传者更不是 CC 的署名对象（CC 要求的是创作者）。且**只影响海报渲染**，
 * manifest 原文、`sourceUrl`、`licenseUrl` 一字未动——App 内署名仍完整可点回源站。
 *
 * ## CC0 / 无作者
 * CC0 法律上不要求署名 → 返回空串，海报只画「许可证」与「来源」（合规且更短）。
 */
export function cleanAuthor(raw?: string | null): string {
  if (!raw) return ''
  let s = String(raw)
    // iNat 会返回 HTML 实体（实测 `Albert Lastukhin &amp; Yuri Glushchenko`）
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .trim()
  if (!s) return ''

  // 1) 在许可括号处截断。除了 CC，iNat 还会返回 GFDL 等非 CC 许可（实测 2 条），
  //    以及中文把许可写在括号**外**的形态（`保留部份權利CC BY-NC`）——后者单独处理。
  //    其后的一切（含 uploaded by 上传者）都属于许可/平台措辞，不在署名范围。
  const cc = s.search(/[（(]\s*(?:CC|cc|GFDL|FDL)\b/)
  // 是否命中 iNat 的完整 attribution 结构。**只有**这种形态才做「丢末段」处理：
  // 裸名字（如 `김대환, 이선미` 这种多人合著、无许可段）必须原样保留。
  const fullAttribution = cc >= 0
  if (cc > 0) s = s.slice(0, cc)
  else if (cc === 0) s = ''

  // 1b) 中文形态：`reserved` 类的权利声明直接接许可，没有括号
  //     （`(c) kritadi，保留部份權利CC BY-NC`）。
  s = s.replace(/[，,]?\s*(?:保留部份權利|保留部分权利)\s*CC[-\s]*[A-Za-z-]*\s*$/i, '').trim()
  // 1c) 公有领域声明（俄语等）：`нет известных ограничений авторского права (общественное достояние)`
  s = s.replace(/[，,]?\s*нет известных ограничений[^，,]*$/i, '').trim()

  // 2) 去掉尾部分隔符
  s = s.replace(/[,;，،\s]+$/, '').trim()

  // 3) 完整 attribution 形态下，按逗号分段后丢掉**最后一段**（= 本地化的「保留部分权利」声明）。
  //    只丢一段：多人合著的作者仍用逗号分隔，全部保留。
  if (fullAttribution) {
    const segs = s
      .split(/[,;，،]/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (segs.length >= 2) segs.pop()
    s = segs.join(', ')
  }

  // 4) 剥版权前缀
  s = s
    .replace(/^\(c\)\s*/i, '')
    .replace(/^©\s*/, '')
    .replace(/^copyright\s+/i, '')
    .trim()

  // 5) CC0 / 公有领域 / 未知作者：法律上无需署名 → 空串，由调用方只画许可证
  if (/^(?:no\s+rights\s+reserved|public\s+domain|unknown(?:\s+author)?|无版权|未知作者)/i.test(s)) {
    return ''
  }
  // 其他语言的 CC0 弃权声明（同为「无作者」语义，宁可留空也不画错）
  if (/^(?:no hay derechos|sem direitos|ingen rettigheder|oikeuksia ei)/i.test(s)) return ''

  return s.replace(/[,;，]\s*$/, '').trim()
}
