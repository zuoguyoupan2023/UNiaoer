/**
 * 匿名设备 id（B6）：仅用于「同一设备不重复投票 / 报错防刷」，
 * 随机生成、本地保存，不含任何个人身份信息，也不上传画像。
 */
const KEY = 'uniaoer.clientId'
const FALLBACK = 'anonymous-device'

export function getClientId(): string {
  try {
    let v = localStorage.getItem(KEY)
    if (!v || v.length < 8) {
      v =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(KEY, v)
    }
    return v
  } catch {
    return FALLBACK
  }
}
