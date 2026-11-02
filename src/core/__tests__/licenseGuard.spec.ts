import { describe, it, expect } from 'vitest'
import {
  isOpenLicense,
  isNonCommercial,
  canTranscode,
  licenseAllowed,
  formatAttribution,
  cleanAuthor,
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

/**
 * 2026-11-02 用户反馈：海报署名行「作者 · 许可证」后面还跟着 "uploaded by 作者名"，
 * 太长导致结尾被截掉。根因是 manifest 的 author 字段存的是 iNat attribution 全文。
 */
describe('cleanAuthor — iNat attribution 原文 → 纯作者名', () => {
  it('去 (c) 前缀与 some rights reserved 尾缀', () => {
    expect(cleanAuthor('(c) Paul Werner Süss, some rights reserved (CC BY-NC)')).toBe('Paul Werner Süss')
  })

  it('去 uploaded by 后缀（作者名在前）', () => {
    expect(
      cleanAuthor('(c) Avinash Bhagat, some rights reserved (CC BY-NC), uploaded by Avinash Bhagat'),
    ).toBe('Avinash Bhagat')
  })

  it('CC0「no rights reserved」+ 上传者 → 空串（弃权，法律上无需署名）', () => {
    // 上传者是平台附加信息，不是 CC 的署名对象；CC0 连创作者都不要求署名。
    expect(cleanAuthor('no rights reserved (uploaded by 洪廷維)')).toBe('')
    expect(cleanAuthor('no rights reserved, uploaded by 葉子')).toBe('')
    expect(cleanAuthor('no rights reserved')).toBe('')
  })

  it('已是干净名字 → 原样返回', () => {
    expect(cleanAuthor('John Doe')).toBe('John Doe')
    expect(cleanAuthor('김대환, 이선미')).toBe('김대환, 이선미')
  })

  it('iNat 本地化的保留权声明（多语种）都能剥掉 —— 靠结构而非枚举语种', () => {
    // 实测 15,783 条里混有十几种语言；枚举语言的旧实现漏了 45 条（葡语/中文那批）
    expect(cleanAuthor('(c) Геннадий, algunos derechos reservados (CC BY-NC), subido por Геннадий')).toBe(
      'Геннадий',
    )
    expect(
      cleanAuthor('(c) Ivo Carlos Zecchin, osa oikeuksista pidätetään (CC BY-NC), lähettänyt Ivo Carlos Zecchin'),
    ).toBe('Ivo Carlos Zecchin')
    expect(cleanAuthor('(c) Nik Borrow，保留部分权利（CC BY-NC）, 由 Nik Borrow 上传')).toBe('Nik Borrow')
    expect(cleanAuthor('(c) Steve Murray, alguns direitos reservados (CC BY-NC), carregado por Steve Murray')).toBe(
      'Steve Murray',
    )
    expect(cleanAuthor('(c) Nick Athanas, bazı hakları saklıdır (CC BY-NC-SA)')).toBe('Nick Athanas')
    expect(cleanAuthor('(c) Frédéric Desmoulins،  بعض الحقوق محفوظة (CC BY)')).toBe('Frédéric Desmoulins')
  })

  it('多人合著不被切断（只丢最后一段声明）', () => {
    expect(cleanAuthor('(c) 김대환, 이선미, some rights reserved (CC BY-NC)')).toBe('김대환, 이선미')
    // 裸名字（无 iNat attribution 结构）→ 绝对不能丢段
    expect(cleanAuthor('김대환, 이선미')).toBe('김대환, 이선미')
  })

  it('非 CC 许可（GFDL）也要截断', () => {
    expect(cleanAuthor('(c) fir0002, some rights reserved (GFDL)')).toBe('fir0002')
  })

  it('中文把许可写在括号外的形态', () => {
    expect(cleanAuthor('(c) kritadi，保留部份權利CC BY-NC')).toBe('kritadi')
  })

  it('俄语公有领域声明', () => {
    expect(
      cleanAuthor('Émile Oustalet (1844-1905), нет известных ограничений авторского права (общественное достояние)'),
    ).toBe('Émile Oustalet (1844-1905)')
  })

  it('HTML 实体解码（iNat 返回 &amp; 而非 &）', () => {
    expect(cleanAuthor('Albert Lastukhin &amp; Yuri Glushchenko')).toBe('Albert Lastukhin & Yuri Glushchenko')
  })

  it('CC0 / 无作者 → 空串（法律上无需署名）', () => {
    expect(cleanAuthor('no rights reserved')).toBe('')
    expect(cleanAuthor('no rights reserved, uploaded by 葉子')).toBe('')
  })

  it('空值安全', () => {
    expect(cleanAuthor('')).toBe('')
    expect(cleanAuthor(null)).toBe('')
    expect(cleanAuthor(undefined)).toBe('')
  })
})
