/**
 * 023 P0:AviList 解析/匹配纯函数单测。
 * XML 片段内联构造,不依赖网络与真实 xlsx;真实端到端靠 `npm run species-index`(缓存 xlsx)与 `--mock`。
 */
import { describe, expect, it } from 'vitest'
import {
  parseSharedStrings,
  columnIndex,
  parseSheetRows,
  taxaFromRows,
  normalizeSciName,
  buildNameIndex,
  matchSpecies,
} from '../avilist-lib.mjs'

describe('parseSharedStrings', () => {
  it('解析普通 <si><t> 与实体', () => {
    const xml = '<sst><si><t>Pycnonotus &amp; Cinynodon</t></si><si><t>a&lt;b&gt;c</t></si></sst>'
    expect(parseSharedStrings(xml)).toEqual(['Pycnonotus & Cinynodon', 'a<b>c'])
  })

  it('解析富文本多段 <r><t>(合并为单串)', () => {
    const xml = '<si><r><t>Light-</t></r><r><t>vented</t></r></si>'
    expect(parseSharedStrings(xml)).toEqual(['Light-vented'])
  })
})

describe('columnIndex', () => {
  it('A→0,Z→25,AA→26,BA→52', () => {
    expect(columnIndex('A')).toBe(0)
    expect(columnIndex('Z')).toBe(25)
    expect(columnIndex('AA')).toBe(26)
    expect(columnIndex('BA')).toBe(52)
  })
})

describe('parseSheetRows', () => {
  const strings = ['Sequence', 'Taxon_rank', 'Scientific_name', 'species', 'Pycnonotus sinensis']

  it('t=s 查共享字符串;稀疏列按 r 展开补位', () => {
    const xml =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
      '</sheetData>'
    const rows = parseSheetRows(xml, strings)
    expect(rows[0]).toEqual(['Sequence', 'Taxon_rank', 'Scientific_name'])
    expect(rows[1][0]).toBe('species')
    expect(rows[1][1]).toBeUndefined()
    expect(rows[1][2]).toBe('Pycnonotus sinensis')
  })

  it('自闭合 <c/> 与 inlineStr', () => {
    const xml =
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Avibase-XX</t></is></c><c r="B1"/></row></sheetData>'
    const rows = parseSheetRows(xml, [])
    expect(rows[0][0]).toBe('Avibase-XX')
    expect(rows[0][1]).toBe('')
  })
})

const HEADER = [
  'Sequence', 'Taxon_rank', 'Order', 'Family', 'Family_English_name', 'Scientific_name', 'Authority',
  'Bibliographic_details', 'English_name_AviList', 'English_name_Clements_v2025', 'English_name_BirdLife_v10',
  'Proposal_number', 'Decision_summary', 'Range', 'Extinct_or_possibly_extinct', 'IUCN_Red_List_Category',
  'BirdLife_DataZone_URL', 'Species_code_Cornell_Lab', 'Birds_of_the_World_URL', 'AvibaseID',
]

function row(cells) {
  const r = Array(HEADER.length).fill(undefined)
  cells.forEach(([i, v]) => (r[i] = v))
  return r
}

const SAMPLE_ROWS = [
  HEADER,
  row([[0, '#'], [1, 'RANK']]), // 阅读者展示行(rank 不在枚举内,应跳过)
  row([[1, 'order'], [5, 'Passeriformes']]),
  row([[1, 'family'], [2, 'Passeriformes'], [3, 'Pycnonotidae'], [4, 'Bulbuls'], [5, 'Pycnonotidae']]),
  row([[1, 'genus'], [3, 'Pycnonotidae'], [5, 'Pycnonotus']]),
  row([
    [0, 23516], [1, 'species'], [2, 'Passeriformes'], [3, 'Pycnonotidae'], [4, 'Bulbuls'],
    [5, 'Pycnonotus sinensis'], [8, 'Light-vented Bulbul'], [9, 'Light-vented Bulbul'],
    [14, ''], [15, 'LC'], [17, 'livbul1'], [19, 'avibase-BB5650EB'],
  ]),
  row([
    [0, 42], [1, 'species'], [2, 'Anseriformes'], [3, 'Anatidae'], [4, 'Ducks'],
    [5, 'Camptorhynchus labradorius'], [8, 'Labrador Duck'], [14, 'Extinct'], [15, 'EX'], [17, 'labduc1'],
    [19, 'avibase-DECFC39A'],
  ]),
  row([
    [0, 23517], [1, 'subspecies'], [2, 'Passeriformes'], [3, 'Pycnonotidae'],
    [5, 'Pycnonotus sinensis hainanus'], [19, 'avibase-XXXX1111'],
  ]),
]

describe('taxaFromRows', () => {
  const taxa = taxaFromRows(SAMPLE_ROWS)

  it('按 rank 分桶,展示行跳过', () => {
    expect(taxa.orders).toHaveLength(1)
    expect(taxa.families).toHaveLength(1)
    expect(taxa.genera).toHaveLength(1)
    expect(taxa.species).toHaveLength(2)
    expect(taxa.subspecies).toHaveLength(1)
  })

  it('species 条目字段完整(extinct→true、iucn、ebirdCode、avibaseId)', () => {
    const [p, c] = taxa.species
    expect(p).toMatchObject({
      rank: 'species', nameSci: 'Pycnonotus sinensis', order: 'Passeriformes', family: 'Pycnonotidae',
      familyEn: 'Bulbuls', nameEn: 'Light-vented Bulbul', iucn: 'LC', ebirdCode: 'livbul1',
      avibaseId: 'avibase-BB5650EB', extinct: null,
    })
    expect(c.extinct).toBe('Extinct')
    expect(c.iucn).toBe('EX')
  })

  it('缺 AvibaseID 直接抛错(骨架主键不允许空)', () => {
    const bad = [HEADER, row([[1, 'species'], [5, 'Nomen nudum']])]
    expect(() => taxaFromRows(bad)).toThrow(/AvibaseID/)
  })

  it('缺必需列抛错', () => {
    expect(() => taxaFromRows([['Sequence', 'Foo']])).toThrow(/缺少必需列/)
  })
})

describe('学名匹配', () => {
  const idx = buildNameIndex(taxaFromRows(SAMPLE_ROWS))

  it('归一化:去括号注记、压空白、小写', () => {
    expect(normalizeSciName('  Pycnonotus   sinensis (Gmelin, JF) ')).toBe('pycnonotus sinensis')
  })

  it('物种行命中', () => {
    const { matches, misses } = matchSpecies([{ id: 'pycnonotus-sinensis', nameSci: 'Pycnonotus sinensis' }], idx)
    expect(misses).toHaveLength(0)
    expect(matches[0]).toEqual({ id: 'pycnonotus-sinensis', nameSci: 'Pycnonotus sinensis', taxonKey: 'avibase-BB5650EB', via: 'species' })
  })

  it('大小写/空白不敏感命中', () => {
    const { matches } = matchSpecies([{ id: 'x', nameSci: '  pycnonotus  SINENSIS ' }], idx)
    expect(matches).toHaveLength(1)
  })

  it('仅命中亚种行 → 取父种(via=subspecies)', () => {
    const { matches } = matchSpecies([{ id: 'x', nameSci: 'Pycnonotus sinensis hainanus' }], idx)
    expect(matches[0]).toMatchObject({ taxonKey: 'avibase-BB5650EB', via: 'subspecies' })
  })

  it('别名表命中(并入父种概念,via=alias)', () => {
    const idx2 = buildNameIndex(taxaFromRows([HEADER, row([[1, 'species'], [2, 'Passeriformes'], [3, 'Muscicapidae'], [5, 'Saxicola maurus'], [19, 'avibase-3380CFC5']])]))
    const { matches, misses } = matchSpecies([{ id: 'saxicola-stejnegeri', nameSci: 'Saxicola stejnegeri' }], idx2)
    expect(misses).toHaveLength(0)
    expect(matches[0]).toMatchObject({ taxonKey: 'avibase-3380CFC5', via: 'alias' })
  })

  it('未命中进 misses,不臆造', () => {
    const { misses } = matchSpecies([{ id: 'y', nameSci: 'Nomen dubium mysteriosus' }], idx)
    expect(misses).toEqual([{ id: 'y', nameSci: 'Nomen dubium mysteriosus' }])
  })
})
