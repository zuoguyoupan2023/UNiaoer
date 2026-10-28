import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addReport,
  applyRemoteStatuses,
  clearReports,
  countReports,
  importReports,
  listReports,
  _resetReportDb,
} from '../reportStore'

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

  it('applyRemoteStatuses（064）：合并远端状态；本地没有的 id 忽略', async () => {
    const a = await addReport(sample())
    await addReport(sample({ speciesId: 'parus-major' }))
    await applyRemoteStatuses([
      { id: a.id, status: 'fixed', updatedAt: 123 },
      { id: 'not-exists', status: 'open', updatedAt: 456 },
    ])
    const all = await listReports()
    const merged = all.find((r) => r.id === a.id)
    expect(merged?.remoteStatus).toBe('fixed')
    expect(merged?.remoteUpdatedAt).toBe(123)
    const untouched = all.find((r) => r.speciesId === 'parus-major')
    expect(untouched?.remoteStatus).toBeUndefined()
  })

  it('importReports（064）：按 id 去重合并，返回导入/跳过计数', async () => {
    const a = await addReport(sample())
    const rows = await listReports()
    const backupEntry = { ...rows[0]! }
    const imported = await importReports([
      backupEntry, // 同 id → 跳过
      { ...backupEntry, id: 'other-id', speciesId: 'parus-major' }, // 新 id → 导入
      { ...backupEntry, id: '' }, // 无 id → 跳过
    ])
    expect(imported).toEqual({ imported: 1, skipped: 2 })
    expect(await countReports()).toBe(2)
    expect((await listReports()).map((r) => r.id)).toContain('other-id')
    expect(a.id).toBeTruthy()
  })
})
