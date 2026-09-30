import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addReport, clearReports, countReports, listReports, _resetReportDb } from '../reportStore'

function sample(over: Partial<Parameters<typeof addReport>[0]> = {}) {
  return {
    speciesId: 'turdus-merula',
    speciesName: '乌鸫',
    sci: 'Turdus merula',
    questionType: 'image' as const,
    mediaUrl: 'https://bird.wewalk.world/media/turdus-merula/image-1.full.webp',
    reason: 'image' as const,
    ...over,
  }
}

describe('reportStore（G1 本地报错）', () => {
  beforeEach(async () => {
    _resetReportDb()
    await clearReports()
  })

  it('新增并读取，按时间倒序', async () => {
    await addReport(sample({ reason: 'image' }))
    await addReport(sample({ reason: 'answer', suggestedAnswer: '灰背鸫' }))
    const all = await listReports()
    expect(all).toHaveLength(2)
    // 时间倒序（同毫秒时保持插入顺序的稳定性不做保证，这里只校验最新在首）
    expect(all[0]!.at).toBeGreaterThanOrEqual(all[1]!.at)
    expect(all.map((r) => r.reason)).toContain('answer')
  })

  it('保留可选字段（建议答案/补充）与快照字段', async () => {
    const row = await addReport(
      sample({ reason: 'audio', suggestedAnswer: '灰背鸫', note: '录音像别的鸟' }),
    )
    expect(row.id).toBeTruthy()
    expect(row.suggestedAnswer).toBe('灰背鸫')
    expect(row.note).toBe('录音像别的鸟')
    expect(row.speciesId).toBe('turdus-merula')
    expect(row.questionType).toBe('image')
  })

  it('countReports / clearReports', async () => {
    await addReport(sample())
    await addReport(sample())
    expect(await countReports()).toBe(2)
    await clearReports()
    expect(await countReports()).toBe(0)
  })
})
