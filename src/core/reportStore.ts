/**
 * G1 报错按钮（006 R9）：把「图/音/答案有问题」的反馈先记录在本地。
 * 独立 IndexedDB（`uniaoer-reports`），与档案/统计库解耦，避免影响历史数据迁移；
 * 未来 B6「大众评审」再上传到后端（此处只本地留存）。
 */
import type { MediaType } from '@/types'

export type ReportReason = 'image' | 'audio' | 'answer' | 'other'

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
}

export type NewReport = Omit<ReportEntry, 'id' | 'at'>

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
  const row: ReportEntry = { ...entry, id: newId(), at: Date.now() }
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
