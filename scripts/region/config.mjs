/**
 * 021 M2 地区省级层共享常量（build / check / fetch 共用，避免各写各的）。
 */

/** 省级层支持的国家（M3 起 CN 并入：GBIF 记录层 + 34 官方区划常量，见 cn-provinces.mjs） */
export const SUPPORTED_COUNTRIES = [
  'CN', 'US', 'CA', 'AU', 'NZ', 'GB', 'IE', 'JP', 'DE', 'FR', 'ES', 'IT', 'NL', 'IN', 'VN',
]

/** 省级 code/名称基准数据集（用户 2026-10-02 决定：先 ISO 3166-2，eBird 后补） */
export const SUBDIVISION_SOURCE = {
  key: 'iso3166-2',
  name: 'ISO 3166-2 subdivisions',
  url: 'https://github.com/alexander-schranz/iso-3166-2',
  license: 'MIT',
  attribution: 'ISO 3166-2 subdivision codes/names — alexander-schranz/iso-3166-2 (MIT)',
}

/** 021 M4 腿 B：GBIF 按国家分页抓「带坐标的 Aves 观测」→ 网格聚合观鸟点。 */
export const GBIF_AVES_TAXON_KEY = 212
export const HOTSPOT_DEFAULTS = {
  grid: 0.1,
  /** 2026-10-02 实测（XC 源）：3/2/2→1524 点、5/3/3→549 点、10/5/3→249 点；取 5/3/3 平衡厚薄 */
  minRecords: 5,
  minSpecies: 3,
  minObservers: 3,
  maxPages: 10,
  pageSize: 300,
  /** 近 N 年（仅取近年记录，反映活跃观鸟点；GBIF `year` 支持 a,b 区间） */
  years: 5,
}

/** Xeno-canto 录音（本地缓存坐标，021 M4 腿 B 的离线坐标源） */
export const XC_SOURCE = {
  key: 'xeno-canto',
  name: 'Xeno-canto',
  url: 'https://xeno-canto.org/',
  license: 'CC0 / CC-BY / CC-BY-NC / CC-BY-NC-SA（逐条，见录音页）',
  attribution: 'Xeno-canto — https://xeno-canto.org/ (recordings, various CC licenses)',
}

/** XC `cnt`（国家英文名）→ ISO 3166-1 alpha-2；只映射本项目支持国 + 港澳台（其余丢弃，不臆造） */
export const XC_COUNTRY_ISO = {
  China: 'CN',
  'Hong Kong': 'HK',
  Macao: 'MO',
  Macau: 'MO',
  Taiwan: 'TW',
  'United States': 'US',
  'United States of America': 'US',
  Canada: 'CA',
  Australia: 'AU',
  'New Zealand': 'NZ',
  'United Kingdom': 'GB',
  Ireland: 'IE',
  Japan: 'JP',
  Germany: 'DE',
  France: 'FR',
  Spain: 'ES',
  Italy: 'IT',
  Netherlands: 'NL',
  India: 'IN',
  Vietnam: 'VN',
  'Viet Nam': 'VN',
}

/** 省级统计来源 */
export const GBIF_SOURCE = {
  key: 'gbif',
  name: 'GBIF occurrence search (facet=stateProvince)',
  url: 'https://www.gbif.org/',
  license: 'CC0/CC-BY/CC-BY-NC（逐条，见 GBIF 处理规则）',
  attribution: 'GBIF — https://www.gbif.org/ (occurrence records, CC0/CC-BY/CC-BY-NC)',
}
