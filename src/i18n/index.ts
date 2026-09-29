import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

export type AppLocale = 'zh-CN' | 'en'

const SUPPORTED: AppLocale[] = ['zh-CN', 'en']

/** 浏览器语言 → 支持的语言（zh* → zh-CN，en* → en，否则默认 zh-CN，010 §i18n-0） */
function detectLocale(): AppLocale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const raw of langs) {
    const l = (raw || '').toLowerCase()
    if (l.startsWith('zh')) return 'zh-CN'
    if (l.startsWith('en')) return 'en'
  }
  return 'zh-CN'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, en },
})

/** 切换语言（后续由设置页/顶栏调用并持久化，010 §i18n-6） */
export function setLocale(locale: AppLocale) {
  if (SUPPORTED.includes(locale)) i18n.global.locale.value = locale
}

export function currentLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}
