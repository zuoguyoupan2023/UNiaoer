import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, matchSubdivision, PROVINCE_TO_L1 } from '../adapters/iso3166.mjs'
import { PROVINCE_TO_L1 as L1 } from '../adapters/province-to-region.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))))

/**
 * 自包含夹具：PH 大区 / NP 7 省（补丁后）/ LK 9 省，不依赖 data-cache。
 * 名称即 subs.json 里的原文（displayName 前的形态）。
 */
const FIXTURE = {
  PH: {
    'PH-00': 'National Capital Region',
    'PH-01': 'Ilocos',
    'PH-02': 'Cagayan Valley',
    'PH-03': 'Central Luzon',
    'PH-05': 'Bicol',
    'PH-06': 'Western Visayas',
    'PH-07': 'Central Visayas',
    'PH-08': 'Eastern Visayas',
    'PH-09': 'Zamboanga Peninsula',
    'PH-10': 'Northern Mindanao',
    'PH-11': 'Davao',
    'PH-12': 'Soccsksargen',
    'PH-13': 'Caraga',
    'PH-14': 'Autonomous Region in Muslim Mindanao',
    'PH-15': 'Cordillera Administrative Region',
    'PH-40': 'Calabarzon',
    'PH-41': 'Mimaropa',
  },
  NP: {
    'NP-P1': 'Koshi',
    'NP-P2': 'Madhesh',
    'NP-P3': 'Bagmati',
    'NP-P4': 'Gandaki',
    'NP-P5': 'Lumbini',
    'NP-P6': 'Karnali',
    'NP-P7': 'Sudurpashchim',
  },
  LK: {
    'LK-1': 'Western Province',
    'LK-2': 'Central Province',
    'LK-3': 'Southern Province',
    'LK-4': 'Northern Province',
    'LK-5': 'Eastern Province',
    'LK-6': 'North Western Province',
    'LK-7': 'North Central Province',
    'LK-8': 'Uva Province',
    'LK-9': 'Sabaragamuwa Province',
  },
}

const idx = buildIndex(FIXTURE)

describe('province-to-region 二次映射（081 §6.1）', () => {
  it('PH：省名 → 大区', () => {
    expect(matchSubdivision(idx, 'PH', 'Palawan')).toBe('PH-41')
    expect(matchSubdivision(idx, 'PH', 'Bataan')).toBe('PH-03')
    expect(matchSubdivision(idx, 'PH', 'Compostela Valley')).toBe('PH-11') // Davao de Oro 旧名
    expect(matchSubdivision(idx, 'PH', 'North Cotabato')).toBe('PH-12')
    expect(matchSubdivision(idx, 'PH', 'Western Samar')).toBe('PH-08')
    expect(matchSubdivision(idx, 'PH', 'Occ. Mindoro')).toBe('PH-41')
    expect(matchSubdivision(idx, 'PH', 'Kalinga-Apayao')).toBe('PH-15') // 旧合并省两半同区
  })

  it('PH：保护键先于裸名命中（Quezon City≠Quezon、Isabela City≠Isabela）', () => {
    expect(matchSubdivision(idx, 'PH', 'Quezon City')).toBe('PH-00')
    expect(matchSubdivision(idx, 'PH', 'Quezon')).toBe('PH-40')
    expect(matchSubdivision(idx, 'PH', 'Isabela City')).toBe('PH-14')
    expect(matchSubdivision(idx, 'PH', 'Isabela')).toBe('PH-02')
  })

  it('PH：岛名只在「岛=单省 / 岛群同属一个区」时映射，跨区岛名拒绝', () => {
    expect(matchSubdivision(idx, 'PH', 'Panay')).toBe('PH-06') // 4 省同属 Western Visayas
    expect(matchSubdivision(idx, 'PH', 'Samar Island')).toBe('PH-08') // 3 省同属 Eastern Visayas
    expect(matchSubdivision(idx, 'PH', 'Batan Islands')).toBe('PH-02') // Batanes 省属岛
    expect(matchSubdivision(idx, 'PH', 'Cagayan Sulu Islands')).toBe('PH-14') // = Mapun，不是 Cagayan
    // 跨区岛名：不映射（宁缺勿错）
    expect(matchSubdivision(idx, 'PH', 'Luzon')).toBe(null)
    expect(matchSubdivision(idx, 'PH', 'Mindanao')).toBe(null)
    expect(matchSubdivision(idx, 'PH', 'Negros')).toBe(null)
    expect(matchSubdivision(idx, 'PH', 'Mindoro')).toBe(null)
    expect(matchSubdivision(idx, 'PH', 'Sulu Archipelago')).toBe(null)
    expect(matchSubdivision(idx, 'PH', 'Palawan/Quezon')).toBe(null)
  })

  it('PH：一级区名本身仍直接命中（不经过省映射）', () => {
    expect(matchSubdivision(idx, 'PH', 'Central Visayas')).toBe('PH-07')
    expect(matchSubdivision(idx, 'PH', 'Mimaropa')).toBe('PH-41')
    expect(matchSubdivision(idx, 'PH', 'Bangsamoro Autonomous Region in Muslim Mindanao')).toBe('PH-14')
  })

  it('NP：新 7 省 + 旧专区 1:1 者收、跨省者拒', () => {
    expect(matchSubdivision(idx, 'NP', 'Bagmati')).toBe('NP-P3')
    expect(matchSubdivision(idx, 'NP', 'Province 1')).toBe('NP-P1') // = Koshi
    expect(matchSubdivision(idx, 'NP', 'Province #5')).toBe('NP-P5') // = Lumbini
    expect(matchSubdivision(idx, 'NP', 'Sudurpaschim')).toBe('NP-P7') // GBIF 拼写少 h
    expect(matchSubdivision(idx, 'NP', 'Kosi')).toBe('NP-P1')
    expect(matchSubdivision(idx, 'NP', 'Kailali')).toBe('NP-P7') // 县
    expect(matchSubdivision(idx, 'NP', 'Dhaulagiri')).toBe('NP-P4') // 专区 3 县全在 P4
    expect(matchSubdivision(idx, 'NP', 'Far-Western')).toBe('NP-P7')
    // 1:N 的旧发展大区/专区：不映射
    expect(matchSubdivision(idx, 'NP', 'Central')).toBe(null)
    expect(matchSubdivision(idx, 'NP', 'West')).toBe(null)
    expect(matchSubdivision(idx, 'NP', 'Narayani')).toBe(null)
    expect(matchSubdivision(idx, 'NP', 'Bheri')).toBe(null)
    expect(matchSubdivision(idx, 'NP', 'Sagarmatha')).toBe(null)
  })

  it('LK：县 → 省；国名当省名与存疑名拒绝', () => {
    expect(matchSubdivision(idx, 'LK', 'Colombo')).toBe('LK-1')
    expect(matchSubdivision(idx, 'LK', 'Hambantota')).toBe('LK-3')
    expect(matchSubdivision(idx, 'LK', 'Mullaittivu')).toBe('LK-4')
    expect(matchSubdivision(idx, 'LK', 'Mullaitivu')).toBe('LK-4')
    expect(matchSubdivision(idx, 'LK', 'Kegalla')).toBe('LK-9')
    expect(matchSubdivision(idx, 'LK', 'Moneragala')).toBe('LK-8')
    expect(matchSubdivision(idx, 'LK', 'Nuwara Eliya')).toBe('LK-2')
    expect(matchSubdivision(idx, 'LK', 'Western Province')).toBe('LK-1') // 一级区直配
    // 宁缺勿错
    expect(matchSubdivision(idx, 'LK', 'Nuwara')).toBe(null)
    expect(matchSubdivision(idx, 'LK', 'Sri Lanka')).toBe(null)
    expect(matchSubdivision(idx, 'LK', 'North Eastern Province')).toBe(null)
  })

  it('映射表 value 全部指向真实区划码（夹具 + 有 data-cache 时的全量 subs.json）', () => {
    // buildIndex 对夹具校验通过即说明映射与现行 7 省/9 省一致
    expect(() => buildIndex(FIXTURE)).not.toThrow()
    const subsPath = path.join(ROOT, 'data-cache/region/iso3166-2/subs.json')
    if (!fs.existsSync(subsPath)) return // CI 无 data-cache，跳过
    const subs = JSON.parse(fs.readFileSync(subsPath, 'utf8')).subdivisions
    // NP 必须已是补丁后的 7 省（否则 buildIndex 会因 NP-P1..P7 不存在而抛错）
    expect(Object.keys(subs.NP).sort()).toEqual(['NP-P1', 'NP-P2', 'NP-P3', 'NP-P4', 'NP-P5', 'NP-P6', 'NP-P7'])
    expect(() => buildIndex(subs, ['PH', 'NP', 'LK'])).not.toThrow()
    // 二次导出与 iso3166.mjs 转出口一致（防止有人只改一处）
    expect(L1).toBe(PROVINCE_TO_L1)
  })

  it('跨国家互不串扰：映射 key 只对本国生效', () => {
    // 'kandy' 在 LK 映射里，但 PH 查询不得命中
    expect(matchSubdivision(idx, 'PH', 'Kandy')).toBe(null)
    expect(matchSubdivision(idx, 'NP', 'Colombo')).toBe(null)
  })
})
