/**
 * 036 省份热力条（SpeciesProvinces）：排序、缩放、展开、铁律 6 标注。
 *
 * 铁律 6 是硬约束：港澳台必须渲染为「中国台湾／中国香港／中国澳门」，
 * 不得出现未加「中国」前缀的形式（英文 Taiwan, China / Hong Kong, China / Macao, China）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SpeciesProvinces from '@/components/SpeciesProvinces.vue'
import { _resetProvincesCache } from '@/core/provinces'

const provinces = {
  schemaVersion: 1,
  generatedAt: 'test',
  method: 'test fixture',
  sources: [{ key: 'gbif', name: 'GBIF', url: 'https://www.gbif.org/', license: 'CC0', attribution: 'GBIF' }],
  countries: ['CN', 'US'],
  byCountry: {
    CN: { 'CN-11': '北京市', 'CN-31': '上海市', 'CN-71': '中国台湾', 'CN-91': '中国香港' },
    US: { 'US-CA': 'California' },
  },
  bySpecies: {
    'sp-1': {
      CN: { 'CN-11': 18582, 'CN-31': 14965, 'CN-71': 3070, 'CN-91': 5585 },
      US: { 'US-CA': 120 },
    },
    'sp-empty': {},
  },
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(provinces), { status: 200 })),
  )
}

describe('省份热力条（036）', () => {
  beforeEach(() => {
    // 模块级缓存会把首次加载结果固化，换桩前必须清掉（与其他 core 模块测试同法）
    _resetProvincesCache()
    stubFetch()
  })

  it('按记录数降序，且渲染数值与省名', async () => {
    const w = mount(SpeciesProvinces, { props: { speciesId: 'sp-1' } })
    await flushPromises()
    const names = w.findAll('.bar-row .pname').map((e) => e.text())
    const nums = w.findAll('.bar-row .num').map((e) => e.text())
    expect(names.slice(0, 3)).toEqual(['北京市', '上海市', '中国香港'])
    expect(nums[0]).toBe('18,582')
  })

  it('铁律 6：港澳台显示「中国台湾／中国香港」（不得裸写台/港/澳）', async () => {
    const w = mount(SpeciesProvinces, { props: { speciesId: 'sp-1' } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('中国香港')
    expect(text).toContain('中国台湾')
    // 不得出现"台湾"紧跟非「中国」前缀的形态（简单反例检查）
    expect(text).not.toMatch(/(^|[^国])(台湾|香港|澳门)/)
  })

  it('条形长度为平方根缩放：最大值占满，小值仍可见（≥4%）', async () => {
    const w = mount(SpeciesProvinces, { props: { speciesId: 'sp-1' } })
    await flushPromises()
    const widths = w.findAll('.bar-row .fill').map((e) => {
      const style = e.attributes('style') ?? ''
      return Number.parseFloat(style.match(/width:\s*([\d.]+)%/)?.[1] ?? '0')
    })
    // 第一条 = 最大 → ~100%
    expect(widths[0]!).toBeGreaterThan(99)
    // 每条都 ≥4%（小值不被压没）
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(4)
    // 单调不增（与降序一致）
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThanOrEqual(widths[i - 1]!)
  })

  it('无省级数据时不渲染（全球池物种）', async () => {
    const w = mount(SpeciesProvinces, { props: { speciesId: 'sp-empty' } })
    await flushPromises()
    expect(w.find('.prov').exists()).toBe(false)
  })

  it('超过 8 条时显示「展开全部」，点击后全部展示', async () => {
    const many = {
      ...provinces,
      bySpecies: {
        'sp-many': { CN: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`CN-${i + 10}`, 100 - i])) },
      },
    }
    _resetProvincesCache()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(many), { status: 200 })))
    const w = mount(SpeciesProvinces, { props: { speciesId: 'sp-many' } })
    await flushPromises()
    expect(w.findAll('.bar-row')).toHaveLength(8)
    await w.find('.more').trigger('click')
    expect(w.findAll('.bar-row')).toHaveLength(12)
  })
})
