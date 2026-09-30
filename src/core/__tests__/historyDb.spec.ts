import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  activateArchive,
  clearAll,
  createArchive,
  deleteArchive,
  exportAllArchives,
  exportCurrentArchive,
  getBadges,
  getStats,
  getWrongBook,
  importBackup,
  isBackupFile,
  listArchives,
  listRounds,
  listWrongHistory,
  removeWrong,
  saveRound,
  saveBadges,
  summarizeBackup,
  _resetDb,
  type BackupFileV1,
  type RoundRecord,
} from '../historyDb'

function round(id: string, items: { sid: string; answer: string; chosen: string | null }[]): RoundRecord {
  return {
    id,
    at: Date.now(),
    category: 'bird',
    mode: 'image',
    tier: 2,
    total: items.length,
    correct: items.filter((i) => i.chosen === i.answer).length,
    accuracy: Math.round((items.filter((i) => i.chosen === i.answer).length / items.length) * 100),
    durationMs: 1000,
    items: items.map((i) => ({
      speciesId: i.sid,
      answer: i.answer,
      sci: `${i.sid} sci`,
      family: '测试科',
      type: 'image',
      chosen: i.chosen,
      correct: i.chosen === i.answer,
      timedOut: false,
      mediaUrl: `https://img.test/${i.sid}.jpg`,
      source: 'iNaturalist',
      author: 'tester',
      license: 'CC-BY',
    })),
  }
}

describe('historyDb', () => {
  beforeEach(async () => {
    _resetDb()
    await clearAll()
  })

  it('保存轮次后可读取', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '甲' }]))
    const rounds = await listRounds()
    expect(rounds).toHaveLength(1)
    expect(rounds[0]!.correct).toBe(1)
  })

  it('答错进入错题本，答对则移除', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    let wrong = await getWrongBook()
    expect(wrong).toHaveLength(1)
    expect(wrong[0]!.wrongCount).toBe(1)

    // 再错一次，计数累加
    await saveRound(round('r2', [{ sid: 'a', answer: '甲', chosen: '丙' }]))
    wrong = await getWrongBook()
    expect(wrong[0]!.wrongCount).toBe(2)
    expect(wrong[0]!.lastChosen).toBe('丙')

    // 答对 -> 掌握 -> 移除
    await saveRound(round('r3', [{ sid: 'a', answer: '甲', chosen: '甲' }]))
    expect(await getWrongBook()).toHaveLength(0)
  })

  it('removeWrong 可单条移除', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    await removeWrong('a')
    expect(await getWrongBook()).toHaveLength(0)
  })

  it('历史错题永久保留，当前错题本动态变化', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    await saveRound(round('r2', [{ sid: 'a', answer: '甲', chosen: '甲' }])) // 答对 → 掌握
    expect(await getWrongBook()).toHaveLength(0) // 当前错题本已移除
    const h = await listWrongHistory() // 历史仍保留
    expect(h).toHaveLength(1)
    expect(h[0]!.answer).toBe('甲')
    expect(h[0]!.chosen).toBe('乙')
  })

  it('getStats 汇总正确', async () => {
    await saveRound(
      round('r1', [
        { sid: 'a', answer: '甲', chosen: '甲' },
        { sid: 'b', answer: '乙', chosen: '乙' },
      ]),
    )
    await saveRound(round('r2', [{ sid: 'c', answer: '丙', chosen: '丁' }]))
    const s = await getStats()
    expect(s.rounds).toBe(2)
    expect(s.totalQuestions).toBe(3)
    expect(s.totalCorrect).toBe(2)
    expect(s.perfectRounds).toBe(1)
    expect(s.distinctSpecies).toBe(3)
    expect(s.wrongCount).toBe(1)
    expect(s.bestStreak).toBe(2)
  })

  it('E2 导出为档案级 v2，含归属与档案名', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    const data = await exportCurrentArchive()
    expect(isBackupFile(data)).toBe(true)
    expect(data.version).toBe(2)
    expect(data.scope).toBe('archive')
    expect(data.archive.rounds).toHaveLength(1)
    expect(data.archive.wrong).toHaveLength(1)
    expect(data.archive.id).toBe((await listArchives())[0]!.id)
    expect(data.archive.name).toBeTruthy()
  })

  it('E2 导出后清空再导入，数据完整恢复（同档 id → 合并）', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    const backup = await exportCurrentArchive()
    await clearAll()
    expect(await listRounds()).toHaveLength(0)

    const r = await importBackup(backup, { newArchiveName: '导入档案' })
    expect(r.rounds).toBe(1)
    expect(r.wrong).toBe(1)
    expect(r.archivesMerged).toBe(1)
    expect(r.archivesCreated).toBe(0)
    expect((await listRounds())[0]!.id).toBe('r1')
    expect((await getWrongBook())[0]!.speciesId).toBe('a')
  })

  it('E2 同档 id 合并：同轮覆盖，错题保留更大 wrongCount，徽章取并集', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }])) // 同 id 再存（wrongCount=2）

    const backup = await exportCurrentArchive()
    backup.archive.badges = [{ id: 'badge-1', at: 1 }]
    await clearAll()
    // 设备上先有：同 id 轮次 + wrongCount 更小的错题
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '丙' }]))
    await saveRound(round('other', [{ sid: 'b', answer: '乙', chosen: '乙' }]))
    const r = await importBackup(backup, { newArchiveName: 'x' })

    expect(r.archivesMerged).toBe(1)
    const rounds = await listRounds()
    expect(rounds).toHaveLength(2) // r1（被覆盖）+ other（保留）
    expect(rounds.find((x) => x.id === 'r1')!.items[0]!.chosen).toBe('乙') // 备份版本覆盖
    expect((await getWrongBook()).find((w) => w.speciesId === 'a')!.wrongCount).toBe(2)
    expect(await getBadges()).toEqual([{ id: 'badge-1', at: 1 }])
  })

  it('E2 异档 id 作为新档案导入，不污染当前档', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    const backup = await exportCurrentArchive()
    // 模拟“另一台设备”的备份：不同档案 id、不同轮次 id
    backup.archive = {
      ...backup.archive,
      id: 'a-external',
      name: '异地档案',
      rounds: [round('r-ext', [{ sid: 'z', answer: '丙', chosen: '丙' }])],
      wrong: [],
      badges: [],
    }
    const r = await importBackup(backup, { newArchiveName: '导入档案' })

    expect(r.archivesCreated).toBe(1)
    expect(r.archivesMerged).toBe(0)
    expect((await listArchives()).some((a) => a.id === 'a-external' && a.name === '异地档案')).toBe(
      true,
    )
    // 当前档数据未受影响（仍只有 r1）
    expect((await listRounds()).map((x) => x.id)).toEqual(['r1'])
    // 切到新档可见其数据，再切回并清理
    await activateArchive('a-external')
    expect((await listRounds()).map((x) => x.id)).toEqual(['r-ext'])
    const back = (await listArchives()).find((a) => a.id !== 'a-external')!
    await activateArchive(back.id)
    await deleteArchive('a-external')
  })

  it('E2 v1 备份导入自动建「导入档案」（兼容旧备份）', async () => {
    const v1: BackupFileV1 = {
      app: 'uniaoer',
      version: 1,
      exportedAt: '',
      rounds: [round('v1r', [{ sid: 'z', answer: '甲', chosen: '乙' }])],
      wrong: [],
      badges: [],
    }
    expect(isBackupFile(v1)).toBe(true)
    const r = await importBackup(v1, { newArchiveName: '导入档案' })
    expect(r.archivesCreated).toBe(1)
    expect(r.rounds).toBe(1)
    const created = (await listArchives()).find((a) => a.name === '导入档案')!
    expect(created).toBeTruthy()
    await deleteArchive(created.id) // 清理，避免影响后续用例
  })

  it('E2 summarizeBackup 统计 v1/v2', async () => {
    await saveRound(round('r1', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    const v2 = await exportCurrentArchive()
    expect(summarizeBackup(v2)).toEqual({ archives: 1, rounds: 1, wrong: 1, badges: 0 })
    const all = await exportAllArchives()
    expect(all.scope).toBe('all')
    expect(summarizeBackup(all).archives).toBeGreaterThanOrEqual(1)
  })

  it('E2 isBackupFile 接受 v1/v2，拒绝其他结构', () => {
    expect(isBackupFile({ app: 'uniaoer', version: 1, rounds: [] })).toBe(true)
    expect(isBackupFile({ app: 'uniaoer', version: 2, archive: {} })).toBe(true)
    expect(isBackupFile({ app: 'uniaoer', version: 2 })).toBe(false)
    expect(isBackupFile({ app: 'other', version: 1, rounds: [] })).toBe(false)
    expect(isBackupFile(null)).toBe(false)
    expect(isBackupFile('json')).toBe(false)
  })
})

describe('historyDb v2 档案隔离（013-A0）', () => {
  it('新建档案=清零重开：切档后数据互不可见，徽章复合键按档隔离', async () => {
    // 当前（默认）档案里放一轮 + 徽章
    await saveRound(round('r-a', [{ sid: 'a', answer: '甲', chosen: '乙' }]))
    await saveBadges([{ id: 'first-round', at: Date.now() }])
    expect((await listRounds()).length).toBeGreaterThan(0)

    // 新建档案并自动切换 → 全新进度
    const b = await createArchive('档案B')
    expect((await listRounds()).length).toBe(0)
    expect((await getWrongBook()).length).toBe(0)
    expect(await getBadges()).toEqual([])

    // B 档写数据
    await saveRound(round('r-b', [{ sid: 'b', answer: '丙', chosen: '丁' }]))
    await saveBadges([{ id: 'first-round', at: Date.now() }])
    const statsB = await getStats()
    expect(statsB.rounds).toBe(1)

    // 切回默认档：原数据完好、B 的数据不可见
    const archives = await listArchives()
    const defaultArchive = archives.find((x) => x.id !== b.id)!
    await activateArchive(defaultArchive.id)
    const roundsA = await listRounds()
    expect(roundsA.some((r) => r.id === 'r-a')).toBe(true)
    expect(roundsA.some((r) => r.id === 'r-b')).toBe(false)
    expect((await getBadges()).map((x) => x.id)).toContain('first-round')
    // 清空只影响当前档案：再切到 B 仍有数据
    await clearAll()
    await activateArchive(b.id)
    expect((await listRounds()).length).toBe(1)
    // 还原到默认档，避免影响其它用例
    await activateArchive(defaultArchive.id)
  })

  it('档案名同日去重：自动加序号', async () => {
    // 与 archiveName 一致用「本地日期」，避免跨时区/午夜时 UTC 与本地不同日导致抖动
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const a = await createArchive() // 与现有档案同名 → 自动 #2
    expect(a.name.startsWith(today)).toBe(true)
    const names = (await listArchives()).map((x) => x.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
