import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import {
  saveRound,
  getBadges,
  saveBadges,
  getStats,
  type RoundItem,
  type RoundRecord,
} from './historyDb'
import { evaluateBadges, type BadgeDef } from './badges'

type QuizStore = ReturnType<typeof useQuizStore>

/** 本轮已落库的标记，避免重复写入（错题计数需幂等） */
const persisted = new Set<string>()

/** 把当前一轮结果写入本地，并返回本次新获得的徽章 */
export async function persistRound(quiz: QuizStore): Promise<BadgeDef[]> {
  if (!quiz.roundId || !quiz.questions.length || persisted.has(quiz.roundId)) return []
  persisted.add(quiz.roundId)

  const items: RoundItem[] = quiz.questions.map((q, i) => {
    const raw = quiz.chosen[i] ?? null
    const timedOut = raw === TIMEOUT
    return {
      speciesId: q.media.speciesId,
      answer: q.answer,
      sci: q.sci,
      family: q.family,
      type: q.type,
      chosen: timedOut ? null : raw,
      correct: raw === q.answer,
      timedOut,
      mediaUrl: q.media.url,
      source: q.media.source,
      author: q.media.author,
      license: q.media.license,
    }
  })

  const record: RoundRecord = {
    id: quiz.roundId,
    at: Date.now(),
    category: 'bird',
    mode: quiz.mode,
    tier: quiz.tier,
    total: quiz.total,
    correct: quiz.correctCount,
    accuracy: quiz.accuracy,
    durationMs: quiz.startedAt ? Date.now() - quiz.startedAt : 0,
    items,
  }

  try {
    await saveRound(record)
    const [stats, earned] = await Promise.all([getStats(), getBadges()])
    const newBadges = evaluateBadges(stats, new Set(earned.map((b) => b.id)))
    if (newBadges.length) await saveBadges(newBadges.map((b) => ({ id: b.id, at: Date.now() })))
    return newBadges
  } catch (e) {
    console.warn('保存记录失败：', e)
    return []
  }
}

/** 测试用 */
export function _resetPersisted() {
  persisted.clear()
}
