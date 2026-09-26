/**
 * 本地用户数据（IndexedDB）—— 只存本地，不上传。
 * 仓库：rounds（每轮记录）/ wrong（错题本）/ badges（已获徽章）
 */
import type { MediaType, Tier } from '@/types'

export interface RoundItem {
  speciesId: string
  answer: string
  sci: string
  family: string
  type: MediaType
  chosen: string | null
  correct: boolean
  timedOut: boolean
  mediaUrl: string
  source: string
  author: string
  license: string
}

export interface RoundRecord {
  id: string
  at: number
  category: string
  mode: MediaType
  tier: Tier
  total: number
  correct: number
  accuracy: number
  durationMs: number
  items: RoundItem[]
}

export interface WrongEntry {
  speciesId: string
  answer: string
  sci: string
  family: string
  type: MediaType
  mediaUrl: string
  source: string
  author: string
  license: string
  wrongCount: number
  lastChosen: string | null
  lastAt: number
}

export interface EarnedBadge {
  id: string
  at: number
}

export interface Stats {
  rounds: number
  totalQuestions: number
  totalCorrect: number
  bestAccuracy: number
  perfectRounds: number
  distinctSpecies: number
  audioRounds: number
  maxTier: number
  bestStreak: number
  wrongCount: number
}

const DB_NAME = 'uniaoer'
const DB_VERSION = 1
const STORE_ROUNDS = 'rounds'
const STORE_WRONG = 'wrong'
const STORE_BADGES = 'badges'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ROUNDS)) db.createObjectStore(STORE_ROUNDS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_WRONG)) db.createObjectStore(STORE_WRONG, { keyPath: 'speciesId' })
      if (!db.objectStoreNames.contains(STORE_BADGES)) db.createObjectStore(STORE_BADGES, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

async function getAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

async function put(store: string, value: unknown): Promise<void> {
  await run(store, 'readwrite', (s) => s.put(value) as IDBRequest<IDBValidKey>)
}

async function del(store: string, key: string): Promise<void> {
  if (key == null || key === '') return
  await run(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>)
}

async function clearStore(store: string): Promise<void> {
  await run(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>)
}

/** 保存一轮记录，并同步错题本（答错入库、答对移除） */
export async function saveRound(record: RoundRecord): Promise<void> {
  await put(STORE_ROUNDS, record)
  for (const item of record.items) {
    if (!item.speciesId) continue // 无唯一键则跳过，避免 IndexedDB 报错
    if (item.correct) {
      await del(STORE_WRONG, item.speciesId)
    } else {
      const existing = (await run<WrongEntry | undefined>(STORE_WRONG, 'readonly', (s) =>
        s.get(item.speciesId) as IDBRequest<WrongEntry | undefined>,
      )) as WrongEntry | undefined
      const entry: WrongEntry = {
        speciesId: item.speciesId,
        answer: item.answer,
        sci: item.sci,
        family: item.family,
        type: item.type,
        mediaUrl: item.mediaUrl,
        source: item.source,
        author: item.author,
        license: item.license,
        wrongCount: (existing?.wrongCount ?? 0) + 1,
        lastChosen: item.chosen,
        lastAt: record.at,
      }
      await put(STORE_WRONG, entry)
    }
  }
}

export function listRounds(): Promise<RoundRecord[]> {
  return getAll<RoundRecord>(STORE_ROUNDS)
}

export function getWrongBook(): Promise<WrongEntry[]> {
  return getAll<WrongEntry>(STORE_WRONG)
}

export interface WrongHistoryItem {
  speciesId: string
  answer: string
  sci: string
  family: string
  chosen: string | null
  timedOut: boolean
  at: number
  mode: MediaType
  tier: Tier
}

/** 历史错题：从全部轮次记录里展开（只增不减，永久保留） */
export async function listWrongHistory(): Promise<WrongHistoryItem[]> {
  const rounds = await listRounds()
  const out: WrongHistoryItem[] = []
  for (const r of rounds) {
    for (const it of r.items) {
      if (it.correct) continue
      out.push({
        speciesId: it.speciesId,
        answer: it.answer,
        sci: it.sci,
        family: it.family,
        chosen: it.chosen,
        timedOut: it.timedOut,
        at: r.at,
        mode: r.mode,
        tier: r.tier,
      })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

export function removeWrong(speciesId: string): Promise<void> {
  return del(STORE_WRONG, speciesId)
}

export function clearWrong(): Promise<void> {
  return clearStore(STORE_WRONG)
}

export function getBadges(): Promise<EarnedBadge[]> {
  return getAll<EarnedBadge>(STORE_BADGES)
}

export function saveBadges(badges: EarnedBadge[]): Promise<void> {
  return Promise.all(badges.map((b) => put(STORE_BADGES, b))).then(() => undefined)
}

function maxStreak(items: RoundItem[]): number {
  let best = 0
  let cur = 0
  for (const it of items) {
    if (it.correct) {
      cur++
      best = Math.max(best, cur)
    } else {
      cur = 0
    }
  }
  return best
}

/** 汇总统计（用于徽章判定与"我的"页面） */
export async function getStats(): Promise<Stats> {
  const [rounds, wrong] = await Promise.all([listRounds(), getWrongBook()])
  const species = new Set<string>()
  let totalQuestions = 0
  let totalCorrect = 0
  let bestAccuracy = 0
  let perfectRounds = 0
  let audioRounds = 0
  let maxTier = 0
  let bestStreak = 0
  for (const r of rounds) {
    totalQuestions += r.total
    totalCorrect += r.correct
    bestAccuracy = Math.max(bestAccuracy, r.accuracy)
    if (r.total > 0 && r.correct === r.total) perfectRounds++
    if (r.mode === 'audio') audioRounds++
    maxTier = Math.max(maxTier, r.tier)
    bestStreak = Math.max(bestStreak, maxStreak(r.items))
    for (const it of r.items) species.add(it.speciesId)
  }
  return {
    rounds: rounds.length,
    totalQuestions,
    totalCorrect,
    bestAccuracy,
    perfectRounds,
    distinctSpecies: species.size,
    audioRounds,
    maxTier,
    bestStreak,
    wrongCount: wrong.length,
  }
}

/** 清空全部本地数据 */
export async function clearAll(): Promise<void> {
  await Promise.all([clearStore(STORE_ROUNDS), clearStore(STORE_WRONG), clearStore(STORE_BADGES)])
}

// ---- E2 导出 / 导入（JSON 备份，仍只在用户设备间手动迁移） ----

export interface BackupFile {
  app: 'uniaoer'
  version: 1
  exportedAt: string
  rounds: RoundRecord[]
  wrong: WrongEntry[]
  badges: EarnedBadge[]
}

export interface ImportResult {
  rounds: number
  wrong: number
  badges: number
}

export function isBackupFile(value: unknown): value is BackupFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BackupFile).app === 'uniaoer' &&
    (value as BackupFile).version === 1 &&
    Array.isArray((value as BackupFile).rounds)
  )
}

/** 导出全部本地数据（记录 / 错题本 / 徽章） */
export async function exportAll(): Promise<BackupFile> {
  const [rounds, wrong, badges] = await Promise.all([
    listRounds(),
    getWrongBook(),
    getBadges(),
  ])
  return {
    app: 'uniaoer',
    version: 1,
    exportedAt: new Date().toISOString(),
    rounds,
    wrong,
    badges,
  }
}

/**
 * 导入备份：按 id 合并（不删除现有数据）。
 * - 轮次：同 id 覆盖（视为同一轮），新轮次追加
 * - 错题：同物种保留 wrongCount 更大的那个
 * - 徽章：并集
 */
export async function importBackup(data: BackupFile): Promise<ImportResult> {
  let rounds = 0
  let wrong = 0
  let badges = 0

  for (const r of data.rounds ?? []) {
    if (!r?.id) continue
    await put(STORE_ROUNDS, r)
    rounds++
  }

  for (const w of data.wrong ?? []) {
    if (!w?.speciesId) continue
    const existing = (await run<WrongEntry | undefined>(STORE_WRONG, 'readonly', (s) =>
      s.get(w.speciesId) as IDBRequest<WrongEntry | undefined>,
    )) as WrongEntry | undefined
    if (existing && (existing.wrongCount ?? 0) >= (w.wrongCount ?? 0)) continue
    await put(STORE_WRONG, w)
    wrong++
  }

  for (const b of data.badges ?? []) {
    if (!b?.id) continue
    await put(STORE_BADGES, b)
    badges++
  }

  return { rounds, wrong, badges }
}

/** 测试用：重置连接 */
export function _resetDb() {
  dbPromise = null
}
