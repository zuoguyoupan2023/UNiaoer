/**
 * 023 P1-a:Wikidata 中文名查询纯函数单测(XML/JSON 内联构造,不依赖网络)。
 */
import { describe, expect, it } from 'vitest'
import { buildZhQuery, escapeSparqlString, parseEntitiesResults, parseZhResults, pickLabel, ZH_LANG_PRIORITY } from '../wikidata-lib.mjs'

describe('escapeSparqlString', () => {
  it('转义反斜杠与双引号', () => {
    expect(escapeSparqlString('a"b\\c')).toBe('a\\"b\\\\c')
  })
})

describe('buildZhQuery', () => {
  it('VALUES 精确匹配 + P171 父级 + zh 语言过滤', () => {
    const q = buildZhQuery(['Pycnonotus sinensis', 'Corvus corone'])
    expect(q).toContain('VALUES ?sci { "Pycnonotus sinensis" "Corvus corone" }')
    expect(q).toContain('wdt:P225')
    expect(q).toContain('wdt:P171')
    expect(q).toContain('LANG(?zhLabel) IN ("zh-cn","zh-hans","zh"')
  })
})

describe('pickLabel', () => {
  const SP = 'http://www.wikidata.org/entity/Q7432'
  const SUB = 'http://www.wikidata.org/entity/Q34740' // subspecies rank 举例

  it('属名匹配的候选优先(防跨纲同名误配)', () => {
    const cands = [
      { zh: '同名昆虫', lang: 'zh-cn', item: 'Q111', rank: SP, parentName: 'Beetleus' },
      { zh: '白头鹎', lang: 'zh-cn', item: 'Q777', rank: SP, parentName: 'Pycnonotus' },
    ]
    expect(pickLabel(cands, 'Pycnonotus sinensis')?.zh).toBe('白头鹎')
  })

  it('species rank 优先于亚种条目;同分 QID 小者优先', () => {
    const cands = [
      { zh: '亚种名', lang: 'zh', item: 'Q50', rank: SUB, parentName: 'Pycnonotus' },
      { zh: '白头鹎', lang: 'zh', item: 'Q40', rank: SP, parentName: 'Pycnonotus' },
    ]
    expect(pickLabel(cands, 'Pycnonotus sinensis')?.zh).toBe('白头鹎')
    const tie = [
      { zh: '旧', lang: 'zh', item: 'Q900', rank: SP, parentName: 'Pycnonotus' },
      { zh: '新', lang: 'zh', item: 'Q100', rank: SP, parentName: 'Pycnonotus' },
    ]
    expect(pickLabel(tie, 'Pycnonotus sinensis')?.zh).toBe('新')
  })

  it('语言优先级:zh-cn > zh-hans > zh > … > zh-hant', () => {
    const cands = [{ zh: '繁体', lang: 'zh-hant', item: 'Q1', rank: SP, parentName: 'Pycnonotus' }]
    expect(pickLabel(cands, 'Pycnonotus sinensis')).toMatchObject({ zh: '繁体', lang: 'zh-hant' })
    const multi = [
      { zh: '繁体', lang: 'zh-hant', item: 'Q1', rank: SP, parentName: 'Pycnonotus' },
      { zh: '简体', lang: 'zh-hans', item: 'Q1', rank: SP, parentName: 'Pycnonotus' },
    ]
    expect(pickLabel(multi, 'Pycnonotus sinensis')?.zh).toBe('简体')
    expect(ZH_LANG_PRIORITY[0]).toBe('zh-cn')
  })

  it('无父级信息时仍可取值(降级)', () => {
    const cands = [{ zh: '白头鹎', lang: 'zh', item: 'Q1', rank: SP, parentName: null }]
    expect(pickLabel(cands, 'Pycnonotus sinensis')?.zh).toBe('白头鹎')
  })
})

describe('parseZhResults', () => {
  const json = {
    results: {
      bindings: [
        {
          sci: { value: 'Pycnonotus sinensis' },
          item: { value: 'http://www.wikidata.org/entity/Q1074482' },
          rank: { value: 'http://www.wikidata.org/entity/Q7432' },
          parentName: { value: 'Pycnonotus' },
          zhLabel: { value: '白头鹎' },
          langCode: { value: 'zh' },
        },
        { sci: { value: 'NoLabelHere' }, item: { value: 'http://www.wikidata.org/entity/Q1' } },
      ],
    },
  }

  it('抽取命中项,缺失字段的绑定跳过', () => {
    const out = parseZhResults(json)
    expect(out['Pycnonotus sinensis']).toMatchObject({ zh: '白头鹎', lang: 'zh' })
    expect(out.NoLabelHere).toBeUndefined()
  })

  it('空结果安全', () => {
    expect(parseZhResults({ results: { bindings: [] } })).toEqual({})
    expect(parseZhResults(undefined)).toEqual({})
  })
})

describe('parseEntitiesResults(wbgetentities/specieswiki)', () => {
  const json = {
    entities: {
      Q1061015: {
        id: 'Q1061015',
        labels: { zh: { language: 'zh', value: '白头鹎' }, 'zh-hant': { language: 'zh-hant', value: '白頭鵯' } },
        sitelinks: { specieswiki: { title: 'Pycnonotus sinensis' } },
      },
      Q26198: {
        id: 'Q26198',
        labels: { 'zh-cn': { language: 'zh-cn', value: '小嘴乌鸦' } },
        sitelinks: { specieswiki: { title: 'Corvus_corone' } },
      },
      '-1': { missing: '' },
    },
  }

  it('按页面标题(下划线转空格)回 key,语言优先级生效,missing 跳过', () => {
    const out = parseEntitiesResults(json)
    expect(out['Pycnonotus sinensis']).toMatchObject({ zh: '白头鹎', lang: 'zh', item: 'Q1061015' })
    expect(out['Corvus corone']).toMatchObject({ zh: '小嘴乌鸦', lang: 'zh-cn' })
    expect(Object.keys(out)).toHaveLength(2)
  })

  it('有 title 无 labels / 无 title 有 labels 均跳过', () => {
    const j = {
      entities: {
        Q1: { id: 'Q1', sitelinks: { specieswiki: { title: 'Aa bb' } } },
        Q2: { id: 'Q2', labels: { zh: { language: 'zh', value: 'x' } } },
      },
    }
    expect(parseEntitiesResults(j)).toEqual({})
  })
})
