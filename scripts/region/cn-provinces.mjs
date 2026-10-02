/**
 * 021 M3：中国 34 省级行政区官方清单（build 侧常量，check-region 硬校验用）。
 *
 * 敏感性（AGENTS 铁律 6）：港澳台在省级层单独列出，显示名必须是
 * 「中国香港／中国澳门／中国台湾」（英文 Hong Kong, China / Macao, China / Taiwan, China）；
 * 只做文本，不做任何地图/边界。code 沿用 ISO 3166-2:CN（CN-71/CN-91/CN-92）。
 */

export const CN_PROVINCES = [
  { code: 'CN-11', zh: '北京市', en: 'Beijing' },
  { code: 'CN-12', zh: '天津市', en: 'Tianjin' },
  { code: 'CN-13', zh: '河北省', en: 'Hebei' },
  { code: 'CN-14', zh: '山西省', en: 'Shanxi' },
  { code: 'CN-15', zh: '内蒙古自治区', en: 'Inner Mongolia' },
  { code: 'CN-21', zh: '辽宁省', en: 'Liaoning' },
  { code: 'CN-22', zh: '吉林省', en: 'Jilin' },
  { code: 'CN-23', zh: '黑龙江省', en: 'Heilongjiang' },
  { code: 'CN-31', zh: '上海市', en: 'Shanghai' },
  { code: 'CN-32', zh: '江苏省', en: 'Jiangsu' },
  { code: 'CN-33', zh: '浙江省', en: 'Zhejiang' },
  { code: 'CN-34', zh: '安徽省', en: 'Anhui' },
  { code: 'CN-35', zh: '福建省', en: 'Fujian' },
  { code: 'CN-36', zh: '江西省', en: 'Jiangxi' },
  { code: 'CN-37', zh: '山东省', en: 'Shandong' },
  { code: 'CN-41', zh: '河南省', en: 'Henan' },
  { code: 'CN-42', zh: '湖北省', en: 'Hubei' },
  { code: 'CN-43', zh: '湖南省', en: 'Hunan' },
  { code: 'CN-44', zh: '广东省', en: 'Guangdong' },
  { code: 'CN-45', zh: '广西壮族自治区', en: 'Guangxi' },
  { code: 'CN-46', zh: '海南省', en: 'Hainan' },
  { code: 'CN-50', zh: '重庆市', en: 'Chongqing' },
  { code: 'CN-51', zh: '四川省', en: 'Sichuan' },
  { code: 'CN-52', zh: '贵州省', en: 'Guizhou' },
  { code: 'CN-53', zh: '云南省', en: 'Yunnan' },
  { code: 'CN-54', zh: '西藏自治区', en: 'Xizang' },
  { code: 'CN-61', zh: '陕西省', en: 'Shaanxi' },
  { code: 'CN-62', zh: '甘肃省', en: 'Gansu' },
  { code: 'CN-63', zh: '青海省', en: 'Qinghai' },
  { code: 'CN-64', zh: '宁夏回族自治区', en: 'Ningxia' },
  { code: 'CN-65', zh: '新疆维吾尔自治区', en: 'Xinjiang' },
  { code: 'CN-71', zh: '中国台湾', en: 'Taiwan, China' },
  { code: 'CN-91', zh: '中国香港', en: 'Hong Kong, China' },
  { code: 'CN-92', zh: '中国澳门', en: 'Macao, China' },
]

/** 港澳台：显示名硬校验锚点（check-region 用） */
export const CN_SENSITIVE = {
  'CN-71': { zh: '中国台湾', en: 'Taiwan, China' },
  'CN-91': { zh: '中国香港', en: 'Hong Kong, China' },
  'CN-92': { zh: '中国澳门', en: 'Macao, China' },
}

/** 港澳台对应的 GBIF 独立国家码（记录层以 distribution.json 存在性并入，count=1） */
export const CN_SPECIAL_COUNTRY = { TW: 'CN-71', HK: 'CN-91', MO: 'CN-92' }
