/**
 * 051 S2：生活型六分法台账的行为约定。
 * 核心：**有出处才生效；被质疑即失效；查不到就留空（返回 null），绝不推断。**
 */
import { describe, it, expect } from 'vitest'
import {
  GROUP6,
  buildClassTable,
  checkRecord,
  resolveGroup6,
  type ClassRecord,
} from '../../../scripts/lib/class-taxonomy.mjs'

const ok = (over: Partial<ClassRecord> = {}): ClassRecord => ({
  familySci: 'Ardeidae',
  groups: ['wader'],
  source: { type: 'handbook', ref: '中国鸟类观察手册 1999' },
  status: 'ok',
  ...over,
})

describe('生活型台账（051 S2）', () => {
  it('六值固定为 水/涉/林/猛/攀/陆', () => {
    expect([...GROUP6]).toEqual(['swimmer', 'wader', 'woodland', 'raptor', 'climber', 'terrestrial'])
  })

  it('无 source → 不生效（问题列表非空，live=false）', () => {
    const r = checkRecord({ familySci: 'X', groups: ['wader'] })
    expect(r.live).toBe(false)
    expect(r.issues.join()).toContain('source')
  })

  it('source 只有 type 没有 ref/url → 不生效', () => {
    expect(checkRecord({ familySci: 'X', groups: ['wader'], source: { type: 'manual' } }).live).toBe(false)
  })

  it('status=disputed → 不生效（被用户挑错即失效）', () => {
    expect(checkRecord(ok({ status: 'disputed' })).live).toBe(false)
  })

  it('非法 groups 值 → 不生效', () => {
    expect(checkRecord(ok({ groups: ['dinosaur'] })).live).toBe(false)
  })

  it('一个科可跨类（鹭科既能游又能涉）', () => {
    const t = buildClassTable([ok({ groups: ['wader', 'swimmer'] })])
    expect(resolveGroup6(t, { familySci: 'Ardeidae', orderSci: 'Ciconiiformes' })?.groups).toEqual(['wader', 'swimmer'])
  })

  it('科优先、目兜底', () => {
    const t = buildClassTable([ok({ familySci: 'Ardeidae', groups: ['wader'] }), ok({ familySci: '', orderSci: 'Gruiformes', groups: ['wader'] })])
    expect(resolveGroup6(t, { familySci: 'Ardeidae', orderSci: 'Ciconiiformes' })?.groups).toEqual(['wader'])
    expect(resolveGroup6(t, { familySci: 'Unknownidae', orderSci: 'Gruiformes' })?.groups).toEqual(['wader'])
  })

  it('查不到 → 返回 null（UI 不显示，而不是兜底成"林鸟"）', () => {
    const t = buildClassTable([ok()])
    expect(resolveGroup6(t, { familySci: 'Unknownidae', orderSci: 'Unknowniformes' })).toBeNull()
  })

  it('空台账 → 什么都不生效（初始状态）', () => {
    const t = buildClassTable([])
    expect(resolveGroup6(t, { familySci: 'Ardeidae', orderSci: 'Ciconiiformes' })).toBeNull()
  })
})
