import { describe, it, expect } from 'vitest'
import {
  isOpenLicense,
  isNonCommercial,
  canTranscode,
  licenseAllowed,
  formatAttribution,
} from '../licenseGuard'

describe('isOpenLicense — Xeno-canto v3 URL 格式', () => {
  it('放行 CC0 / BY / BY-SA', () => {
    expect(isOpenLicense('https://creativecommons.org/publicdomain/zero/1.0/')).toBe(true)
    expect(isOpenLicense('https://creativecommons.org/publicdomain/mark/1.0/')).toBe(true)
    expect(isOpenLicense('https://creativecommons.org/licenses/by/4.0/')).toBe(true)
    expect(isOpenLicense('https://creativecommons.org/licenses/by-sa/4.0/')).toBe(true)
  })

  it('排除 NC / ND', () => {
    expect(isOpenLicense('https://creativecommons.org/licenses/by-nc/4.0/')).toBe(false)
    expect(isOpenLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(false)
    expect(isOpenLicense('https://creativecommons.org/licenses/by-nd/4.0/')).toBe(false)
    expect(isOpenLicense('https://creativecommons.org/licenses/by-nc-nd/4.0/')).toBe(false)
  })
})

describe('isOpenLicense — iNaturalist 短码格式', () => {
  it('放行 cc0 / cc-by / cc-by-sa', () => {
    expect(isOpenLicense('cc0')).toBe(true)
    expect(isOpenLicense('cc-by')).toBe(true)
    expect(isOpenLicense('cc-by-sa')).toBe(true)
  })

  it('排除 nc / nd', () => {
    expect(isOpenLicense('cc-by-nc')).toBe(false)
    expect(isOpenLicense('cc-by-nc-sa')).toBe(false)
    expect(isOpenLicense('cc-by-nd')).toBe(false)
  })

  it('空值一律排除', () => {
    expect(isOpenLicense('')).toBe(false)
    expect(isOpenLicense(null)).toBe(false)
    expect(isOpenLicense(undefined)).toBe(false)
  })
})

describe('isNonCommercial / canTranscode', () => {
  it('识别非商业许可', () => {
    expect(isNonCommercial('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(true)
    expect(isNonCommercial('cc-by')).toBe(false)
  })

  it('ND 不允许转码', () => {
    expect(canTranscode('https://creativecommons.org/licenses/by-nd/4.0/')).toBe(false)
    expect(canTranscode('cc-by-nc-nd')).toBe(false)
    expect(canTranscode('https://creativecommons.org/licenses/by-sa/4.0/')).toBe(true)
    expect(canTranscode('cc0')).toBe(true)
  })
})

describe('licenseAllowed — 策略', () => {
  const nc = 'https://creativecommons.org/licenses/by-nc/4.0/'
  const by = 'https://creativecommons.org/licenses/by/4.0/'

  it('strict 只放行开放许可', () => {
    expect(licenseAllowed(by, 'strict')).toBe(true)
    expect(licenseAllowed(nc, 'strict')).toBe(false)
  })

  it('relaxed 放行全部（含 NC）', () => {
    expect(licenseAllowed(by, 'relaxed')).toBe(true)
    expect(licenseAllowed(nc, 'relaxed')).toBe(true)
    expect(licenseAllowed('', 'relaxed')).toBe(false)
  })
})

describe('formatAttribution', () => {
  it('包含来源 / 作者 / 许可证', () => {
    const s = formatAttribution({
      source: 'Xeno-canto',
      author: 'John Doe',
      license: 'CC-BY-SA-4.0',
    })
    expect(s).toContain('Xeno-canto')
    expect(s).toContain('John Doe')
    expect(s).toContain('CC-BY-SA-4.0')
  })

  it('作者缺失时回退占位', () => {
    expect(formatAttribution({ source: 'iNaturalist', license: 'cc0' })).toContain('Unknown author')
  })
})
