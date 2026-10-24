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

  SE: {
    'SE-AB': 'Stockholms län',
    'SE-C': 'Uppsala län',
    'SE-D': 'Södermanlands län',
    'SE-E': 'Östergötlands län',
    'SE-F': 'Jönköpings län',
    'SE-G': 'Kronobergs län',
    'SE-H': 'Kalmar län',
    'SE-I': 'Gotlands län',
    'SE-K': 'Blekinge län',
    'SE-M': 'Skåne län',
    'SE-N': 'Hallands län',
    'SE-O': 'Västra Götalands län',
    'SE-S': 'Värmlands län',
    'SE-T': 'Örebro län',
    'SE-U': 'Västmanlands län',
    'SE-W': 'Dalarnas län',
    'SE-X': 'Gävleborgs län',
    'SE-Y': 'Västernorrlands län',
    'SE-Z': 'Jämtlands län',
    'SE-AC': 'Västerbottens län',
    'SE-BD': 'Norrbottens län',
  },
  NO: {
    'NO-03': 'Oslo',
    'NO-11': 'Rogaland',
    'NO-15': 'Møre og Romsdal',
    'NO-18': 'Nordland',
    'NO-30': 'Viken',
    'NO-34': 'Innlandet',
    'NO-38': 'Vestfold og Telemark',
    'NO-42': 'Agder',
    'NO-46': 'Vestland',
    'NO-50': 'Trøndelag',
    'NO-54': 'Troms og Finnmark',
    'NO-21': 'Svalbard',
    'NO-22': 'Jan Mayen',
  },
  FI: {
    'FI-01': 'Åland',
    'FI-02': 'South Karelia',
    'FI-03': 'Southern Ostrobothnia',
    'FI-04': 'Southern Savonia',
    'FI-05': 'Kainuu',
    'FI-06': 'Tavastia Proper',
    'FI-07': 'Central Ostrobothnia',
    'FI-08': 'Central Finland',
    'FI-09': 'Kymenlaakso',
    'FI-10': 'Lapland',
    'FI-11': 'Pirkanmaa',
    'FI-12': 'Ostrobothnia',
    'FI-13': 'North Karelia',
    'FI-14': 'Northern Ostrobothnia',
    'FI-15': 'Northern Savonia',
    'FI-16': 'Päijänne Tavastia',
    'FI-17': 'Satakunta',
    'FI-18': 'Uusimaa',
    'FI-19': 'Southwest Finland',
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
    // NO 必须已是现行 ISO 合并县口径（2020 合并后；NO-30 Viken 等）
    expect(subs.NO['NO-30']).toBe('Viken')
    expect(subs.NO['NO-54']).toBe('Troms og Finnmark')
    expect(() => buildIndex(subs, ['PH', 'NP', 'LK', 'SE', 'NO', 'FI'])).not.toThrow()
    // 二次导出与 iso3166.mjs 转出口一致（防止有人只改一处）
    expect(L1).toBe(PROVINCE_TO_L1)
  })

  it('跨国家互不串扰：映射 key 只对本国生效', () => {
    // 'kandy' 在 LK 映射里，但 PH 查询不得命中
    expect(matchSubdivision(idx, 'PH', 'Kandy')).toBe(null)
    expect(matchSubdivision(idx, 'NP', 'Colombo')).toBe(null)
  })

  it('SE：N:1 landskap 收、1:N landskap 与不一致字母组合拒', () => {
    expect(matchSubdivision(idx, 'SE', 'Skåne')).toBe('SE-M')
    expect(matchSubdivision(idx, 'SE', 'Öland')).toBe('SE-H')
    expect(matchSubdivision(idx, 'SE', 'Bohuslän')).toBe('SE-O')
    expect(matchSubdivision(idx, 'SE', 'Lycksele lappmark')).toBe('SE-AC')
    expect(matchSubdivision(idx, 'SE', 'Stockholm')).toBe('SE-AB')
    expect(matchSubdivision(idx, 'SE', 'H, Öland')).toBe('SE-H') // 字母=Kalmar，与 Öland 一致
    expect(matchSubdivision(idx, 'SE', 'G, Småland')).toBe('SE-G') // Småland 跨 F/G/H，字母消歧
    expect(matchSubdivision(idx, 'SE', 'AC län, Lycksele lappmark')).toBe('SE-AC')
    expect(matchSubdivision(idx, 'SE', 'V Götalands län, Bohuslän')).toBe('SE-O')
    // 1:N：不映射
    expect(matchSubdivision(idx, 'SE', 'Uppland')).toBe(null)
    expect(matchSubdivision(idx, 'SE', 'Västergötland')).toBe(null)
    expect(matchSubdivision(idx, 'SE', 'Småland')).toBe(null)
    expect(matchSubdivision(idx, 'SE', 'Närke')).toBe(null)
    expect(matchSubdivision(idx, 'SE', 'Lappland')).toBe(null)
    // 字母与 landskap 归属不一致：不收
    expect(matchSubdivision(idx, 'SE', 'B, Södermanland')).toBe(null)
    expect(matchSubdivision(idx, 'SE', 'T, Värmland')).toBe(null)
  })

  it('NO：现行 ISO 合并县 + 旧县 N:1 归并（含 mojibake 与 Fylke 变体）', () => {
    // 现行 ISO 名直配
    expect(matchSubdivision(idx, 'NO', 'Viken')).toBe('NO-30')
    expect(matchSubdivision(idx, 'NO', 'Vestfold og Telemark')).toBe('NO-38')
    expect(matchSubdivision(idx, 'NO', 'Troms og Finnmark')).toBe('NO-54')
    // 2020 前旧县 → 合并县
    expect(matchSubdivision(idx, 'NO', 'Akershus')).toBe('NO-30')
    expect(matchSubdivision(idx, 'NO', 'Østfold')).toBe('NO-30')
    expect(matchSubdivision(idx, 'NO', 'Oppland')).toBe('NO-34')
    expect(matchSubdivision(idx, 'NO', 'Telemark')).toBe('NO-38')
    expect(matchSubdivision(idx, 'NO', 'Sør-Trøndelag')).toBe('NO-50')
    expect(matchSubdivision(idx, 'NO', 'Hordaland')).toBe('NO-46')
    expect(matchSubdivision(idx, 'NO', 'Troms / Romsa')).toBe('NO-54')
    // 变体
    expect(matchSubdivision(idx, 'NO', 'Ãstfold')).toBe('NO-30') // mojibake
    expect(matchSubdivision(idx, 'NO', 'Sør-Trøndelag Fylke')).toBe('NO-50')
    expect(matchSubdivision(idx, 'NO', 'Spitsbergen')).toBe('NO-21')
    // 未合并县仍直配；市镇名/海域不收
    expect(matchSubdivision(idx, 'NO', 'Møre og Romsdal')).toBe('NO-15')
    expect(matchSubdivision(idx, 'NO', 'Bergen')).toBe(null)
    expect(matchSubdivision(idx, 'NO', 'Norskekysten hav S')).toBe(null)
  })

  it('指向已退役区划码的旧别名自动失效（aliases-auto 按旧数据集生成）', () => {
    // aliases-auto.mjs 里有 "finnmark": "NO-20"（旧 Finnmárku 码，现行数据集已无 NO-20）；
    // 别名不得命中退役码，应落到 province-to-region 的 NO-54
    expect(FIXTURE.NO['NO-20']).toBeUndefined()
    expect(matchSubdivision(idx, 'NO', 'Finnmark / Finnmárku')).toBe('NO-54')
    expect(matchSubdivision(idx, 'NO', 'Finnmark')).toBe('NO-54')
  })

  it('FI：芬兰语区名归一到数据集英文码；旧 lääni 1:N 拒', () => {
    expect(matchSubdivision(idx, 'FI', 'Varsinais-Suomi')).toBe('FI-19')
    expect(matchSubdivision(idx, 'FI', 'Pohjois-Pohjanmaa')).toBe('FI-14')
    expect(matchSubdivision(idx, 'FI', 'Lappi')).toBe('FI-10')
    expect(matchSubdivision(idx, 'FI', 'Kanta-Häme')).toBe('FI-06')
    expect(matchSubdivision(idx, 'FI', 'Pohjanmaa')).toBe('FI-12')
    expect(matchSubdivision(idx, 'FI', 'Keski-Pohjanmaa')).toBe('FI-07') // 不与裸 Pohjanmaa 冲突
    expect(matchSubdivision(idx, 'FI', 'Ahvenanmaa')).toBe('FI-01')
    expect(matchSubdivision(idx, 'FI', 'Nyland')).toBe('FI-18') // Uusimaa 瑞典语
    expect(matchSubdivision(idx, 'FI', 'Uusimaa')).toBe('FI-18') // 数据集英文名直配
    // 旧 lääni / 大区划：不映射
    expect(matchSubdivision(idx, 'FI', 'Vaasa')).toBe(null)
    expect(matchSubdivision(idx, 'FI', 'TURKU-PORI')).toBe(null)
    expect(matchSubdivision(idx, 'FI', 'Häme')).toBe(null)
    expect(matchSubdivision(idx, 'FI', 'Southern Finland')).toBe(null)
    expect(matchSubdivision(idx, 'FI', 'Regional State Administrative Agency for Northern Finland')).toBe(null)
  })
})
