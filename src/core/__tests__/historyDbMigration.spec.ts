import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import {
  _resetDb,
  getActiveProfile,
  getBadges,
  getStats,
  getWrongBook,
  listArchives,
  listRounds,
  type RoundRecord,
} from '../historyDb'

/**
 * v1 → v2 迁移（013-A0）。作为独立 spec 文件运行（独立 worker），
 * 且整个流程在单条用例内完成：v2 连接不会被关闭，后续 deleteDatabase 会被其阻塞。
 */
describe('historyDb v1 → v2 迁移（013-A0）', () => {
  it('旧数据完整迁入默认档案 + 默认档案名/昵称规则', async () => {
    // 0. 本 worker 首次触库，删除（不存在也无妨）
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase('uniaoer')
      r.onsuccess = () => res(null)
      r.onerror = () => res(null)
    })
    // 1. 设置昵称（迁移应沿用，013 §2.1）
    localStorage.setItem('uniaoer.settings.v2', JSON.stringify({ nickname: '老鸟人' }))
    // 2. 造 v1 库 + 旧格式数据（建库必须在 onupgradeneeded 内）
    const v1 = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('uniaoer', 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('rounds', { keyPath: 'id' })
        req.result.createObjectStore('wrong', { keyPath: 'speciesId' })
        req.result.createObjectStore('badges', { keyPath: 'id' })
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const tx = v1.transaction(['rounds', 'wrong', 'badges'], 'readwrite')
    tx.objectStore('rounds').put({
      id: 'r1',
      at: 1_700_000_000_000,
      category: 'bird',
      mode: 'image',
      tier: 2,
      total: 2,
      correct: 1,
      accuracy: 50,
      durationMs: 1000,
      items: [
        { speciesId: 's1', answer: '甲', sci: '', family: '', type: 'image', chosen: '乙', correct: false, timedOut: false, mediaUrl: '', source: '', author: '', license: '' },
        { speciesId: 's2', answer: '丙', sci: '', family: '', type: 'image', chosen: '丙', correct: true, timedOut: false, mediaUrl: '', source: '', author: '', license: '' },
      ],
    } satisfies RoundRecord)
    tx.objectStore('wrong').put({ speciesId: 's1', answer: '甲', wrongCount: 3, lastAt: 1_700_000_000_000 })
    tx.objectStore('badges').put({ id: 'first-round', at: 1_700_000_000_000 })
    await new Promise((res, rej) => {
      tx.oncomplete = () => res(null)
      tx.onerror = () => rej(tx.error)
    })
    v1.close()
    _resetDb()

    // 3. 断言：轮次打标 + 错题复合键 + 徽章对外无前缀
    const rounds = await listRounds()
    expect(rounds).toHaveLength(1)
    expect(rounds[0]!.archiveId).toBe('a-default')
    const wrong = await getWrongBook()
    expect(wrong).toHaveLength(1)
    expect(wrong[0]!.speciesId).toBe('s1')
    expect(wrong[0]!.wrongCount).toBe(3)
    const badges = await getBadges()
    expect(badges.map((b) => b.id)).toEqual(['first-round'])
    const stats = await getStats()
    expect(stats.rounds).toBe(1)
    expect(stats.wrongCount).toBe(1)

    // 4. 默认档案名 = 最早一轮的日期时间（yyyy-mm-dd, hh-mm）；昵称快照沿用设置
    const archives = await listArchives()
    expect(archives).toHaveLength(1)
    expect(archives[0]!.name).toMatch(/^\d{4}-\d{2}-\d{2}, \d{2}-\d{2}$/)
    expect(archives[0]!.profileId).toBe('p-default')
    expect(archives[0]!.nickname).toBe('老鸟人') // 建档时昵称快照
    const profile = await getActiveProfile()
    expect(profile.nickname).toBe('老鸟人')
  }, 10_000)
})
