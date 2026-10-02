import { describe, expect, it } from 'vitest'
import { extractBirds, parseSheet, parseSharedStrings } from '../adapters/cn-authority.mjs'
import { CN_PROVINCES, CN_SENSITIVE, CN_SPECIAL_COUNTRY } from '../cn-provinces.mjs'
import { matchSubdivision } from '../adapters/iso3166.mjs'
import { buildIndex } from '../adapters/iso3166.mjs'

describe('cn-authority adapter', () => {
  it('parseSharedStrings：拼接多 <t> 片段', () => {
    const xml =
      '<sst><si><t>种拉丁名</t></si><si><t>Arborophila</t><t> torqueola</t></si><si><t>迁徙状态（留鸟(R)）</t></si></sst>'
    expect(parseSharedStrings(xml)).toEqual(['种拉丁名', 'Arborophila torqueola', '迁徙状态（留鸟(R)）'])
  })

  it('parseSheet：shared 字符串、inline 字符串与数字', () => {
    const ss = parseSharedStrings('<sst><si><t>种拉丁名</t></si><si><t>R</t></si></sst>')
    const sheet =
      '<sheetData>' +
      '<row r="1"><c r="E1" t="s"><v>0</v></c><c r="Z1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="E2" t="s"><v>0</v></c><c r="Z2" t="s"><v>1</v></c></row>' +
      '<row r="3"><c r="E3" t="inlineStr"><is><t>Pica pica</t></is></c><c r="Z3"><v>99</v></c></row>' +
      '</sheetData>'
    const rows = parseSheet(sheet, ss)
    expect(rows[0]).toEqual({ E: '种拉丁名', Z: 'R' })
    expect(rows[2]).toEqual({ E: 'Pica pica', Z: '99' })
  })

  it('extractBirds：按表头定位列；连写状态逐字符解析；未知字母丢弃计数', () => {
    const rows = [
      { A: '目', E: '种拉丁名', Z: '迁徙状态（留鸟(R)、夏候鸟(S)）' },
      { E: 'Arborophila torqueola', Z: 'R' },
      { E: 'Pica pica', Z: 'RSWP' }, // 无分隔连写（数据集实测格式，如白头鹎）
      { E: 'Ciconia boyciana', Z: 'P,W' },
      { E: 'Aix galericulata', Z: 'R,X9' }, // X 为未知码丢弃；数字忽略
      { E: 'Nonsense' }, // 无空格学名跳过
    ]
    const { bySci, unknown } = extractBirds(rows)
    expect(bySci['arborophila torqueola']).toEqual({ range: ['resident'] })
    expect(bySci['pica pica']).toEqual({ range: ['resident', 'summer', 'winter', 'passage'] })
    expect(bySci['ciconia boyciana']).toEqual({ range: ['passage', 'winter'] })
    expect(bySci['aix galericulata']).toEqual({ range: ['resident'] })
    expect(bySci['nonsense']).toBeUndefined()
    expect(unknown).toEqual([{ code: 'X', n: 1 }])
  })
})

describe('cn-provinces 官方区划常量', () => {
  it('34 个省级行政区，code 唯一', () => {
    expect(CN_PROVINCES).toHaveLength(34)
    expect(new Set(CN_PROVINCES.map((p) => p.code)).size).toBe(34)
  })

  it('港澳台标注（铁律 6）：zh 精确匹配、en 以 ", China" 结尾', () => {
    expect(CN_SENSITIVE['CN-71']).toEqual({ zh: '中国台湾', en: 'Taiwan, China' })
    expect(CN_SENSITIVE['CN-91']).toEqual({ zh: '中国香港', en: 'Hong Kong, China' })
    expect(CN_SENSITIVE['CN-92']).toEqual({ zh: '中国澳门', en: 'Macao, China' })
    const byCode = new Map(CN_PROVINCES.map((p) => [p.code, p]))
    for (const [code, names] of Object.entries(CN_SENSITIVE)) {
      const p = byCode.get(code)
      expect(p?.zh).toBe(names.zh)
      expect(p?.en.endsWith(', China')).toBe(true)
    }
  })

  it('港澳台与 GBIF 独立国家码一一对应', () => {
    expect(CN_SPECIAL_COUNTRY).toEqual({ TW: 'CN-71', HK: 'CN-91', MO: 'CN-92' })
  })
})

describe('iso3166 adapter：CN 别名归一', () => {
  const index = buildIndex({
    CN: {
      'CN-53': 'Yunnan',
      'CN-54': 'Xizang\n(Tibet)',
      'CN-51': 'Sichuan',
      'CN-13': 'Hebei',
      'CN-14': 'Shanxi',
      'CN-61': 'Shaanxi',
      'CN-23': 'Heilongjiang',
      'CN-91': 'Hong Kong',
    },
  })

  it('GBIF 实测值映射到 code', () => {
    expect(matchSubdivision(index, 'CN', 'Xizang')).toBe('CN-54')
    expect(matchSubdivision(index, 'CN', 'Tibet')).toBe('CN-54')
    expect(matchSubdivision(index, 'CN', 'Szechwan')).toBe('CN-51')
    expect(matchSubdivision(index, 'CN', 'Hebei (Hopei)')).toBe('CN-13')
    expect(matchSubdivision(index, 'CN', 'Heilongjiang Prov.')).toBe('CN-23')
    expect(matchSubdivision(index, 'CN', 'YunNan')).toBe('CN-53')
  })

  it('山西/陕西消歧；历史地区不臆造', () => {
    expect(matchSubdivision(index, 'CN', 'Shanxi')).toBe('CN-14')
    expect(matchSubdivision(index, 'CN', 'Shaanxi')).toBe('CN-61')
    expect(matchSubdivision(index, 'CN', 'Shansi')).toBe('CN-14')
    expect(matchSubdivision(index, 'CN', 'Shensi')).toBe('CN-61')
    expect(matchSubdivision(index, 'CN', 'Manchuria')).toBeNull()
  })
})
