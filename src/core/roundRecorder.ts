import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import {
  saveRound,
  getBadges,
  saveBadges,
  getStats,
  listRounds,
  type RoundItem,
  type RoundRecord,
} from './historyDb'
import { evaluateBadges, type BadgeDef } from './badges'
import { evaluateTitles, titleLabelAt, TITLE_TRACKS, type EarnedTitle } from './titles'

type QuizStore = ReturnType<typeof useQuizStore>

/** 本轮已落库的标记，避免重复写入（错题计数需幂等） */
const persisted = new Set<string>()

export interface PersistResult {
  /** 本次新获得的徽章 */
  badges: BadgeDef[]
  /** 本次新解锁的称号级（每轨道只提示最高新级） */
  newTitles: EarnedTitle[]
}

/** 把当前一轮结果写入本地，并返回本次新获得的徽章与称号 */
export async function persistRound(quiz: QuizStore): Promise<PersistResult> {
  if (!quiz.roundId || !quiz.questions.length || persisted.has(quiz.roundId)) {
    return { badges: [], newTitles: [] }
  }
  persisted.add(quiz.roundId)

  const items: RoundItem[] = quiz.questions.map((q, i) => {
    const raw = quiz.chosen[i] ?? null
    const timedOut = raw === TIMEOUT
    // 旧题库的媒体可能没有 speciesId，退化为用 url 作为唯一键
    const speciesId = q.media.speciesId || q.media.url
    return {
      speciesId,
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
    source: quiz.source,
    ...(quiz.escapedQuit ? { escapedQuit: true } : {}),
  }

  try {
    await saveRound(record)
    const [stats, earned, rounds] = await Promise.all([getStats(), getBadges(), listRounds()])
    const earnedIds = new Set(earned.map((b) => b.id))
    const newBadges = evaluateBadges(stats, rounds, earnedIds)
    if (newBadges.length) {
      await saveBadges(newBadges.map((b) => ({ id: b.id, at: Date.now() })))
      for (const b of newBadges) earnedIds.add(b.id)
    }

    // 称号：逐轨计算当前级；与已标记级（id = title:{trackId}:{level}）diff，新升的每轨只提示最高新级
    const current = evaluateTitles(stats, rounds)
    const newTitles: EarnedTitle[] = []
    const titleMarks: { id: string; at: number }[] = []
    for (const t of current) {
      let highestNew: number | null = null
      for (let lv = 1; lv <= t.level; lv++) {
        const id = `title:${t.trackId}:${lv}`
        if (!earnedIds.has(id)) {
          highestNew = lv
          titleMarks.push({ id, at: Date.now() })
          earnedIds.add(id)
        }
      }
      if (highestNew !== null) {
        const track = TITLE_TRACKS.find((x) => x.id === t.trackId)!
        newTitles.push({
          ...t,
          level: highestNew,
          label: titleLabelAt(track, highestNew, stats, rounds),
        })
      }
    }
    if (titleMarks.length) await saveBadges(titleMarks)

    // 自动佩戴（R31）：新解锁称号/徽章时自动换上最新的——第一轮做完海报即有标记；
    // 用户在「我的」页手动选择过佩戴（autoWear=false）则不覆盖
    const settings = useSettingsStore()
    if (settings.badgeAutoWear && newBadges.length) {
      settings.wornBadge = newBadges[newBadges.length - 1]!.id
    }
    if (settings.titleAutoWear && newTitles.length) {
      settings.wornTitle = newTitles[newTitles.length - 1]!.trackId
    }

    return { badges: newBadges, newTitles }
  } catch (e) {
    console.warn('保存记录失败：', e)
    return { badges: [], newTitles: [] }
  }
}

/** 测试用 */
export function _resetPersisted() {
  persisted.clear()
}
