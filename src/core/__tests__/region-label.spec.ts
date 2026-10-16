/**
 * 港澳台与 CN 的显示名（AGENTS 铁律 6）
 *
 * 事故背景（2026-10-17）：物种详情的「地区分布」直接用裸 `Intl.DisplayNames`，
 * 台湾就按运行时 CLDR 显示成「台湾 / Taiwan」；而港澳台必须固定为
 * 「中国香港／中国澳门／中国台湾」（英文 Hong Kong, China / Macao, China / Taiwan, China）。
 * 现在统一走 regionLabel()，本测试保证这条口径不会再被绕开。
 *
 * 注意：这里用假 t 做断言（core 层不引 i18n 实例），真文案在 locales 里；
 * 所以同时断言「这些码必须命中固定文案分支」，即不被交给 CLDR。
 */
import { describe, it, expect } from 'vitest'
import { regionLabel, REGION_LABEL_KEY } from '../region'

/** 假 t：把 key 原样返回，便于断言「走的是固定文案分支」 */
const fakeT = (k: string) => `«${k}»`

describe('地区显示名（铁律 6）', () => {
  it('港澳台与 CN 一律走固定文案，不交给运行时 CLDR', () => {
    for (const code of ['CN', 'HK', 'MO', 'TW']) {
      expect(REGION_LABEL_KEY[code]).toBeTruthy()
      expect(regionLabel(code, fakeT, 'zh-CN')).toBe(`«${REGION_LABEL_KEY[code]}»`)
    }
  })

  it('台湾键指向 region.regions.TW（i18n 文案为「中国台湾 / Taiwan, China」）', () => {
    expect(REGION_LABEL_KEY.TW).toBe('region.regions.TW')
    expect(REGION_LABEL_KEY.HK).toBe('region.regions.HK')
    expect(REGION_LABEL_KEY.MO).toBe('region.regions.MO')
  })

  it('其余国家交给 Intl.DisplayNames（拿不到就回退代码，不崩）', () => {
    const out = regionLabel('JP', fakeT, 'zh-CN')
    expect(out).not.toBe('«region.regions.JP»')
    expect(out.length).toBeGreaterThan(0)
    // 未收录的伪码不应抛异常
    expect(typeof regionLabel('ZZ', fakeT, 'zh-CN')).toBe('string')
  })
})