/**
 * 加载 model-labels-<task>.json 并把模型输出映射成本项目物种
 *
 * 产物由 `npm run build:model-labels` 生成（633KB，6336 条精确命中）。
 * 运行时只读这一个文件，不再做任何匹配计算。
 */
import { TIER_EXACT, TIER_EN, TIER_ZH, type BirdIdResult, type Candidate, type LabelMapFile } from './types'

let cache: LabelMapFile | null = null
/** 标签按模型输出索引排列的数组 —— 推理只回传索引，映射时按下标取，避免每次重建 6522 个字符串 */
let labelArray: string[] = []

export async function loadLabelMap(task = 'audio'): Promise<LabelMapFile> {
  if (cache) return cache
  const url = `${import.meta.env.BASE_URL}data/model-labels-${task}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载模型标签表失败：${res.status} ${url}`)
  cache = (await res.json()) as LabelMapFile
  labelArray = Object.keys(cache.entries)
  return cache
}

export function labelMapReady(): LabelMapFile | null {
  return cache
}

export function mapCandidates(
  labels: string[],
  scores: number[],
  map: LabelMapFile,
): Candidate[] {
  return labels.map((label, i) => {
    const entry = map.entries[label] ?? null
    return {
      label,
      score: scores[i] ?? 0,
      entry,
      speciesId: entry && entry.t <= TIER_ZH ? entry.s : null,
    }
  })
}

/** 按模型输出索引取标签（越界返回空串，宁可显示无命中也不崩） */
export function labelAt(i: number): string {
  return labelArray[i] ?? ''
}

/** 把原始推理输出整理成 BirdIdResult（分数已归一化到 0~1） */
export function toResult(
  indices: number[],
  scores: number[],
  map: LabelMapFile,
  durationSec: number,
  windows: number,
): BirdIdResult {
  const labels = indices.map((i) => labelAt(i))
  return { candidates: mapCandidates(labels, scores, map), durationSec, windows }
}

export { TIER_EXACT, TIER_EN, TIER_ZH }
