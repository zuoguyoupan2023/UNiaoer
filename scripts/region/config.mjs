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

/** 省级统计来源 */
export const GBIF_SOURCE = {
  key: 'gbif',
  name: 'GBIF occurrence search (facet=stateProvince)',
  url: 'https://www.gbif.org/',
  license: 'CC0/CC-BY/CC-BY-NC（逐条，见 GBIF 处理规则）',
  attribution: 'GBIF — https://www.gbif.org/ (occurrence records, CC0/CC-BY/CC-BY-NC)',
}
