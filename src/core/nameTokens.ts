/**
 * 099 第一批：名字 → (颜色，部位) token 解析器。
 *
 * 语义（docs/099 §2.4/§2.6）：**只描述「名字」这个事实**——名字说它红尾，它就有 (红,尾)
 * token，名字与实物不符不在这里修（走 data/name-token-overrides.json，§3.8）。
 *
 * **中英并集**（§2.6）：同一只鸟两种语言各说各的部位（红嘴鸥 = Black-headed Gull：
 * 中文 (红,嘴) + 英文 (黑,头)），全部保留；canonical 色值/部位值是两边共同的落点
 * ——这是跨语言组身份与「召回互补」的桥（§3.0）。
 *
 * 解析口径：
 * - zh：单字表面词扫描全名（「大/小/中/普通」前缀会把色字挤到第二字之后，如大白鹭；
 *   多色名的第二个色在中段，如红胁蓝尾鸲），色字后紧跟部位字 → (色,部位)；
 *   色字后接另一色字 → 都不产出（复合花纹属第二批）；其余 → (色,全身)。
 *   二字色词（桂红/烟色/橄榄）先于单字匹配。
 * - en：按空格分词、连字符取相邻段（Red-billed → (红,嘴)）；独立色词 → (色,全身)
 *   （Red Knot、Slate-colored）；融合词走人工表（Redstart/Blackbird…，实测命中 ≥1 才收录）；
 *   含 'and' 的复合（Black-and-white）跳过（花纹批）。
 *
 * 词表全部来自 2026-11-03 对 catalog.json 11,026 种的实测（docs/099 §2.2/§2.6.2）：
 * 词级对应 emerald↔翠、plumbeous↔铅、sooty↔烟色、buff↔黄（官方译名）、ashy↔灰…
 * 银铜铁玉属金属光泽，留第三批（用户 2026-11-03 定批次），不进本表。
 *
 * 本文件含 CJK 字面量：词表是纯数据、不渲染到 UI（i18n-scan 白名单已登记理由）。
 */

/** canonical 颜色（11 色，docs/099 §2.6.2）——zh/en 表面词的共同落点 */
export const CANONICAL_COLORS = ['红', '白', '黑', '蓝', '绿', '黄', '紫', '灰', '褐', '橙', '粉'] as const
export type CanonicalColor = (typeof CANONICAL_COLORS)[number]

/** canonical 部位（25）——含 zh 特有词的归并（眶→眼、翼→翅、腿→脚） */
export const CANONICAL_PARTS = [
  '头', '顶', '冠', '脸', '颊', '眼', '喉', '颈', '背', '翅', '肩', '腰',
  '胸', '腹', '胁', '尾', '脚', '嘴', '额', '眉', '耳', '颏', '枕', '翕', '臀',
] as const

/** 色词无部位时的部位值（「红毛?全身红」——紫啸鸫/Red Knot 这类） */
export const PART_WHOLE = '全身'

/** token 来源（§3.0）：override = 人工修正；visual = 第三批视觉归类（用户逐种看图归组） */
export type NameTokenSource = 'zh-name' | 'en-name' | 'override' | 'visual'
export interface NameToken {
  color: CanonicalColor
  part: string
  src: NameTokenSource
}

const tokenKey = (color: string, part: string): string => `${color}|${part}`

// ---------------------------------------------------------------------------
// 中文词表
// ---------------------------------------------------------------------------

/** zh 单字色词 → canonical（青→蓝、金→黄、乌/玄/暗→黑、翠→绿…，§2.6.2） */
const ZH_COLOR_CHAR: Record<string, CanonicalColor> = {
  红: '红', 赤: '红', 朱: '红', 丹: '红', 猩: '红',
  白: '白',
  黑: '黑', 玄: '黑', 乌: '黑', 暗: '黑',
  蓝: '蓝', 青: '蓝',
  绿: '绿', 翠: '绿',
  黄: '黄', 金: '黄',
  紫: '紫',
  灰: '灰',
  棕: '褐', 褐: '褐', 栗: '褐', 茶: '褐', 赭: '褐',
  橙: '橙',
  粉: '粉',
}

/** zh 二字色词（先于单字匹配；烟色用二字避免「烟囱雨燕」假阳性） */
const ZH_COLOR_BIGRAM: Record<string, CanonicalColor> = {
  桂红: '红', 烟色: '黑', 橄榄: '绿',
}

/** zh 部位字 → canonical 部位 */
const ZH_PART_CHAR: Record<string, string> = {
  头: '头', 顶: '顶', 冠: '冠', 脸: '脸', 颊: '颊',
  眼: '眼', 眶: '眼',
  喉: '喉', 颈: '颈', 背: '背',
  翅: '翅', 翼: '翅', 肩: '肩',
  腰: '腰', 胸: '胸', 腹: '腹', 胁: '胁', 尾: '尾',
  脚: '脚', 腿: '脚', 嘴: '嘴', 喙: '嘴',
  额: '额', 眉: '眉', 耳: '耳', 颏: '颏', 枕: '枕', 翕: '翕', 臀: '臀',
}

// ---------------------------------------------------------------------------
// 英文词表
// ---------------------------------------------------------------------------

/** en 色词 → canonical（§2.6.2 词级对应表；mauve/fuscous/ochraceous 命中 ≤1 舍弃） */
const EN_COLOR_WORD: Record<string, CanonicalColor> = {
  red: '红', crimson: '红', scarlet: '红',
  white: '白',
  black: '黑', sooty: '黑', dark: '黑',
  blue: '蓝', azure: '蓝',
  green: '绿', olive: '绿', emerald: '绿',
  yellow: '黄', golden: '黄', buff: '黄',
  purple: '紫', violet: '紫',
  grey: '灰', gray: '灰', slate: '灰', slaty: '灰', ashy: '灰', cinereous: '灰', plumbeous: '灰', dusky: '灰',
  brown: '褐', rufous: '褐', chestnut: '褐', cinnamon: '褐', tawny: '褐', ochre: '褐',
  orange: '橙', flame: '橙',
  pink: '粉', rose: '粉', rosy: '粉', roseate: '粉',
}

/** en 部位复合后缀 → canonical 部位（collared 归颈——花纹批再细分） */
const EN_PART_SUFFIX: Record<string, string> = {
  billed: '嘴', crowned: '顶', capped: '顶', throated: '喉', breasted: '胸',
  rumped: '腰', backed: '背', winged: '翅', tailed: '尾', bellied: '腹',
  headed: '头', fronted: '额', naped: '枕', eyed: '眼', vented: '臀',
  legged: '脚', cheeked: '颊', mantled: '翕', flanked: '胁', shouldered: '肩',
  eared: '耳', faced: '脸', necked: '颈', collared: '颈',
}

/** en 融合词（色+部位粘连，无法靠切分得到；实测命中 ≥1 才收录，§2.6.2） */
const EN_FUSED: Record<string, [CanonicalColor, string]> = {
  blackbird: ['黑', PART_WHOLE], redstart: ['红', '尾'], blackcap: ['黑', '顶'],
  bluebill: ['蓝', '嘴'], redshank: ['红', '脚'], whitethroat: ['白', '喉'],
  firecrest: ['红', '顶'], redhead: ['红', '头'], redpoll: ['红', '顶'],
  redwing: ['红', '翅'], bluethroat: ['蓝', '喉'], firethroat: ['红', '喉'],
  goldcrest: ['黄', '顶'],
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/** 中文名 → tokens（全名扫描；规则见文件头注释） */
export function parseZhTokens(name: string): NameToken[] {
  const out: NameToken[] = []
  const s = String(name || '')
  /** 上一个字是「色接色」里被跳过的色字 → 紧随的色字也不产出全身（黑白/蓝灰是复合花纹） */
  let prevSkippedColor = false
  for (let i = 0; i < s.length; ) {
    const ch = s[i]!
    const bigram = ZH_COLOR_BIGRAM[ch + (s[i + 1] ?? '')]
    if (bigram) {
      const part = ZH_PART_CHAR[s[i + 2] ?? '']
      out.push(part ? { color: bigram, part, src: 'zh-name' } : { color: bigram, part: PART_WHOLE, src: 'zh-name' })
      prevSkippedColor = false
      i += 2
      continue
    }
    const color = ZH_COLOR_CHAR[ch]
    if (!color) {
      prevSkippedColor = false
      i++
      continue
    }
    const next = s[i + 1] ?? ''
    const part = ZH_PART_CHAR[next]
    if (part) {
      out.push({ color, part, src: 'zh-name' })
      prevSkippedColor = false
      i += 2
    } else if (ZH_COLOR_CHAR[next]) {
      // 色接色（黑白/蓝灰/暗绿…）：复合花纹归第二批，两边都不产出
      prevSkippedColor = true
      i++
    } else {
      if (!prevSkippedColor) out.push({ color, part: PART_WHOLE, src: 'zh-name' })
      prevSkippedColor = false
      i++
    }
  }
  return dedupe(out)
}

/** 英文名 → tokens（空格分词 + 连字符相邻段 + 融合词；规则见文件头注释） */
export function parseEnTokens(name: string): NameToken[] {
  const out: NameToken[] = []
  const lower = String(name || '').toLowerCase()
  if (!lower) return out
  for (const tok of lower.split(/\s+/)) {
    const fused = EN_FUSED[tok]
    if (fused) {
      out.push({ color: fused[0], part: fused[1], src: 'en-name' })
      continue
    }
    const segs = tok.split('-')
    if (segs.includes('and')) continue // Black-and-white → 花纹批
    let whole: CanonicalColor | null = null
    for (let i = 0; i < segs.length; i++) {
      const color = EN_COLOR_WORD[segs[i]!]
      if (!color) continue
      const next = segs[i + 1]
      const part = next ? EN_PART_SUFFIX[next] : undefined
      if (part) out.push({ color, part, src: 'en-name' })
      else if (i === segs.length - 1 || next === 'colored') whole = color
      // 色后接非部位非结尾（如非常规复合）→ 不产出，避免误全身
    }
    if (whole) out.push({ color: whole, part: PART_WHOLE, src: 'en-name' })
  }
  return dedupe(out)
}

/** 中英并集（§2.6：各说各的部位全部保留；同 key 时 zh 优先） */
export function parseNameTokens(nameZh?: string, nameEn?: string): NameToken[] {
  return dedupe([...parseZhTokens(nameZh ?? ''), ...parseEnTokens(nameEn ?? '')])
}

function dedupe(list: NameToken[]): NameToken[] {
  const seen = new Set<string>()
  const out: NameToken[] = []
  for (const t of list) {
    const k = tokenKey(t.color, t.part)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

// ---------------------------------------------------------------------------
// overrides（099 §3.8：优先级 overrides > 解析器）
// ---------------------------------------------------------------------------

export interface NameTokenOverrideEntry {
  /** 增补 token，[canonical色, canonical部位]（部位可为 PART_WHOLE） */
  add?: [string, string][]
  /** 删除解析产出的 token */
  remove?: [string, string][]
  /** 必须：不一致类型（解析误切 / 名字与图像不符 / 名字与注释不符）+ 出处 */
  reason: string
  by?: string
  date?: string
  /** 第三批视觉归类条目用 'visual'；缺省 'override' */
  src?: 'override' | 'visual'
}

/**
 * overrides 表类型：值 = 条目；`_` 开头的注释键是 string（对齐 data/name-zh-overrides.json 惯例）。
 */
export type NameTokenOverrides = Record<string, NameTokenOverrideEntry | string>

/**
 * 校验 overrides 表（057 同款三重校验 + 词表合法性；返回错误列表，空 = 通过）：
 * ① speciesId 必须存在；② reason 必填；③ token 必须落在受控词表；
 * ④ 同一 token 不得同时出现在 add 与 remove。
 */
export function validateOverrides(
  overrides: NameTokenOverrides,
  validIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  for (const [id, raw] of Object.entries(overrides)) {
    if (id.startsWith('_')) continue // 注释键
    if (typeof raw === 'string') {
      errors.push(`[name-token-overrides] ${id}: 注释键必须以 _ 开头`)
      continue
    }
    const entry = raw
    if (!validIds.has(id)) errors.push(`[name-token-overrides] 未知物种 id: ${id}`)
    if (!entry || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push(`[name-token-overrides] ${id}: 缺 reason（不一致类型 + 出处）`)
    }
    const adds = entry?.add ?? []
    const removes = entry?.remove ?? []
    const addKeys = new Set<string>()
    for (const pair of adds) {
      const err = checkPair(pair, id, 'add')
      if (err) errors.push(err)
      else addKeys.add(tokenKey(pair[0]!, pair[1]!))
    }
    for (const pair of removes) {
      const err = checkPair(pair, id, 'remove')
      if (err) errors.push(err)
      else if (addKeys.has(tokenKey(pair[0]!, pair[1]!))) {
        errors.push(`[name-token-overrides] ${id}: ${pair[0]}|${pair[1]} 同时在 add 与 remove`)
      }
    }
  }
  return errors
}

function checkPair(pair: [string, string], id: string, field: string): string | null {
  if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
    return `[name-token-overrides] ${id}: ${field} 条目必须是 [色, 部位] 二元组`
  }
  const [c, p] = pair as [string, string]
  if (!(CANONICAL_COLORS as readonly string[]).includes(c)) {
    return `[name-token-overrides] ${id}: ${field} 色词「${c}」不在受控词表（CANONICAL_COLORS）`
  }
  if (p !== PART_WHOLE && !(CANONICAL_PARTS as readonly string[]).includes(p)) {
    return `[name-token-overrides] ${id}: ${field} 部位「${p}」不在受控词表（CANONICAL_PARTS/PART_WHOLE）`
  }
  return null
}

/** 应用 overrides：remove 先删，add 后增（src 用条目的 src，缺省 'override'） */
function applyOverrides(tokens: NameToken[], entry: NameTokenOverrideEntry): NameToken[] {
  const out: NameToken[] = []
  const removeKeys = new Set((entry.remove ?? []).map((p) => tokenKey(p[0]!, p[1]!)))
  for (const t of tokens) if (!removeKeys.has(tokenKey(t.color, t.part))) out.push(t)
  for (const pair of entry.add ?? []) {
    const k = tokenKey(pair[0]!, pair[1]!)
    if (!out.some((t) => tokenKey(t.color, t.part) === k)) {
      out.push({ color: pair[0] as CanonicalColor, part: pair[1]!, src: entry.src ?? 'override' })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 物种入口（带按 id 缓存——组题时对全池调用，名字解析是纯函数可缓存）
// ---------------------------------------------------------------------------

import rawOverrides from '../../data/name-token-overrides.json'

/** 全局 overrides 表（入库文件 data/name-token-overrides.json；_ 开头键是注释） */
export const OVERRIDES: NameTokenOverrides = rawOverrides as unknown as NameTokenOverrides

const cache = new Map<string, NameToken[]>()

/** 物种 → tokens（中英并集 + overrides；按 id 缓存） */
export function speciesTokens(sp: { id: string; nameZh?: string; nameEn?: string }): NameToken[] {
  const hit = cache.get(sp.id)
  if (hit) return hit
  let tokens = parseNameTokens(sp.nameZh, sp.nameEn)
  const entry = OVERRIDES[sp.id]
  if (entry && typeof entry !== 'string') tokens = applyOverrides(tokens, entry)
  cache.set(sp.id, tokens)
  return tokens
}

/** 清缓存（测试用；生产路径 overrides 是构建期常量，无需失效） */
export function clearNameTokenCache(): void {
  cache.clear()
}
