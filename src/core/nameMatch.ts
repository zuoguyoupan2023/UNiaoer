/**
 * 089 P0-3：**中心判分函数**（同步——正确率 computed 与落库共用同一语义）。
 * 口径 = docs/085 §4.1 接受集合总表：
 *
 * | 卷别 | 接受（归一化后精确匹配） | 拒绝 |
 * |---|---|---|
 * | 中文卷 | nameZh 简体 · nameZhTw 港台正式名 · nameZhTrad 繁体字形（构建期预计算） | 学名 · 英文名 · 拼音 · 别名/俗名/绰号 |
 * | 英文卷 | nameEn | 学名 · 中文名 · 拼音 · 别名 |
 * | 学名卷 | nameSci（完整二名，大小写不敏感、空格归一；缩写 P. sinensis 自然不匹配） | 中文名 · 英文名 · 拼音 · 别名 |
 *
 * 归一化：去首尾空白 · 全角→半角（字母/数字/空格）· 连续空白压一 ·（拉丁体系）小写。
 * 不做模糊/编辑距离（D-9 非对即错）；体系锁定（D-8）：跨体系输入一律判错。
 *
 * 中文卷的变体字典（public/data/name-variants.json）由 **quiz.start 预载**（见 nameVariants.ts）；
 * 此处同步查缓存，未加载（异常路径）退化为仅 nameZh——是接受集合的**子集**，只会少判对、
 * 绝不误判对，安全方向正确。
 */
import type { Question } from '@/types'
import { cachedNameVariants, loadNameVariants } from './nameVariants'

export { loadNameVariants }

/** 全角→半角（字母/数字/空格）；其余字符原样 */
function toHalfWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ')
}

/** 通用归一化：trim · 全半角 · 压空白 */
function normalize(s: string): string {
  return toHalfWidth(String(s || '')).trim().replace(/\s+/g, ' ')
}

/** 拉丁体系归一化（学名/英文）：再小写 */
function normalizeLatin(s: string): string {
  return normalize(s).toLowerCase()
}

/** 构造某题的接受集合（同步；choice 题含 q.answer 保证旧行为等价退化） */
export function acceptedAnswers(q: Question): Set<string> {
  const set = new Set<string>()
  if (q.nameMode === 'sci') {
    if (q.sci) set.add(normalizeLatin(q.sci))
    return set
  }
  if (q.nameMode === 'en') {
    set.add(normalizeLatin(q.answer))
    return set
  }
  // 中文卷（nameMode 缺省=zh，兼容旧 choice 行为）：nameZh ∪ 港台名 ∪ 繁体字形
  set.add(normalize(q.answer))
  const v = cachedNameVariants()?.get(String(q.sci || '').trim().replace(/\s+/g, ' '))
  if (v?.tw) set.add(normalize(v.tw))
  if (v?.trad) set.add(normalize(v.trad))
  return set
}

/** 判分（同步；超时/空输入一律 false） */
export function isCorrectAnswer(q: Question, raw: string | null | undefined): boolean {
  if (raw == null) return false
  const norm = q.nameMode && q.nameMode !== 'zh' ? normalizeLatin(raw) : normalize(raw)
  if (!norm) return false
  return acceptedAnswers(q).has(norm)
}
