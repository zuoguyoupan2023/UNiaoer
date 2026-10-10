/**
 * scripts/lib/class-taxonomy.mjs 的类型声明（051 S2）。
 * 实现侧是纯 JS + JSDoc；这里只暴露测试/构建需要的最小签名。
 */
export type ClassSource = { type?: string; ref?: string; url?: string; note?: string }
export type ClassRecord = {
  familySci?: string
  orderSci?: string
  groups: string[]
  source?: ClassSource
  contributor?: string
  at?: string
  status?: string
}
export type ClassTable = {
  byFamily: Map<string, ClassRecord>
  byOrder: Map<string, ClassRecord>
  all: ClassRecord[]
}
export declare const GROUP6: readonly string[]
export declare const GROUP6_SET: Set<string>
export declare const SOURCE_TYPES: readonly string[]
export declare const SOURCE_TYPE_SET: Set<string>
export declare function checkRecord(r: ClassRecord): { issues: string[]; live: boolean }
export declare function buildClassTable(records: ClassRecord[]): ClassTable
export declare function resolveGroup6(
  table: ClassTable,
  familySci?: string,
  orderSci?: string,
): { groups: string[]; record: ClassRecord } | null
