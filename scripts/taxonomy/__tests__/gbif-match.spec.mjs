/**
 * 023 P1-b:GBIF backbone v2 批量 match 纯函数单测。
 */
import { describe, expect, it } from 'vitest'
import { parseMatchBatch, pickBackboneKey } from '../gbif-match-lib.mjs'

describe('pickBackboneKey', () => {
  it('种级 ACCEPTED → usage.key', () => {
    const m = { usage: { key: '2486150', rank: 'SPECIES', status: 'ACCEPTED', canonicalName: 'Pycnonotus sinensis' }, diagnostics: { matchType: 'EXACT' }, synonym: false }
    expect(pickBackboneKey(m)).toEqual({ key: 2486150, via: 'species' })
  })

  it('同异名 → acceptedUsage.key', () => {
    const m = { usage: { key: '111', rank: 'SPECIES', status: 'SYNONYM', canonicalName: 'Old name' }, acceptedUsage: { key: '2482515', canonicalName: 'Corvus corone' }, diagnostics: { matchType: 'EXACT' }, synonym: true }
    expect(pickBackboneKey(m)).toEqual({ key: 2482515, via: 'accepted' })
  })

  it('亚种 rank → 接受种键', () => {
    const m = { usage: { key: '222', rank: 'SUBSPECIES' }, acceptedUsage: { key: '333' }, diagnostics: { matchType: 'EXACT' }, synonym: false }
    expect(pickBackboneKey(m)).toEqual({ key: 333, via: 'accepted' })
  })

  it('NONE / HIGHERRANK / GENUS 不臆造', () => {
    expect(pickBackboneKey({ diagnostics: { matchType: 'NONE' }, synonym: false }).key).toBeNull()
    expect(pickBackboneKey({ usage: { key: '9', rank: 'GENUS' }, diagnostics: { matchType: 'HIGHERRANK' }, synonym: false }).via).toBe('unmatched:HIGHERRANK')
    expect(pickBackboneKey(undefined).key).toBeNull()
  })
})

describe('parseMatchBatch', () => {
  const names = ['Pycnonotus sinensis', 'Nonsense nonsense', 'Corvus corone']
  const results = [
    { usage: { key: '2486150', rank: 'SPECIES', canonicalName: 'Pycnonotus sinensis' }, diagnostics: { matchType: 'EXACT' }, synonym: false },
    { diagnostics: { matchType: 'NONE' }, synonym: false },
    { usage: { key: '2482515', rank: 'SPECIES', canonicalName: 'Corvus corone' }, diagnostics: { matchType: 'EXACT' }, synonym: false },
  ]

  it('按请求顺序对齐解析', () => {
    const { byName, mismatches } = parseMatchBatch(names, results)
    expect(byName['Pycnonotus sinensis']).toEqual({ key: 2486150, via: 'species' })
    expect(byName['Nonsense nonsense'].key).toBeNull()
    expect(byName['Corvus corone'].key).toBe(2482515)
    expect(mismatches).toEqual([])
  })

  it('正字法不一致记入 mismatches(不中断)', () => {
    const r2 = [...results]
    r2[0] = { ...r2[0], usage: { ...r2[0].usage, canonicalName: 'Pycnonotus xanthorrhous' } }
    const { mismatches } = parseMatchBatch(names, r2)
    expect(mismatches).toEqual([{ name: 'Pycnonotus sinensis', canonicalName: 'Pycnonotus xanthorrhous', key: 2486150 }])
  })

  it('结果数与请求数不对齐直接抛错', () => {
    expect(() => parseMatchBatch(names, results.slice(0, 2))).toThrow(/不对齐/)
  })
})
