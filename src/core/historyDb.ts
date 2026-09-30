/**
 * 本地用户数据（IndexedDB v2）—— 只存本地，不上传。
 * 仓库：rounds（每轮记录）/ wrong（错题本）/ badges（已获徽章/称号标记）
 *       + profiles（用户）/ archives（档案/存档）/ meta（活动指针与 schema 标记）。
 * 013 §2：身份 → 存档 → 进度 三层；查询一律按活动档案过滤；
 * wrong/badges 主键为复合键 `${archiveId}::${...}`，天然按档案隔离。
 * v1 → v2 迁移（onupgradeneeded 内、versionchange 事务原子完成）：旧数据全部归入
 * 默认用户 + 默认档案（档案名 = 最早一轮的日期，无记录则建档日），meta.schema=2 标记；
 * versionchange 事务只在版本跃迁时执行一次，天然幂等（013 §2.1）。
 */
import type { MediaType, Tier } from '@/types'

export interface RoundItem {
  speciesId: string
  answer: string
  sci: string
  family: string
  type: MediaType
  chosen: string | null
  /** 错选物种的 id（错选名按 locale 解析用，015 #1；答对/超时缺省） */
  chosenId?: string
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
  /** 轮次来源：错题重练（隐藏徽章/称号统计用，R28） */
  source?: 'normal' | 'wrong-practice'
  /** 退出确认点了「取消」后继续答完本轮（隐藏徽章"浪子回头"，R28） */
  escapedQuit?: boolean
  /** 归属（013 A0，落库时写入） */
  profileId?: string
  archiveId?: string
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
  /** 最近错选的物种 id（015 #1） */
  lastChosenId?: string
  lastAt: number
}

export interface EarnedBadge {
  id: string
  at: number
}

/** 用户（013）：一个身份；同设备可有多个（多用户管理在 013-A3） */
export interface ProfileRow {
  id: string
  nickname: string
  createdAt: number
  activeArchiveId: string | null
  updatedAt: number
}

/** 档案/存档（013）：进度集合（轮次/错题/徽章）的归属单位；新建 = 清零重开 */
export interface ArchiveRow {
  id: string
  profileId: string
  name: string
  createdAt: number
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
  // ---- 徽章/称号扩展计数（R28，均由 rounds 派生） ----
  /** L5 地狱轮数 */
  hellRounds: number
  /** L5 地狱总题数 / 答对数 */
  hellQuestions: number
  hellCorrect: number
  /** L5 满分轮数 */
  hellPerfectRounds: number
  /** 听音版累计答对题数 */
  audioCorrect: number
  /** 错题重练轮数 / 其中累计答对题数 */
  wrongPracticeRounds: number
  wrongPracticeCorrect: number
  /** 看图 / 听音满分轮数 */
  imagePerfectRounds: number
  audioPerfectRounds: number
  /** 跨轮连续答对最长（按时间顺序，答错即断） */
  maxCrossStreak: number
  /** 答对过的物种数（比 distinctSpecies 更严：不仅要见过，还要对） */
  distinctCorrect: number
  /** 存在深夜（23:00–1:00）/ 清晨（5:00–7:00）完成的轮 */
  nightRound: boolean
  dawnRound: boolean
  /** 退出确认取消后答完且满分（"浪子回头"） */
  escapedQuitPerfect: boolean
}

const DB_NAME = 'uniaoer'
const DB_VERSION = 2
const STORE_ROUNDS = 'rounds'
const STORE_WRONG = 'wrong'
const STORE_BADGES = 'badges'
const STORE_PROFILES = 'profiles'
const STORE_ARCHIVES = 'archives'
const STORE_META = 'meta'

const DEFAULT_PROFILE_ID = 'p-default'
const DEFAULT_ARCHIVE_ID = 'a-default'

/** 复合键（013 §2）：wrong/badges 以档案为前缀，天然按档隔离 */
function wrongKey(archiveId: string, speciesId: string): string {
  return `${archiveId}::${speciesId}`
}
function badgeKey(archiveId: string, badgeId: string): string {
  return `${archiveId}::${badgeId}`
}

/** 档案默认名：建档日期（013 §3.1 自动以日期建档） */
function archiveName(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** v1 迁移读取设置里的昵称（settings store 同键；core 不 import store，直接读 localStorage） */
function readSavedNickname(): string {
  try {
    const raw = localStorage.getItem('uniaoer.settings.v2')
    const saved = raw ? (JSON.parse(raw) as { nickname?: string }) : {}
    return typeof saved.nickname === 'string' ? saved.nickname : ''
  } catch {
    return ''
  }
}

let dbPromise: Promise<IDBDatabase> | null = null
/** 当前连接实例（_resetDb 时关闭，避免泄漏连接干扰后续测试/重建） */
let dbInstance: IDBDatabase | null = null

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

function rawOpen(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(name, version) : indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** getAll 的宽容版：仓库不存在（空 v1 库）时返回空数组 */
async function safeGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  try {
    return await p<T[]>(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>)
  } catch {
    return []
  }
}

/**
 * 打开 v2 数据库。两阶段迁移（对真实浏览器与 fake-indexeddb 都稳健）：
 * 1) 用「无版本」连接读出 v1 旧行到内存并 close（库不存在时该连接会造出一个空 v1 库，无害）；
 * 2) 打开 DB_VERSION：onupgradeneeded 内**只做同步操作**——建仓库/索引、按内存中的旧行
 *    写入迁移数据 + 默认用户/档案 + meta.schema 标记。整个升级在一个 versionchange
 *    事务内原子提交；升级只在版本跃迁时执行，天然幂等（013 §2.1）。
 */
async function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDbInstance().catch((e) => {
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

/** 实际开库（连接缓存在 dbPromise；实例引用另存 dbInstance 供 _resetDb 关闭） */
async function openDbInstance(): Promise<IDBDatabase> {
  const probe = await rawOpen(DB_NAME)
  let legacy: { rounds: RoundRecord[]; wrong: WrongEntry[]; badges: EarnedBadge[] } | null = null
  if (probe.version < DB_VERSION && !probe.objectStoreNames.contains(STORE_PROFILES)) {
    legacy = {
      rounds: await safeGetAll<RoundRecord>(probe, STORE_ROUNDS),
      wrong: await safeGetAll<WrongEntry>(probe, STORE_WRONG),
      badges: await safeGetAll<EarnedBadge>(probe, STORE_BADGES),
    }
  }
  probe.close()

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const upgraded = req.result
      // wrong：主键从 speciesId 改为复合 id，必须删除重建（旧行已在内存）
      if (upgraded.objectStoreNames.contains(STORE_WRONG)) {
        upgraded.deleteObjectStore(STORE_WRONG)
      }
      const wrongS = upgraded.createObjectStore(STORE_WRONG, { keyPath: 'id' })
      wrongS.createIndex('archiveId', 'archiveId', { unique: false })
      let roundsS: IDBObjectStore
      if (upgraded.objectStoreNames.contains(STORE_ROUNDS)) {
        roundsS = req.transaction!.objectStore(STORE_ROUNDS)
        if (!roundsS.indexNames.contains('archiveId')) {
          roundsS.createIndex('archiveId', 'archiveId', { unique: false })
        }
      } else {
        roundsS = upgraded.createObjectStore(STORE_ROUNDS, { keyPath: 'id' })
        roundsS.createIndex('archiveId', 'archiveId', { unique: false })
      }
      let badgesS: IDBObjectStore
      if (upgraded.objectStoreNames.contains(STORE_BADGES)) {
        badgesS = req.transaction!.objectStore(STORE_BADGES)
        if (!badgesS.indexNames.contains('archiveId')) {
          badgesS.createIndex('archiveId', 'archiveId', { unique: false })
        }
      } else {
        badgesS = upgraded.createObjectStore(STORE_BADGES, { keyPath: 'id' })
        badgesS.createIndex('archiveId', 'archiveId', { unique: false })
      }
      // 注意：升级事务内只能用 createObjectStore 返回的仓库引用做数据写入
      // （IDBDatabase 没有 objectStore() 方法）
      const profilesS = upgraded.createObjectStore(STORE_PROFILES, { keyPath: 'id' })
      const archivesS = upgraded.createObjectStore(STORE_ARCHIVES, { keyPath: 'id' })
      const metaS = upgraded.createObjectStore(STORE_META, { keyPath: 'key' })

      if (!legacy) return // 已是 v2（或无需迁移）：仅结构对齐

      // ---- v1 → v2 数据迁移（全部同步写，随 versionchange 事务原子提交） ----
      const now = Date.now()
      const firstAt = legacy.rounds.length
        ? Math.min(...legacy.rounds.map((r) => r.at ?? now))
        : now
      profilesS.put({
        id: DEFAULT_PROFILE_ID,
        nickname: readSavedNickname(),
        createdAt: now,
        activeArchiveId: DEFAULT_ARCHIVE_ID,
        updatedAt: now,
      } satisfies ProfileRow)
      archivesS.put({
        id: DEFAULT_ARCHIVE_ID,
        profileId: DEFAULT_PROFILE_ID,
        name: archiveName(firstAt),
        createdAt: now,
      } satisfies ArchiveRow)
      metaS.put({ key: 'schema', value: 2 })
      metaS.put({ key: 'activeProfileId', value: DEFAULT_PROFILE_ID })
      for (const r of legacy.rounds) {
        roundsS.put({ ...r, profileId: DEFAULT_PROFILE_ID, archiveId: DEFAULT_ARCHIVE_ID })
      }
      for (const b of legacy.badges) {
        badgesS.put({
          ...b,
          id: badgeKey(DEFAULT_ARCHIVE_ID, b.id),
          archiveId: DEFAULT_ARCHIVE_ID,
          badgeId: b.id,
        })
      }
      for (const w of legacy.wrong) {
        wrongS.put({
          ...w,
          id: wrongKey(DEFAULT_ARCHIVE_ID, w.speciesId),
          archiveId: DEFAULT_ARCHIVE_ID,
        })
      }
    }
    req.onsuccess = () => {
      dbInstance = req.result
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
  return db
}

// ---------- 活动档案（013：所有查询归活动档） ----------

export interface ActiveCtx {
  profileId: string
  archiveId: string
}

let ctxPromise: Promise<ActiveCtx> | null = null

/** 取活动 (用户, 档案)；缺失时惰性创建默认（全新安装：档案名 = 今天日期） */
async function ensureCtx(): Promise<ActiveCtx> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const db = await openDb()
      const tx = db.transaction([STORE_META, STORE_PROFILES, STORE_ARCHIVES], 'readwrite')
      const metaS = tx.objectStore(STORE_META)
      const profilesS = tx.objectStore(STORE_PROFILES)
      const archivesS = tx.objectStore(STORE_ARCHIVES)

      const activeId = (
        await p<{ key: string; value: string } | undefined>(metaS.get('activeProfileId'))
      )?.value
      let profile = activeId ? await p<ProfileRow | undefined>(profilesS.get(activeId)) : undefined
      if (!profile) {
        profile = {
          id: DEFAULT_PROFILE_ID,
          nickname: readSavedNickname(),
          createdAt: Date.now(),
          activeArchiveId: null,
          updatedAt: Date.now(),
        }
        profilesS.put(profile)
        metaS.put({ key: 'activeProfileId', value: profile.id })
      }

      let archive = profile.activeArchiveId
        ? await p<ArchiveRow | undefined>(archivesS.get(profile.activeArchiveId))
        : undefined
      if (!archive) {
        archive = {
          id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          profileId: profile.id,
          name: archiveName(Date.now()),
          createdAt: Date.now(),
        }
        archivesS.put(archive)
        profile = { ...profile, activeArchiveId: archive.id, updatedAt: Date.now() }
        profilesS.put(profile)
      }
      await txDone(tx)
      return { profileId: profile.id, archiveId: archive.id }
    })().catch((e) => {
      ctxPromise = null
      throw e
    })
  }
  return ctxPromise
}

/** 当前用户（A1 昵称引导 / A3 档案管理用） */
export async function getActiveProfile(): Promise<ProfileRow> {
  const db = await openDb()
  const { profileId } = await ensureCtx()
  const row = await p<ProfileRow>(
    db.transaction(STORE_PROFILES).objectStore(STORE_PROFILES).get(profileId),
  )
  return row!
}

/** 更新当前用户昵称（A1 引导保存；档案级 Profile.nickname） */
export async function setProfileNickname(nickname: string): Promise<void> {
  const db = await openDb()
  const { profileId } = await ensureCtx()
  const tx = db.transaction(STORE_PROFILES, 'readwrite')
  const s = tx.objectStore(STORE_PROFILES)
  const row = await p<ProfileRow | undefined>(s.get(profileId))
  if (row) s.put({ ...row, nickname, updatedAt: Date.now() })
  await txDone(tx)
}

/** 当前用户的全部档案（新→旧；A3 档案管理用） */
export async function listArchives(): Promise<ArchiveRow[]> {
  const db = await openDb()
  const { profileId } = await ensureCtx()
  const rows = await p<ArchiveRow[]>(
    db.transaction(STORE_ARCHIVES).objectStore(STORE_ARCHIVES).getAll(),
  )
  return rows.filter((a) => a.profileId === profileId).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 新建档案并切换为活动档（013 §3.3「新建档案 = 清零重开」；A2 池空引导 / A3 管理页用）。
 * name 缺省 = 日期；同日多档自动加序号（YYYY-MM-DD #2）。
 */
export async function createArchive(name?: string): Promise<ArchiveRow> {
  const db = await openDb()
  const { profileId } = await ensureCtx()
  const tx = db.transaction([STORE_ARCHIVES, STORE_PROFILES], 'readwrite')
  const archivesS = tx.objectStore(STORE_ARCHIVES)
  const existing = (await p<ArchiveRow[]>(archivesS.getAll())).filter(
    (a) => a.profileId === profileId,
  )
  const base = name?.trim() || archiveName(Date.now())
  let finalName = base
  for (let n = 2; existing.some((a) => a.name === finalName); n++) {
    finalName = `${base} #${n}`
  }
  const archive: ArchiveRow = {
    id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    profileId,
    name: finalName,
    createdAt: Date.now(),
  }
  archivesS.put(archive)
  const profilesS = tx.objectStore(STORE_PROFILES)
  const profile = await p<ProfileRow | undefined>(profilesS.get(profileId))
  if (profile) {
    profilesS.put({ ...profile, activeArchiveId: archive.id, updatedAt: Date.now() })
  }
  await txDone(tx)
  ctxPromise = null // 切档后让后续调用重新解析活动档
  return archive
}

/** 切换活动档案（A3；切换后所有查询即指向新档） */
export async function activateArchive(archiveId: string): Promise<void> {
  const db = await openDb()
  const { profileId } = await ensureCtx()
  const tx = db.transaction([STORE_PROFILES], 'readwrite')
  const profilesS = tx.objectStore(STORE_PROFILES)
  const profile = await p<ProfileRow | undefined>(profilesS.get(profileId))
  if (!profile) throw new Error('active profile missing')
  profilesS.put({ ...profile, activeArchiveId: archiveId, updatedAt: Date.now() })
  await txDone(tx)
  ctxPromise = null
}

// ---------- 数据读写（一律按活动档案过滤） ----------

/** 保存一轮记录，并同步错题本（答错入库、答对移除）；记录归属活动档 */
export async function saveRound(record: RoundRecord): Promise<void> {
  const { profileId, archiveId } = await ensureCtx()
  const db = await openDb()
  const tx = db.transaction([STORE_ROUNDS, STORE_WRONG], 'readwrite')
  tx.objectStore(STORE_ROUNDS).put({ ...record, profileId, archiveId })
  const wrongS = tx.objectStore(STORE_WRONG)
  for (const item of record.items) {
    if (!item.speciesId) continue // 无唯一键则跳过，避免 IndexedDB 报错
    const key = wrongKey(archiveId, item.speciesId)
    if (item.correct) {
      wrongS.delete(key)
    } else {
      const existing = await p<WrongEntry | undefined>(wrongS.get(key))
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
        lastChosenId: item.chosenId,
        lastAt: record.at,
      }
      wrongS.put({ ...entry, id: key, archiveId })
    }
  }
  await txDone(tx)
}

export function listRounds(): Promise<RoundRecord[]> {
  return (async () => {
    const db = await openDb()
    const { archiveId } = await ensureCtx()
    return p<RoundRecord[]>(
      db.transaction(STORE_ROUNDS).objectStore(STORE_ROUNDS).index('archiveId').getAll(archiveId),
    )
  })()
}

export function getWrongBook(): Promise<WrongEntry[]> {
  return (async () => {
    const db = await openDb()
    const { archiveId } = await ensureCtx()
    const rows = await p<(WrongEntry & { id: string; archiveId: string })[]>(
      db.transaction(STORE_WRONG).objectStore(STORE_WRONG).index('archiveId').getAll(archiveId),
    )
    return rows.map(({ id: _id, archiveId: _a, ...entry }) => entry)
  })()
}

export interface WrongHistoryItem {
  speciesId: string
  answer: string
  sci: string
  family: string
  chosen: string | null
  /** 错选物种 id（015 #1） */
  chosenId?: string
  timedOut: boolean
  at: number
  mode: MediaType
  tier: Tier
}

/** 历史错题：从活动档全部轮次记录里展开（只增不减，永久保留） */
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
        chosenId: it.chosenId,
        timedOut: it.timedOut,
        at: r.at,
        mode: r.mode,
        tier: r.tier,
      })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

export async function removeWrong(speciesId: string): Promise<void> {
  const { archiveId } = await ensureCtx()
  const db = await openDb()
  const tx = db.transaction([STORE_WRONG], 'readwrite')
  const done = txDone(tx)
  tx.objectStore(STORE_WRONG).delete(wrongKey(archiveId, speciesId))
  await done
}

export async function clearWrong(): Promise<void> {
  const { archiveId } = await ensureCtx()
  const db = await openDb()
  const tx = db.transaction(STORE_WRONG, 'readwrite')
  const s = tx.objectStore(STORE_WRONG)
  const keys = await p<IDBValidKey[]>(s.index('archiveId').getAllKeys(archiveId))
  for (const k of keys) s.delete(k)
  await txDone(tx)
}

/** 取活动档已获徽章/称号标记（返回未加前缀的 badgeId，调用方无感知） */
export function getBadges(): Promise<EarnedBadge[]> {
  return (async () => {
    const db = await openDb()
    const { archiveId } = await ensureCtx()
    const rows = await p<(EarnedBadge & { archiveId: string; badgeId: string })[]>(
      db.transaction(STORE_BADGES).objectStore(STORE_BADGES).index('archiveId').getAll(archiveId),
    )
    return rows.map(({ badgeId, at }) => ({ id: badgeId, at }))
  })()
}

/** 保存徽章/称号标记（自动加活动档前缀） */
export async function saveBadges(badges: EarnedBadge[]): Promise<void> {
  if (!badges.length) return
  const { archiveId } = await ensureCtx()
  const db = await openDb()
  const tx = db.transaction(STORE_BADGES, 'readwrite')
  const s = tx.objectStore(STORE_BADGES)
  for (const b of badges) {
    s.put({ ...b, id: badgeKey(archiveId, b.id), archiveId, badgeId: b.id })
  }
  await txDone(tx)
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

/** 汇总统计（活动档；用于徽章判定与"我的"页面） */
export async function getStats(): Promise<Stats> {
  const [rounds, wrong] = await Promise.all([listRounds(), getWrongBook()])
  const species = new Set<string>()
  const correctSpecies = new Set<string>()
  let totalQuestions = 0
  let totalCorrect = 0
  let bestAccuracy = 0
  let perfectRounds = 0
  let audioRounds = 0
  let maxTier = 0
  let bestStreak = 0
  let hellRounds = 0
  let hellQuestions = 0
  let hellCorrect = 0
  let hellPerfectRounds = 0
  let audioCorrect = 0
  let wrongPracticeRounds = 0
  let wrongPracticeCorrect = 0
  let imagePerfectRounds = 0
  let audioPerfectRounds = 0
  let maxCrossStreak = 0
  let nightRound = false
  let dawnRound = false
  let escapedQuitPerfect = false

  const sorted = [...rounds].sort((a, b) => a.at - b.at)
  let cross = 0
  for (const r of sorted) {
    totalQuestions += r.total
    totalCorrect += r.correct
    bestAccuracy = Math.max(bestAccuracy, r.accuracy)
    const isPerfect = r.total > 0 && r.correct === r.total
    if (isPerfect) {
      perfectRounds++
      if (r.mode === 'image') imagePerfectRounds++
      else audioPerfectRounds++
    }
    if (r.mode === 'audio') audioRounds++
    maxTier = Math.max(maxTier, r.tier)
    bestStreak = Math.max(bestStreak, maxStreak(r.items))

    if (r.tier === 5) {
      hellRounds++
      hellQuestions += r.total
      hellCorrect += r.correct
      if (isPerfect) hellPerfectRounds++
    }
    if (r.source === 'wrong-practice') {
      wrongPracticeRounds++
      wrongPracticeCorrect += r.correct
    }
    if (r.mode === 'audio') {
      audioCorrect += r.correct
    }
    for (const it of r.items) {
      species.add(it.speciesId)
      if (it.correct) {
        correctSpecies.add(it.speciesId)
        cross++
        maxCrossStreak = Math.max(maxCrossStreak, cross)
      } else {
        cross = 0
      }
    }
    const hour = new Date(r.at).getHours()
    if (hour >= 23 || hour < 1) nightRound = true
    if (hour >= 5 && hour < 7) dawnRound = true
    if (r.escapedQuit && isPerfect) escapedQuitPerfect = true
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
    hellRounds,
    hellQuestions,
    hellCorrect,
    hellPerfectRounds,
    audioCorrect,
    wrongPracticeRounds,
    wrongPracticeCorrect,
    imagePerfectRounds,
    audioPerfectRounds,
    maxCrossStreak,
    distinctCorrect: correctSpecies.size,
    nightRound,
    dawnRound,
    escapedQuitPerfect,
  }
}

/** 清空**当前档案**的全部数据（轮次/错题本/徽章）；用户与档案结构保留（013 §6.3） */
export async function clearAll(): Promise<void> {
  const { archiveId } = await ensureCtx()
  const db = await openDb()
  const tx = db.transaction([STORE_ROUNDS, STORE_WRONG, STORE_BADGES], 'readwrite')
  for (const store of [STORE_ROUNDS, STORE_WRONG, STORE_BADGES]) {
    const s = tx.objectStore(store)
    const keys = await p<IDBValidKey[]>(s.index('archiveId').getAllKeys(archiveId))
    for (const k of keys) s.delete(k)
  }
  await txDone(tx)
}

// ---- E2 导出 / 导入（JSON 备份；A0 阶段为活动档粒度，013-A4 升级档案结构） ----

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

/** 导出当前档案数据（记录 / 错题本 / 徽章） */
export async function exportAll(): Promise<BackupFile> {
  const [rounds, wrong, badges] = await Promise.all([listRounds(), getWrongBook(), getBadges()])
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
 * 导入备份到当前档案：按 id 合并（不删除现有数据）。
 * - 轮次：同 id 覆盖（视为同一轮），新轮次追加
 * - 错题：同物种保留 wrongCount 更大的那个
 * - 徽章：并集
 */
export async function importBackup(data: BackupFile): Promise<ImportResult> {
  const { profileId, archiveId } = await ensureCtx()
  let rounds = 0
  let wrong = 0
  let badges = 0
  const db = await openDb()

  for (const r of data.rounds ?? []) {
    if (!r?.id) continue
    const tx = db.transaction([STORE_ROUNDS], 'readwrite')
    const done = txDone(tx)
    tx.objectStore(STORE_ROUNDS).put({ ...r, profileId, archiveId })
    await done
    rounds++
  }

  for (const w of data.wrong ?? []) {
    if (!w?.speciesId) continue
    const key = wrongKey(archiveId, w.speciesId)
    const tx = db.transaction([STORE_WRONG], 'readwrite')
    const s = tx.objectStore(STORE_WRONG)
    const existing = await p<(WrongEntry & { id: string }) | undefined>(s.get(key))
    if (existing && (existing.wrongCount ?? 0) >= (w.wrongCount ?? 0)) continue
    s.put({ ...w, id: key, archiveId })
    await txDone(tx)
    wrong++
  }

  for (const b of data.badges ?? []) {
    if (!b?.id) continue
    const tx = db.transaction([STORE_BADGES], 'readwrite')
    const done = txDone(tx)
    tx.objectStore(STORE_BADGES).put({
      ...b,
      id: badgeKey(archiveId, b.id),
      archiveId,
      badgeId: b.id,
    })
    await done
    badges++
  }

  return { rounds, wrong, badges }
}

/** 测试用：重置连接与活动档缓存（关闭旧连接，避免泄漏连接干扰后续开库） */
export function _resetDb() {
  dbInstance?.close()
  dbInstance = null
  dbPromise = null
  ctxPromise = null
}
