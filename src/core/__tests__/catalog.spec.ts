import { describe, expect, it } from 'vitest'
import {
  letterAnchors,
  sortCatalogOrders,
  sortKeyOf,
  type CatalogOrder,
  type CatalogSpecies,
} from '../catalog'

function sp(over: Partial<CatalogSpecies> & { id: string }): CatalogSpecies {
  return { sci: over.id, image: true, audio: true, ...over } as CatalogSpecies
}

/** 两个目:雀形目(2 科) / 鸮形目(1 科),字段模拟构建期产物 */
const orders: CatalogOrder[] = [
  {
    sci: 'Strigiformes',
    zh: '鸮形目',
    families: [
      { sci: 'Strigidae', species: [sp({ id: 'bubo-bubo', sci: 'Bubo bubo', zh: '雕鸮', py: 'diaoxiao', cm: 3 })] },
    ],
  },
  {
    sci: 'Passeriformes',
    zh: '雀形目',
    families: [
      {
        sci: 'Hirundinidae',
        species: [
          sp({ id: 'hirundo-rustica', sci: 'Hirundo rustica', zh: '家燕', py: 'jiayan', cm: 1 }),
          sp({ id: 'delichon-dasypus', sci: 'Delichon dasypus', zh: '烟腹毛脚燕', py: 'yanfumaojiaoyan', cm: 4 }),
        ],
      },
      {
        sci: 'Paridae',
        species: [
          sp({ id: 'parus-minor', sci: 'Parus minor', zh: '远东山雀', py: 'yuandongshanque', cm: 2 }),
          sp({ id: 'unknown-zh', sci: 'Zeus birdus', en: 'Alpha Bird', cm: 5 }),
        ],
      },
    ],
  },
]

describe('sortCatalogOrders（031 D-031-2 名录排序）', () => {
  it('taxo:原引用返回,不复制不改序', () => {
    expect(sortCatalogOrders(orders, 'taxo')).toBe(orders)
  })

  it('pinyin:目内种按拼音键排序,无键回退英文名', () => {
    const out = sortCatalogOrders(orders, 'pinyin')
    const passer = out.find((o) => o.sci === 'Passeriformes')!
    const paridae = passer.families.find((f) => f.sci === 'Paridae')!
    // Alpha Bird(无 py) 排在 yuandongshanque 前 —— 与显示回退顺序一致
    expect(paridae.species.map((s) => s.id)).toEqual(['unknown-zh', 'parus-minor'])
    const hirundo = passer.families.find((f) => f.sci === 'Hirundinidae')!
    expect(hirundo.species.map((s) => s.id)).toEqual(['hirundo-rustica', 'delichon-dasypus'])
  })

  it('pinyin:科按科内首个种排序（山雀科「Alpha Bird」a 段在燕科 j 段前）', () => {
    const out = sortCatalogOrders(orders, 'pinyin')
    const passer = out.find((o) => o.sci === 'Passeriformes')!
    // 科顺序 = 科内首种位置,故列表在目内单调递增,字母跳转落点与渲染顺序一致
    expect(passer.families.map((f) => f.sci)).toEqual(['Paridae', 'Hirundinidae'])
  })

  it('common:档位升序,缺 cm 者排末位', () => {
    const out = sortCatalogOrders(orders, 'common')
    const passer = out.find((o) => o.sci === 'Passeriformes')!
    expect(passer.families[0]!.sci).toBe('Hirundinidae')
    expect(passer.families[0]!.species.map((s) => s.id)).toEqual(['hirundo-rustica', 'delichon-dasypus'])
    const paridae = passer.families.find((f) => f.sci === 'Paridae')!
    expect(paridae.species.map((s) => s.id)).toEqual(['parus-minor', 'unknown-zh'])
  })

  it('不修改输入（纯函数）', () => {
    const before = JSON.stringify(orders)
    sortCatalogOrders(orders, 'pinyin')
    sortCatalogOrders(orders, 'common')
    expect(JSON.stringify(orders)).toBe(before)
  })

  it('sortKeyOf 回退顺序:py → en → sci', () => {
    expect(sortKeyOf(sp({ id: 'a', zh: '家燕', py: 'jiayan' }))).toBe('jiayan')
    expect(sortKeyOf(sp({ id: 'b', en: 'Common Ostrich' }))).toBe('common ostrich')
    expect(sortKeyOf(sp({ id: 'C', sci: 'Corvus corax' }))).toBe('corvus corax')
  })
})

describe('letterAnchors（拼音视图字母跳转）', () => {
  it('每个字母取首个出现的种,按字母升序', () => {
    const sorted = sortCatalogOrders(orders, 'pinyin')
    const anchors = letterAnchors(sorted)
    expect(anchors.map(([l]) => l)).toEqual(['A', 'D', 'J', 'Y'])
    expect(anchors[0]![1]).toBe('unknown-zh') // A ← Alpha Bird
    expect(anchors[1]![1]).toBe('bubo-bubo') // D ← diaoxiao
  })

  it('空目录返回空数组', () => {
    expect(letterAnchors([])).toEqual([])
  })
})
