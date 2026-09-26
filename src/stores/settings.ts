import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AutoNextMode, LicensePolicy } from '@/types'

// v2：音频自动播放默认由「关」改为「开」（见 006），旧键不复用以免沿用旧默认
const STORAGE_KEY = 'uniaoer.settings.v2'

interface Persisted {
  /** 许可策略：固定宽松（R31，不再向用户展示） */
  licensePolicy: LicensePolicy
  autoplayAudio: boolean
  autoplayDelayMs: number
  autoNext: AutoNextMode
  /** 环境鸟鸣：被取消勾选的音轨 id（默认全部勾选，见 006 R22） */
  ambienceExcluded: string[]
  /** 佩戴的称号轨道 id（009）；null = 不佩戴 */
  wornTitle: string | null
  /** 佩戴的徽章 id（009）；null = 不佩戴 */
  wornBadge: string | null
  /** 已自动佩戴过首枚称号/徽章（固定规则：仅首枚自动佩戴，R32） */
  titleAutoWorn: boolean
  badgeAutoWorn: boolean
  /** 环境鸟鸣开关（R30）：默认开启，进入应用自动播放（被浏览器拦截则在首次手势后重试） */
  ambienceEnabled: boolean
}

function load(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
  } catch {
    return {}
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = load()

  /** 许可策略：固定宽松（R31，不再作为用户可配置项） */
  const licensePolicy = ref<LicensePolicy>('relaxed')
  /** 音频自动播放：默认开；第 1 题手动，第 2 题起自动（可在设置中改回每题手动） */
  const autoplayAudio = ref<boolean>(saved.autoplayAudio ?? true)
  /** 自动播放延迟（ms） */
  const autoplayDelayMs = ref<number>(saved.autoplayDelayMs ?? 2000)
  /** 自动进入下一题：默认答对后等 2s（见 006 D2） */
  const autoNext = ref<AutoNextMode>(saved.autoNext ?? 'correct')
  /** 环境鸟鸣：取消勾选的音轨（默认全部勾选；新增音轨默认生效） */
  const ambienceExcluded = ref<string[]>(saved.ambienceExcluded ?? [])
  /** 佩戴称号（轨道 id；称号文本由当前数据实时派生） */
  const wornTitle = ref<string | null>(saved.wornTitle ?? null)
  /** 佩戴徽章（徽章 id，R31） */
  const wornBadge = ref<string | null>(saved.wornBadge ?? null)
  /** 已自动佩戴过首枚称号（固定规则：仅首枚自动佩戴，之后手动更换，R32） */
  const titleAutoWorn = ref<boolean>(saved.titleAutoWorn ?? false)
  const badgeAutoWorn = ref<boolean>(saved.badgeAutoWorn ?? false)
  /** 环境鸟鸣开关（默认开；用户手动关闭后记住，不再自动播放） */
  const ambienceEnabled = ref<boolean>(saved.ambienceEnabled ?? true)

  watch(
    [
      licensePolicy,
      autoplayAudio,
      autoplayDelayMs,
      autoNext,
      ambienceExcluded,
      wornTitle,
      wornBadge,
      titleAutoWorn,
      badgeAutoWorn,
      ambienceEnabled,
    ],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            licensePolicy: licensePolicy.value,
            autoplayAudio: autoplayAudio.value,
            autoplayDelayMs: autoplayDelayMs.value,
            autoNext: autoNext.value,
            ambienceExcluded: ambienceExcluded.value,
            wornTitle: wornTitle.value,
            wornBadge: wornBadge.value,
            titleAutoWorn: titleAutoWorn.value,
            badgeAutoWorn: badgeAutoWorn.value,
            ambienceEnabled: ambienceEnabled.value,
          } satisfies Persisted),
        )
      } catch {
        /* localStorage 不可用（file:// 等）时忽略 */
      }
    },
    { flush: 'post' },
  )

  return {
    licensePolicy,
    autoplayAudio,
    autoplayDelayMs,
    autoNext,
    ambienceExcluded,
    wornTitle,
    wornBadge,
    titleAutoWorn,
    badgeAutoWorn,
    ambienceEnabled,
  }
})
