/**
 * 051 S2：鸟类**生活型**（六分法：水/涉/林/猛/攀/游）的记录台账。
 *
 * ## 为什么要有这个模块，而不是直接推断
 * 六分法是**习惯分类**（生态习性 / 生活型），**不是分类学事实**，因此：
 *   - 不存在"权威表"可查 —— 权威只可能来自「某个具体来源对某个具体类群的描述」；
 *   - 任何"按目/科推断"的写法本质上是在编造（本项目已经吃过两次亏，见 050 P0 的两次修订）。
 * 所以本模块只做一件事：**读取"有人给出处"的记录**。
 *   · 有 `source` 且 `status === 'ok'` 的记录 → 生效；
 *   · `status === 'disputed'`（被用户挑错） → 不生效；
 *   · 查不到 → 返回 null，UI **不显示类群行**（宁可空着，也不显示错误信息）。
 *
 * ## 数据形状（`data/class-records.json`，入库、可人工审阅）
 * 见该文件的 `example` 字段。一个科可以跨类（鹭科既能游又能涉）→ `groups` 是数组。
 *
 * ## 与三分类的分工
 * `profile.group`（waterbird/raptor/landbird，050 P0，**科名查表、无依据留空**）保持不变；
 * 本模块产出 `profile.group6`（六分法 + 出处），两者并存，便于逐步积累与回退。
 */

/** 六分法的合法取值（与 data/class-records.json 的 `values` 一致） */
/** @type {readonly string[]} */
export const GROUP6 = ['swimmer', 'wader', 'woodland', 'raptor', 'climber', 'terrestrial']

export const GROUP6_SET = new Set(GROUP6)

/** 出处类型：`handbook` 手册 / `iucn` 权威名录 / `community` 社区投稿 / `manual` 人工整理 */
/** @type {readonly string[]} */
export const SOURCE_TYPES = ['handbook', 'iucn', 'community', 'manual']
export const SOURCE_TYPE_SET = new Set(SOURCE_TYPES)

/**
 * @typedef {object} ClassSource
 * @property {string} [type] handbook | iucn | community | manual
 * @property {string} [ref] 引用（书名/条目）
 * @property {string} [url] 链接
 * @property {string} [note] 备注
 */

/**
 * @typedef {object} ClassRecord
 * @property {string} [familySci] 英文科名（主键）
 * @property {string} [orderSci] 英文目名（科查不到时的兜底键）
 * @property {string[]} groups 生活型六分法取值
 * @property {ClassSource} [source] 出处（必填，否则不生效）
 * @property {string} [contributor] 提交人
 * @property {string} [at] 日期
 * @property {string} [status] ok | disputed（disputed 不生效）
 */

/**
 * @typedef {object} ClassTable
 * @property {Map<string, ClassRecord>} byFamily 生效记录（科名 → 记录）
 * @property {Map<string, ClassRecord>} byOrder 生效记录（目名 → 记录）
 * @property {ClassRecord[]} all 全部记录（含未生效的）
 */

/**
 * 校验单条记录，返回问题列表（空数组 = 合法且生效）。
 * `isLive` 表示"是否参与渲染"：`status` 非 `disputed` 且六值合法、source 完整。
 */
/** @param {ClassRecord} r @returns {{ issues: string[], live: boolean }} */
export function checkRecord(r) {
  /** @type {string[]} */
  const issues = []
  if (!r.familySci && !r.orderSci) issues.push('缺少 familySci / orderSci（至少要有一个键）')
  if (!Array.isArray(r.groups) || !r.groups.length) issues.push('groups 为空')
  else {
    for (const g of r.groups) if (!GROUP6_SET.has(g)) issues.push(`groups 含非法值 "${g}"`)
  }
  const src = r.source
  if (!src || !src.type) issues.push('缺少 source.type —— **没有出处的类群不生效**')
  else if (!SOURCE_TYPE_SET.has(src.type)) issues.push(`source.type 非法："${src.type}"`)
  if (!src?.ref && !src?.url) issues.push('source 需至少提供 ref（引用）或 url（链接）')
  const disputed = r.status === 'disputed'
  const unknownStatus = r.status !== undefined && r.status !== 'ok' && !disputed
  if (unknownStatus) issues.push(`status 非法："${r.status}"（只允许 ok / disputed）`)
  const live = issues.length === 0 && !disputed
  return { issues, live }
}

/**
 * 由台账构建索引。**只收录生效记录**（live）。
 * 同一键出现多条时：全部 disputed 的不入表；否则取最后一条（台账按时间追加）。
 */
/** @param {ClassRecord[]} records @returns {ClassTable} */
export function buildClassTable(records) {
  /** @type {Map<string, ClassRecord>} */
  const byFamily = new Map()
  /** @type {Map<string, ClassRecord>} */
  const byOrder = new Map()
  for (const r of records) {
    if (!checkRecord(r).live) continue
    if (r.familySci) byFamily.set(r.familySci, r)
    if (r.orderSci) byOrder.set(r.orderSci, r)
  }
  return { byFamily, byOrder, all: records }
}

/** 解析某物种的生活型：科优先、目兜底；都没有 → null（UI 不显示） */
/**
 * @param {ClassTable} table
 * @param {string} [familySci]
 * @param {string} [orderSci]
 * @returns {{ groups: string[], record: ClassRecord } | null}
 */
export function resolveGroup6(table, familySci, orderSci) {
  const byFamily = familySci ? table.byFamily.get(familySci) : undefined
  const byOrder = orderSci ? table.byOrder.get(orderSci) : undefined
  const record = byFamily ?? byOrder
  return record ? { groups: record.groups, record } : null
}