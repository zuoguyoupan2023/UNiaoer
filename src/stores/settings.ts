import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { LicensePolicy } from '@/types'

const STORAGE_KEY = 'uniaoer.settings.v1'

interface Persisted {
  licensePolicy: LicensePolicy
  autoplayAudio: boolean
  autoplayDelayMs: number
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
  /** 音频自动播放：默认关（第 2 题起、延迟后再播） */
  const autoplayAudio = ref<boolean>(saved.autoplayAudio ?? false)
  /** 自动播放延迟（ms） */
  const autoplayDelayMs = ref<number>(saved.autoplayDelayMs ?? 2000)

  watch(
    [licensePolicy, autoplayAudio, autoplayDelayMs],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            licensePolicy: licensePolicy.value,
            autoplayAudio: autoplayAudio.value,
            autoplayDelayMs: autoplayDelayMs.value,
          } satisfies Persisted),
        )
      } catch {
        /* localStorage 不可用（file:// 等）时忽略 */
      }
    },
    { flush: 'post' },
  )

  return { licensePolicy, autoplayAudio, autoplayDelayMs }
})
