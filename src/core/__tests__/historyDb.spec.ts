import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearAll,
  getStats,
  getWrongBook,
  listRounds,
  listWrongHistory,
  removeWrong,
  saveRound,
  _resetDb,
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
})
