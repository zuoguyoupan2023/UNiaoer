import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  canonName,
  displayName,
  matchSubdivision,
  NAME_ALIASES,
  nameKeys,
} from '../adapters/iso3166.mjs'

const dataset = {
  US: { 'US-CA': 'California', 'US-WA': 'Washington', 'US-DC': 'District of Columbia' },
  GB: { 'GB-ENG': 'England', 'GB-SCT': 'Scotland', 'GB-NIR': 'Northern Ireland' },
  JP: { 'JP-13': 'Tōkyō [Tokyo]', 'JP-23': 'Aiti', 'JP-04': 'Miyagi' },
  CN: { 'CN-15': 'Nei Mongol (mn)\n(Inner Mongolia)', 'CN-54': 'Xizang\n(Tibet)' },
}

describe('canonName / nameKeys', () => {
  it('去变音符、小写、折叠分隔符', () => {
    expect(canonName('Tōkyō [Tokyo]')).toBe('tokyo tokyo')
    expect(canonName('  São Paulo ')).toBe('sao paulo')
  })
  it('展开方括号/圆括号/换行/感叹号为候选键', () => {
    const k = nameKeys('Tōkyō [Tokyo]')
    expect(k.has('tokyo')).toBe(true)
    expect(nameKeys('Xizang\n(Tibet)').has('tibet')).toBe(true)
    expect(nameKeys('Nei Mongol (mn)\n(Inner Mongolia)').has('inner mongolia')).toBe(true)
  })
  it('去行政后缀与逗号后注', () => {
    expect(nameKeys('Miyagi Prefecture').has('miyagi')).toBe(true)
    expect(nameKeys('Michigan, Captive').has('michigan')).toBe(true)
  })
})

describe('displayName', () => {
  it('优先方括号别名；否则去圆括号；多语言取首段', () => {
    expect(displayName('Tōkyō [Tokyo]')).toBe('Tokyo')
    expect(displayName('Xizang\n(Tibet)')).toBe('Xizang')
    expect(displayName('British Columbia ! Colombie-Britannique')).toBe('British Columbia')
    expect(displayName('Alabama')).toBe('Alabama')
  })
})

describe('buildIndex / matchSubdivision', () => {
  const index = buildIndex(dataset)
  it('精确名与缺省后缀匹配', () => {
    expect(matchSubdivision(index, 'US', 'California')).toBe('US-CA')
    expect(matchSubdivision(index, 'US', 'California (CA)')).toBe('US-CA')
    expect(matchSubdivision(index, 'JP', 'Tokyo')).toBe('JP-13')
    expect(matchSubdivision(index, 'JP', 'Miyagi Prefecture')).toBe('JP-04')
  })
  it('日本赫本式别名映射训令式 ISO', () => {
    expect(matchSubdivision(index, 'JP', 'Aichi')).toBe('JP-23')
    expect(matchSubdivision(index, 'JP', 'Shimane')).toBe('JP-32')
  })
  it('美国两位数缩写（含特区）', () => {
    expect(matchSubdivision(index, 'US', 'N.Y.')).toBeNull() // "N.Y." 折叠为 "n y"，不展开（不臆造）
    expect(matchSubdivision(index, 'US', 'New York State (NY)')).toBe('US-NY')
    expect(matchSubdivision(index, 'US', 'Washington, D.C.')).toBe('US-DC')
  })
  it('英国「郡 - 前缀」归入构成国', () => {
    expect(matchSubdivision(index, 'GB', 'Scotland - Highland')).toBe('GB-SCT')
    expect(matchSubdivision(index, 'GB', 'England - Norfolk')).toBe('GB-ENG')
  })
  it('未知名返回 null，不臆造', () => {
    expect(matchSubdivision(index, 'US', 'Atlantis')).toBeNull()
    expect(matchSubdivision(index, 'ZZ', 'California')).toBeNull()
  })
  it('别名表只映射到合法 code（防止张冠李戴）', () => {
    for (const [k, code] of Object.entries(NAME_ALIASES)) {
      expect(code, `alias ${k}`).toMatch(/^[A-Z]{2}-[A-Z0-9]+$/)
    }
  })
})
