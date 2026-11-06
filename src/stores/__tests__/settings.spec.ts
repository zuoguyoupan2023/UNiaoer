import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '../../i18n'
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

describe('settings store · locale（015 i18n-6）', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('写 locale 即同步 i18n、<html lang> 并持久化', async () => {
    const s = useSettingsStore()
    s.locale = 'en'
    await nextTick() // watch flush: 'post'
    expect(i18n.global.locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(JSON.parse(localStorage.getItem('uniaoer.settings.v2')!).locale).toBe('en')
    // 还原，避免影响其他用例（setup 固定 zh-CN）
    s.locale = 'zh-CN'
    await nextTick()
    expect(i18n.global.locale.value).toBe('zh-CN')
  })
})

describe('settings store · 出题地区默认与一次性全球（2026-11-06 用户定）', () => {
  /** 改 URL 查询串 + 清 globalZone 的进程内缓存 */
  async function setSearch(search: string) {
    const { _resetGlobalZoneCache } = await import('../../core/globalZone')
    window.history.replaceState({}, '', `/${search}`)
    _resetGlobalZoneCache()
  }

  beforeEach(async () => {
    localStorage.clear()
    await setSearch('')
    setActivePinia(createPinia())
  })

  it('默认地区是「亚洲」AS，不是 ALL', () => {
    const s = useSettingsStore()
    expect(s.region).toBe('AS')
  })

  it('带 ?zone=global 进来 → 生效地区是 ALL', async () => {
    await setSearch('?zone=global')
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.region).toBe('ALL')
  })

  it('**一次性**：原本选上海，带 zone=global 做完一轮，存档里仍是上海', async () => {
    // 1) 用户原本的选择：上海（CN-31）
    const s = useSettingsStore()
    s.region = 'CN-31'
    await nextTick()
    expect(JSON.parse(localStorage.getItem('uniaoer.settings.v2')!).region).toBe('CN-31')

    // 2) 他好奇点了全球专用链接进来（模拟重新加载页面）
    await setSearch('?zone=global')
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    expect(s2.region).toBe('ALL') // 本次生效 = 全球

    // 3) 关键：即使他在这轮里做了什么，存档也不能被写成 ALL
    await nextTick()
    expect(JSON.parse(localStorage.getItem('uniaoer.settings.v2')!).region).toBe('CN-31')

    // 4) 下次用普通链接打开 → 回到上海
    await setSearch('')
    setActivePinia(createPinia())
    const s3 = useSettingsStore()
    expect(s3.region).toBe('CN-31')
  })

  it('旧存档里的 ALL 被迁到 AS（不留永久全球）', async () => {
    localStorage.setItem('uniaoer.settings.v2', JSON.stringify({ region: 'ALL' }))
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.region).toBe('AS')
  })

  it('旧存档里的具体地区（新加坡 SG / 云南 CN-53）原样保留', async () => {
    localStorage.setItem('uniaoer.settings.v2', JSON.stringify({ region: 'SG' }))
    setActivePinia(createPinia())
    expect(useSettingsStore().region).toBe('SG')

    localStorage.setItem('uniaoer.settings.v2', JSON.stringify({ region: 'CN-53' }))
    setActivePinia(createPinia())
    expect(useSettingsStore().region).toBe('CN-53')
  })
})
