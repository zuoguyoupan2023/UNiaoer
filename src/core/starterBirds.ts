/**
 * 新手福利（2026-10-09 用户定稿）：**第一轮 L1** 限定在"人人都认识的最常见鸟"池。
 *
 * 动机：新手第一次答题，若按 L1 的全局 1–2 档抽，仍可能抽到当地并不眼熟的中等常见鸟；
 * 首轮应固定为「喜鹊、麻雀、乌鸦、白头鹎、白鹭、夜鹭…」这类**标志性常见鸟**，
 * 让第一次体验尽可能简单——只有首轮 + L1 生效，之后不再干预（"爱挑战的去挑战"）。
 *
 * 关键设计（不违背整体逻辑）：
 *  1. **不新增出题通道**：本池只是 buildQuestions 的一个**前置候选过滤**，
 *     后面照常走「地区档位 → 题型媒体 → 轮内去重」既有链路；
 *  2. **地域自适应**：同一"角色"按大区分设条目（喜鹊：东亚 pica-serica / 欧洲 pica-pica；
 *     麻雀：passer-montanus / passer-domesticus；乌鸦：corvus-macrorhynchus / corvus-corone …），
 *     再交给**地区档位/区系**过滤——俄罗斯不会出鹦鹉、甘肃不会出"海鸥"，
 *     因为那些物种不在当地档位表内（2026-10-09 的排除式语义，见 docs/036 §10）。
 *  3. **绝不出空**：池内候选不足以出满一轮时，**回退常规 L1 逻辑**（见 questionEngine）。
 *
 * 选入标准：全球/中国"人人见过"级 + 核心库有 5 图 5 音（可直接出题）+ 覆盖各大区的同类近缘种。
 */

/** 新手池物种 id（全部为核心库 1299 条目，均有多图多音；数据核对见 docs/038 §8） */
export const STARTER_BIRD_IDS: ReadonlySet<string> = new Set([
  // 鹊 / 鸦类
  'pica-serica', // 喜鹊（东亚）
  'pica-pica', // 喜鹊（欧洲）
  'pica-hudsonia', // 美洲喜鹊
  'cyanopica-cyanus', // 灰喜鹊
  'corvus-macrorhynchos', // 大嘴乌鸦（东亚）
  'corvus-corone', // 冠小嘴乌鸦（欧洲）
  'corvus-brachyrhynchos', // 短嘴鸦（北美）
  'corvus-frugilegus', // 秃鼻乌鸦
  'corvus-cornix', // 小嘴乌鸦
  'urocissa-erythroryncha', // 红嘴蓝鹊
  // 雀类 / 小型常见鸟
  'passer-montanus', // 麻雀（东亚）
  'passer-domesticus', // 家麻雀（欧洲）
  'passer-cinnamomeus', // 山麻雀
  'pycnonotus-sinensis', // 白头鹎
  'parus-cinereus', // 大山雀（东亚）
  'parus-major', // 大山雀（欧洲）
  'cyanistes-caeruleus', // 蓝山雀
  'chloris-sinica', // 金翅雀（东亚）
  'chloris-chloris', // 金翅雀（欧洲）
  'carduelis-carduelis', // 红额金翅雀
  'lonchura-striata', // 白腰文鸟
  'phoenicurus-auroreus', // 北红尾鸲
  'copsychus-saularis', // 鹊鸲
  'turdus-merula', // 乌鸫（欧亚）
  'turdus-mandarinus', // 乌鸫（东亚）
  'turdus-migratorius', // 旅鸫（北美）
  'erithacus-rubecula', // 欧亚鸲
  'spodiopsar-cineraceus', // 灰椋鸟
  'acridotheres-cristatellus', // 八哥
  'hirundo-rustica', // 家燕
  'motacilla-alba', // 白鹡鸰
  'upupa-epops', // 戴胜
  'lanius-schach', // 棕背伯劳
  // 水鸟 / 涉禽（"海鸥之类的"——按地区自动筛）
  'larus-canus', // 海鸥（欧洲）
  'larus-argentatus', // 银鸥
  'larus-brachyrhynchus', // 灰翅鸥（北美）
  'haematopus-ostralegus', // 蛎鹬
  'vanellus-vanellus', // 凤头麦鸡
  'anas-platyrhynchos', // 绿头鸭
  'egretta-garzetta', // 小白鹭
  'ardea-alba', // 大白鹭
  'ardea-cinerea', // 苍鹭
  'nycticorax-nycticorax', // 夜鹭
  'tachybaptus-ruficollis', // 小䴙䴘
  'gallinula-chloropus', // 黑水鸡
  'spilopelia-chinensis', // 珠颈斑鸠
  'columba-palumbus', // 原鸽（欧洲）
  'columba-livia', // 原鸽/家鸽
  'cyanocitta-cristata', // 冠蓝鸦（北美）
  'agelaius-phoeniceus', // 红翅黑鹂（北美）
  'cardinalis-cardinalis', // 北美红雀
])

/** 该物种是否属于新手池 */
export function isStarterBird(id: string): boolean {
  return STARTER_BIRD_IDS.has(id)
}
