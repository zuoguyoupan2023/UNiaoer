import { describe, expect, it } from 'vitest'
import { ANOMALY_MIN_RECORDS, ANOMALY_MIN_SHARE, findAnomalyIds } from '../regionAnomaly'

describe('core/regionAnomaly · 074 异常数据识别', () => {
  it('上海实测：三个鸻类各 ~25% → 命中，白头鹎 1% → 不命中', () => {
    // 数字取自 region-provinces.json（CN-31），按 1/100 缩放不影响份额判断
    const counts = new Map<string, number>([
      ['charadrius-atrifrons', 422770], // 青藏沙鸻
      ['charadrius-dealbatus', 422770], // 白脸鸻（与上一行计数完全相同 → 数据集痕迹）
      ['charadrius-mongolus', 421615], // 蒙古沙鸻
      ['pycnonotus-sinensis', 14965], // 白头鹎（当地真正最常见）
      ['spilopelia-chinensis', 14723],
      ['bubulcus-ibis', 12750],
    ])
    const ids = findAnomalyIds(counts)
    expect(ids.has('charadrius-atrifrons')).toBe(true)
    expect(ids.has('charadrius-dealbatus')).toBe(true)
    expect(ids.has('charadrius-mongolus')).toBe(true)
    expect(ids.has('pycnonotus-sinensis')).toBe(false)
  })

  it('全国口径同样命中三个（分母不同，各算各的）', () => {
    const counts = new Map<string, number>([
      ['charadrius-atrifrons', 5420063],
      ['charadrius-dealbatus', 5420063],
      ['charadrius-mongolus', 5407944],
      ['passer-montanus', 102215],
    ])
    expect(findAnomalyIds(counts).size).toBe(3)
  })

  it('小样本高份额不算异常（1 条 = 100% 属噪声，不是数据集主导）', () => {
    const counts = new Map<string, number>([
      ['fulica-americana', 1],
      ['other-a', 0],
    ])
    expect(findAnomalyIds(counts).size).toBe(0)
  })

  it('份额不到阈值不算异常（美国/澳洲那种 10–15% 的"最多"是正常规模）', () => {
    // 6 个规模相近的种：最大 20/105 ≈ 19% < 20% → 一个都不标
    const flat = new Map<string, number>([
      ['a', 20_000_000],
      ['b', 19_000_000],
      ['c', 18_000_000],
      ['d', 17_000_000],
      ['e', 16_000_000],
      ['f', 15_000_000],
    ])
    expect(findAnomalyIds(flat).size).toBe(0)
  })

  it('空数据 / 常量健全', () => {
    expect(findAnomalyIds(new Map()).size).toBe(0)
    expect(ANOMALY_MIN_RECORDS).toBe(10000)
    expect(ANOMALY_MIN_SHARE).toBeCloseTo(0.2)
  })
})
