import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AutoNextMode, LicensePolicy } from '@/types'

// v2：音频自动播放默认由「关」改为「开」（见 006），旧键不复用以免沿用旧默认
const STORAGE_KEY = 'uniaoer.settings.v2'

interface Persisted {
  licensePolicy: LicensePolicy
  autoplayAudio: boolean
  autoplayDelayMs: number
  autoNext: AutoNextMode
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

  /** 默认 relaxed：项目非商业，优先保证素材可用（见 001 决策 D2） */
  const licensePolicy = ref<LicensePolicy>(saved.licensePolicy ?? 'relaxed')
  /** 音频自动播放：默认开；第 1 题手动，第 2 题起自动（可在设置中改回每题手动） */
  const autoplayAudio = ref<boolean>(saved.autoplayAudio ?? true)
  /** 自动播放延迟（ms） */
  const autoplayDelayMs = ref<number>(saved.autoplayDelayMs ?? 2000)
  /** 自动进入下一题：默认答对后等 2s（见 006 D2） */
  const autoNext = ref<AutoNextMode>(saved.autoNext ?? 'correct')

  watch(
    [licensePolicy, autoplayAudio, autoplayDelayMs, autoNext],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            licensePolicy: licensePolicy.value,
            autoplayAudio: autoplayAudio.value,
            autoplayDelayMs: autoplayDelayMs.value,
            autoNext: autoNext.value,
          } satisfies Persisted),
        )
      } catch {
        /* localStorage 不可用（file:// 等）时忽略 */
      }
    },
    { flush: 'post' },
  )

  return { licensePolicy, autoplayAudio, autoplayDelayMs, autoNext }
})
