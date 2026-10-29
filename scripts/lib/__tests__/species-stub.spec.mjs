import { describe, expect, it } from 'vitest'
import { keepTaxonKey } from '../species-stub.mjs'

describe('keepTaxonKey（定向重建保全 Avibase 概念键）', () => {
  it('新记录没算出 taxonKey → 沿用上一版（2026-10-29 三宝鸟事故）', () => {
    expect(keepTaxonKey({ taxonKey: null }, { taxonKey: 'avibase-924BAB9C' })).toBe('avibase-924BAB9C')
  })

  it('新记录算出 taxonKey → 以新值为准（允许上游纠正）', () => {
    expect(keepTaxonKey({ taxonKey: 'avibase-NEW' }, { taxonKey: 'avibase-OLD' })).toBe('avibase-NEW')
  })

  it('两边都没有 → null，不臆造', () => {
    expect(keepTaxonKey({}, {})).toBeNull()
  })

  it('没有上一版（首次采集）→ null', () => {
    expect(keepTaxonKey({}, null)).toBeNull()
  })

  it('新记录本身为空 → 退到上一版', () => {
    expect(keepTaxonKey(null, { taxonKey: 'avibase-7D3B961F' })).toBe('avibase-7D3B961F')
  })
})
