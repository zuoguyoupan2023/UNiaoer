import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  _resetProvincesCache,
  loadCountryProvinces,
  loadProvincesIndex,
  loadSpeciesProvinces,
  provinceCount,
  provinceCoverage,
  provinceSecondLevelEnabled,
  provinceStats,
  provincesOf,
  PROVINCE_HIDDEN_COUNTRIES,
  speciesInProvince,
  type CountryProvinceShard,
  type ProvinceIndex,
} from '../provinces'

afterEach(() => {
  _resetProvincesCache()
  vi.unstubAllGlobals()
})

/** 索引：只有元数据 + 国家/省名（P1-6：不含 bySpecies） */
const index: ProvinceIndex = {
  schemaVersion: 1,
  generatedAt: '',
  method: '',
  sources: [],
  countries: ['CN'],
  byCountry: { CN: { 'CN-11': '北京市', 'CN-44': '广东省', 'CN-91': '中国香港' } },
  byCountryAlt: { CN: { 'CN-11': 'Beijing', 'CN-44': 'Guangdong', 'CN-91': 'Hong Kong, China' } },
}

/** 按国分片：物种 id → { 省码: 记录数 } */
const shard: CountryProvinceShard = {
  schemaVersion: 1,
  cc: 'CN',
  bySpecies: {
    a: { 'CN-11': 5, 'CN-44': 2 },
    b: { 'CN-44': 3 },
    c: { 'CN-91': 1 },
  },
}

describe('provincesOf（按 locale 取 zh / en 展示名，按名排序）', () => {
  it('zh 用 byCountry，en 用 byCountryAlt', () => {
    expect(provincesOf(index, 'CN').map((p) => p.name)).toEqual(['北京市', '广东省', '中国香港'])
    expect(provincesOf(index, 'CN', 'en').map((p) => p.name)).toEqual([
      'Beijing',
      'Guangdong',
      'Hong Kong, China',
    ])
  })
  it('无数据返回空', () => {
    expect(provincesOf(index, 'US')).toEqual([])
    expect(provincesOf(null, 'CN')).toEqual([])
  })
})

describe('provinceStats（每省鸟种数，供二级排序/展示）', () => {
  it('count = 该省有记录的物种数（只读该国分片）', () => {
    const stats = provinceStats(index, shard, 'CN')
    const by = Object.fromEntries(stats.map((s) => [s.code, s.count]))
    expect(by).toEqual({ 'CN-11': 1, 'CN-44': 2, 'CN-91': 1 })
  })
  it('分片缺失 → 省列表仍在（count 为 0，目录不塌）', () => {
    const stats = provinceStats(index, null, 'CN')
    expect(stats.map((s) => s.count)).toEqual([0, 0, 0])
  })
})

describe('provinceCoverage（P1-4B：低覆盖国要标注）', () => {
  it('有覆盖率就返回、没有就 null', () => {
    const withCov: ProvinceIndex = {
      ...index,
      coverage: {
        countries: 1,
        byCountry: {
          CN: { allRecords: 100, mappedRecords: 94, unmatchedRecords: 6, coverage: 0.94, rawNames: 3, mappedNames: 2, species: 2, cells: 4 },
        },
      },
    }
    expect(provinceCoverage(withCov, 'CN')).toBeCloseTo(0.94)
    expect(provinceCoverage(withCov, 'US')).toBeNull()
    expect(provinceCoverage(index, 'CN')).toBeNull()
    expect(provinceCoverage(null, 'CN')).toBeNull()
  })
})

describe('speciesInProvince / provinceCount', () => {
  it('该省物种集合与单条记录数', () => {
    expect([...speciesInProvince(shard, 'CN-44')].sort()).toEqual(['a', 'b'])
    expect(speciesInProvince(shard, '')).toEqual(new Set())
    expect(provinceCount(shard, 'a', 'CN-11')).toBe(5)
    expect(provinceCount(shard, 'a', 'CN-99')).toBe(0)
  })
})

/** 按 URL 分派的 fetch 桩（P1-6 分片加载路径） */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  const f = vi.fn<typeof fetch>().mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const hit = Object.entries(routes).find(([k]) => url.endsWith(k))
    if (!hit) return { ok: false, json: async () => null } as Response
    return { ok: true, json: async () => hit[1] } as Response
  }) as unknown as typeof fetch)
  vi.stubGlobal('fetch', f)
  return calls
}

const fullIndex: ProvinceIndex = {
  ...index,
  sharding: { dir: 'region-provinces', files: ['CN.json'], bytes: {}, maxBytes: 0, totalBytes: 0 },
  speciesSharding: {
    dir: 'region-species',
    bucketChars: 2,
    buckets: ['pa'],
    files: ['pa.json'],
    bytes: {},
    maxBytes: 0,
    totalBytes: 0,
  },
}

describe('P1-6 分片加载', () => {
  it('索引失效不重复请求（缓存）', async () => {
    const calls = stubFetch({ 'region-provinces/index.json': fullIndex })
    await loadProvincesIndex()
    await loadProvincesIndex()
    expect(calls.filter((u) => u.endsWith('index.json'))).toHaveLength(1)
  })

  it('按国懒加载：只读该国分片，同国只请求一次', async () => {
    const calls = stubFetch({
      'region-provinces/index.json': fullIndex,
      'region-provinces/CN.json': shard,
    })
    expect((await loadCountryProvinces('cn'))?.bySpecies.a).toEqual({ 'CN-11': 5, 'CN-44': 2 })
    await loadCountryProvinces('CN')
    expect(calls.filter((u) => u.endsWith('/CN.json'))).toHaveLength(1)
  })

  it('按物种前缀分桶：只读该物种所在的桶', async () => {
    const calls = stubFetch({
      'region-provinces/index.json': fullIndex,
      'region-species/pa.json': {
        schemaVersion: 1,
        bucket: 'pa',
        bySpecies: { 'passer-montanus': { CN: { 'CN-11': 7 } } },
      },
    })
    const s = await loadSpeciesProvinces('passer-montanus')
    expect(s?.bySpecies['passer-montanus']?.CN?.['CN-11']).toBe(7)
    expect(calls.some((u) => u.endsWith('region-species/pa.json'))).toBe(true)
  })

  it('索引缺失 → 返回 null（旧单文件已退役，不再回退）', async () => {
    stubFetch({})
    expect(await loadProvincesIndex()).toBeNull()
    expect(await loadCountryProvinces('CN')).toBeNull()
    expect(await loadSpeciesProvinces('passer-montanus')).toBeNull()
  })
})

describe('provinceSecondLevelEnabled（083：镇级/微型国收起二级入口）', () => {
  const idxWithSI: ProvinceIndex = {
    ...index,
    countries: ['CN', 'SI'],
    byCountry: { ...index.byCountry, SI: { 'SI-01': 'Občina Ajdovščina' } },
  }

  it('收起名单内的国家返回 false（数据不删，仅不提供 UI 入口）', () => {
    for (const cc of ['SI', 'LV', 'MK', 'MT', 'SG', 'NR', 'TV', 'KI', 'MH']) {
      expect(provinceSecondLevelEnabled(idxWithSI, cc)).toBe(false)
    }
  })

  it('名单外且有索引的国家返回 true；无索引返回 false', () => {
    expect(provinceSecondLevelEnabled(idxWithSI, 'CN')).toBe(true)
    expect(provinceSecondLevelEnabled(idxWithSI, 'US')).toBe(false)
    expect(provinceSecondLevelEnabled(null, 'CN')).toBe(false)
  })

  it('大小写与空白宽容；PROVINCE_HIDDEN_COUNTRIES 是 9 国（防手滑增删）', () => {
    expect(provinceSecondLevelEnabled(idxWithSI, ' si ')).toBe(false)
    expect([...PROVINCE_HIDDEN_COUNTRIES].sort()).toEqual(['KI', 'LV', 'MH', 'MK', 'MT', 'NR', 'SG', 'SI', 'TV'])
  })

  it('收起国家不改变 provincesOf（名字查表仍可用——物种页热力条依赖它）', () => {
    expect(provincesOf(idxWithSI, 'SI').length).toBe(1)
  })
})
