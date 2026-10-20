/**
 * 回归测试：模型输出**下标** ↔ 标签原文的对齐（2026-10-16 实测事故）
 *
 * 事故经过：图像侧对表产物曾只保留种级标签（剔除了 1339 条非鸟/上位分类标签），
 * 而运行时用 `Object.keys(entries)[i]` 取标签 —— 于是 2498 个下标**全部错位**，
 * 每个识别结果都会挂到完全不相干的物种上，且不报任何错。
 *
 * 现在产物带 `labels`（全量、有序、含被过滤标签），运行时按下标取；
 * 缺 `labels` 必须直接报错，不许退回 `Object.keys(entries)`。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadLabelMap } from '../labels'
import type { LabelMapFile } from '../types'

/** 造一个「前 3 个是非鸟/上位分类标签」的产物，模拟真实 SpeciesNet 布局 */
const MAP = {
  task: 'image',
  model: 'model/speciesnet-labels.txt',
  generatedAt: '2026-10-16T00:00:00.000Z',
  classCount: 5,
  labels: [
    'brown rat', // 下标 0：非鸟，无映射
    'corvus order', // 下标 1：上位分类标签，无映射
    'erithacus rubecula_european robin', // 下标 2：有映射
    'bird', // 下标 3：类目标签，无映射
    'parus major_great tit', // 下标 4：有映射
  ],
  labelCount: 5,
  speciesLabelCount: 2,
  exactRate: 1,
  tiers: { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0 },
  entries: {
    'erithacus rubecula_european robin': { s: 'erithacus-rubecula', t: 1, z: '欧亚鸲', g: null },
    'parus major_great tit': { s: 'parus-major', t: 1, z: '大山雀', g: null },
  },
} as unknown as LabelMapFile

/** labels 是可选字段，但下标对齐的前提就是它存在 —— 这里固定成必用来断言 */
const LABELS = MAP.labels as string[]

describe('模型标签下标对齐（image）', () => {
  it('下标 2 必须是 erithacus rubecula，而不是 entries 里的另一条', () => {
    // entries 的键比 labels 短且顺序对不上 —— 模型说下标 2 时，
    // Object.keys(entries)[2] 是 undefined，越界取不到；若没过滤掉前两个标签就会取到别的种
    expect(LABELS[2]).toBe('erithacus rubecula_european robin')
    expect(Object.keys(MAP.entries)[2]).toBeUndefined()
    expect(Object.keys(MAP.entries).length).not.toBe(LABELS.length)
  })

  it('labels 覆盖全部模型类别，含被过滤的非鸟/上位分类标签', () => {
    expect(LABELS).toHaveLength(MAP.classCount as number)
    expect(LABELS).toContain('bird')
    expect(LABELS).toContain('corvus order')
    // 但这些标签没有映射条目
    expect(MAP.entries['bird' as keyof typeof MAP.entries]).toBeUndefined()
  })

  it('classCount 与 labels.length 必须一致', () => {
    expect(MAP.classCount).toBe(LABELS.length)
  })
})

describe('loadLabelMap 按任务分别缓存（音频/图像下标不能串）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('audio 与 image 各请求一次，返回不同的产物', async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
    >(async (url) => {
      const href = String(url)
      const task = href.includes('audio') ? 'audio' : 'image'
      return {
        ok: true,
        json: async () =>
          ({
            task,
            model: `model/${task}`,
            classCount: 1,
            labels: task === 'audio' ? ['audio-label'] : ['image-label'],
            labelCount: 1,
            exactRate: 1,
            tiers: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 },
            entries: { [`${task}-label`]: { s: task, t: 1, z: task } },
          }) as unknown as LabelMapFile,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const audio = await loadLabelMap('audio')
    const image = await loadLabelMap('image')
    expect(audio.labels).toEqual(['audio-label'])
    expect(image.labels).toEqual(['image-label'])
    // 第二次同任务命中缓存，不再请求
    await loadLabelMap('audio')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})