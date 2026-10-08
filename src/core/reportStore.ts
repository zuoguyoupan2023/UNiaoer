/**
 * G1 报错按钮（006 R9）：把「图/音/答案有问题」的反馈先记录在本地。
 * 独立 IndexedDB（`uniaoer-reports`），与档案/统计库解耦，避免影响历史数据迁移；
 * 未来 B6「大众评审」再上传到后端（此处只本地留存）。
 */
import type { MediaType } from '@/types'

/**
 * 反馈类型。029 M3 起新增 `quality`：
 *   · image/audio/answer = **正确性问题**（内容错了，必须纠正）
 *   · quality = **质量问题**（内容没错，但素材不适合当考题：模糊/远景/嘈杂/主体不清）
 *     处理链路不同：quality 走"隔离 → 换替补 → 无替补则降级为仅展示"（docs/029 §4）。
 */
export type ReportReason = 'image' | 'audio' | 'answer' | 'quality' | 'other'

export interface ReportEntry {
  id: string
  at: number
  /** 题目物种（可能为「当作」的正确答案） */
  speciesId: string
  /** 显示名快照（当轮 locale） */
  speciesName: string
  sci: string
  /** 题目媒体类型 */
  questionType: MediaType
  mediaUrl: string
  reason: ReportReason
  /** 用户认为的正确答案（可选） */
  suggestedAnswer?: string
  /** 补充说明（可选） */
  note?: string
  /** 是否已上传到后端（B6；离线时先本地，联网后补传） */
  synced?: boolean
}

export type NewReport = Omit<ReportEntry, 'id' | 'at' | 'synced'>

const DB_NAME = 'uniaoer-reports'
const DB_VERSION = 1
const STORE = 'reports'

function p<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
let dbInstance: IDBDatabase | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => {
        dbInstance = req.result
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
    }).catch((e) => {
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `rep-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 记录一条报错（本地） */
export async function addReport(entry: NewReport): Promise<ReportEntry> {
  const db = await openDb()
  const row: ReportEntry = { ...entry, id: newId(), at: Date.now(), synced: false }
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(row)
  await txDone(tx)
  return row
}

/** 全部报错（按时间倒序） */
export async function listReports(): Promise<ReportEntry[]> {
  const db = await openDb()
  const all = await p<ReportEntry[]>(db.transaction(STORE).objectStore(STORE).getAll())
  return all.sort((a, b) => b.at - a.at)
}

/** 报错条数 */
export async function countReports(): Promise<number> {
  const db = await openDb()
  return p<number>(db.transaction(STORE).objectStore(STORE).count())
}

/** 未上传到后端的报错（B6 补传用） */
export async function listPendingReports(): Promise<ReportEntry[]> {
  return (await listReports()).filter((r) => !r.synced)
}

/** 未上传条数 */
export async function pendingReportCount(): Promise<number> {
  return (await listPendingReports()).length
}

/** 标记某条已上传成功 */
export async function markReportSynced(id: string): Promise<void> {
  const db = await openDb()
  const row = await p<ReportEntry | undefined>(
    db.transaction(STORE).objectStore(STORE).get(id),
  )
  if (!row) return
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put({ ...row, synced: true })
  await txDone(tx)
}

/** 清空本地报错 */
export async function clearReports(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).clear()
  await txDone(tx)
}

/** 测试用：关闭并重置连接 */
export function _resetReportDb(): void {
  try {
    dbInstance?.close()
  } catch {
    /* ignore */
  }
  dbInstance = null
  dbPromise = null
}
