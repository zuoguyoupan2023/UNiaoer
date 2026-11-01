/**
 * 031 D-031-2:名录拼音排序键(构建期预计算)。
 *
 * 中文名 → 无声调拼音(小写 ASCII),用于 /catalog 的「拼音」排序与字母索引。
 * 设计:
 *   - 只取汉字,其余字符(空格/学名/零宽字符等脏数据)直接跳过;
 *   - ü 归一化为 v(pinyin-pro 输出 lü → "lv",保证键为纯 a-z、比较稳定);
 *   - 整串转换让多音字按上下文消歧(如「长尾」→ cháng);
 *   - 拼音库未收录的 CJK 扩展区用字(鸟名生僻字)走 CHAR_OVERRIDES 人工校准;
 *     仍无法读音的字跳过并回调上报(便于数据更新时发现新增脏字)。
 */
import { pinyin } from 'pinyin-pro'

/** 生僻鸟名用字读音补丁(拼音库未收录的扩展区字;读音据通行鸟类名录)。 */
const CHAR_OVERRIDES = new Map([
  ['䳍', 'gong'], // 䳍形目 / 穴䳍(tinamou)
  ['䳭', 'ji'], // 石䳭(chat)
  ['䴉', 'huan'], // 朱䴉(ibis,「鹮」的异体)
])

/** 显示用带调读音补丁(与 CHAR_OVERRIDES 同源;读音据通行鸟类名录)。 */
const DISPLAY_OVERRIDES = new Map([
  ['䳍', 'gōng'],
  ['䳭', 'jí'],
  ['䴉', 'huán'],
])

/** 汉字判定:URO + 扩展 A + 扩展 B–H(含鸟名偶用的扩展区字,如 U+317D0 的「𱟐」类) */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{323af}]/u

/** 元素 → 纯小写 a-z(ü→v);缺失或非拉丁元素返回空串(拼音库对未收录字会给出空槽)。 */
function toLatin(part) {
  if (typeof part !== 'string') return ''
  return part
    .replace(/ü/g, 'v')
    .replace(/[^a-z]/gi, '')
    .toLowerCase()
}

/**
 * 中文名 → 拼音排序键。
 * @param {string} name 中文名(可含空格/学名等非汉字符,自动跳过)
 * @param {(chars: string[]) => void} [onUnknown] 无法读音的汉字回调(按名调用)
 * @returns {string} 纯小写 a-z 键(可能为空串,调用方应回退英文名/学名)
 */
export function pinyinKey(name, onUnknown) {
  const chars = [...String(name || '').normalize('NFC')].filter((ch) => HAN.test(ch))
  if (!chars.length) return ''
  const text = chars.join('')
  const unknown = []
  const parts = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'removed' })
  // 逐字对齐是主路径(实测全量名录 0 处错位);一旦错位则退回逐字转换,保证不越界。
  if (parts.length !== chars.length) {
    let out = ''
    for (const ch of chars) {
      const override = CHAR_OVERRIDES.get(ch)
      if (override) {
        out += override
        continue
      }
      const latin = toLatin(pinyin(ch, { toneType: 'none', type: 'array', nonZh: 'removed' })[0])
      if (latin) out += latin
      else unknown.push(ch)
    }
    if (unknown.length && onUnknown) onUnknown(unknown)
    return out
  }
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const override = CHAR_OVERRIDES.get(ch)
    if (override) {
      out += override
      continue
    }
    const latin = toLatin(parts[i])
    if (latin) out += latin
    else unknown.push(ch)
  }
  if (unknown.length && onUnknown) onUnknown(unknown)
  return out
}

/**
 * 中文名 → **带调、分词**的拼音显示串（2026-10-31 预习浮窗用）。
 * 「白头鹎」→ "bái tóu bēi"（排序键 py 是无声调连写,不适合展示）。
 * 与 pinyinKey 同源同坑:CHAR_OVERRIDES 的字走 DISPLAY_OVERRIDES 带调版;
 * 未收录字回调上报;无汉字返回空串。
 * @param {string} name 中文名
 * @param {(chars: string[]) => void} [onUnknown] 无法读音的汉字回调
 * @returns {string} 空格分词、带声调符号的拼音;失败/无汉字为空串
 */
export function pinyinDisplay(name, onUnknown) {
  const chars = [...String(name || '').normalize('NFC')].filter((ch) => HAN.test(ch))
  if (!chars.length) return ''
  const text = chars.join('')
  const unknown = []
  const parts = pinyin(text, { toneType: 'symbol', type: 'array', nonZh: 'removed' })
  const out = []
  const push = (i, ch) => {
    const override = DISPLAY_OVERRIDES.get(ch)
    if (override) {
      out.push(override)
      return
    }
    const syl = parts.length === chars.length ? parts[i] : pinyin(ch, { toneType: 'symbol', type: 'array', nonZh: 'removed' })[0]
    if (typeof syl === 'string' && /[a-z]/.test(syl)) out.push(syl)
    else unknown.push(ch)
  }
  for (let i = 0; i < chars.length; i++) push(i, chars[i])
  if (unknown.length && onUnknown) onUnknown(unknown)
  return out.join(' ')
}
