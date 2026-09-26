import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settings'

describe('settings store（环境鸟鸣勾选）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('默认 ambienceExcluded 为空（全部音轨勾选）', () => {
    const s = useSettingsStore()
    expect(s.ambienceExcluded).toEqual([])
  })

  it('取消勾选后写入 localStorage（post flush 后），新实例读取恢复', async () => {
    const s = useSettingsStore()
    s.ambienceExcluded = ['animals/crows', 'animals/owl']
    await nextTick() // watch flush: 'post' 需要 tick 后才落盘
    expect(JSON.parse(localStorage.getItem('uniaoer.settings.v2')!).ambienceExcluded).toEqual([
      'animals/crows',
      'animals/owl',
    ])

    setActivePinia(createPinia()) // 模拟重新打开页面
    const s2 = useSettingsStore()
    expect(s2.ambienceExcluded).toEqual(['animals/crows', 'animals/owl'])
  })
})
