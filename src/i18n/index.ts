import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

export type AppLocale = 'zh-CN' | 'en'

const SUPPORTED: AppLocale[] = ['zh-CN', 'en']

/** 与 settings store 相同的持久化键；启动时读取已保存的语言（i18n-6） */
function savedLocale(): AppLocale | undefined {
  try {
    const raw = localStorage.getItem('uniaoer.settings.v2')
    const saved = raw ? (JSON.parse(raw) as { locale?: string }) : {}
    return SUPPORTED.includes(saved.locale as AppLocale) ? (saved.locale as AppLocale) : undefined
  } catch {
    return undefined
  }
}

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
  // 已保存的语言优先（i18n-6），否则按浏览器语言探测；全站文案已迁移完毕，不再固定 zh-CN
  locale: savedLocale() ?? detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, en },
  missing(_locale, key) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`)
  },
})

function syncDocumentLang(locale: AppLocale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
syncDocumentLang(i18n.global.locale.value as AppLocale)

/** 切换语言（设置 store 为唯一入口，调用此函数同步 i18n 实例与 <html lang>） */
export function setLocale(locale: AppLocale) {
  if (!SUPPORTED.includes(locale)) return
  i18n.global.locale.value = locale
  syncDocumentLang(locale)
}

export function currentLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}
