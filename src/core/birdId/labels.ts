/**
 * 加载 model-labels-<task>.json 并把模型输出映射成本项目物种
 *
 * 产物由 `npm run build:model-labels` 生成（633KB，6336 条精确命中）。
 * 运行时只读这一个文件，不再做任何匹配计算。
 */
import { TIER_EXACT, TIER_EN, TIER_ZH, type BirdIdResult, type Candidate, type LabelMapFile } from './types'

/**
 * 按任务分别缓存。
 *
 * 旧实现只有一个全局 cache：页面启动时先 load('audio') 再 load('image')，
 * 第二次会直接拿到音频产物，图像推理就会按音频标签解释下标（反之亦然）。
 * 图像侧下线时没暴露，但恢复图像后这是**静默错种**级 bug，必须先修。
 */
const mapCache = new Map<string, LabelMapFile>()

export async function loadLabelMap(task = 'audio'): Promise<LabelMapFile> {
  const hit = mapCache.get(task)
  if (hit) return hit
  const url = `${import.meta.env.BASE_URL}data/model-labels-${task}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to load label map: ${res.status} ${url}`)
  const map = (await res.json()) as LabelMapFile
  // 必须走 labels：entries 是**过滤后**的映射表（图像侧剔除了非鸟与上位分类标签），
  // 用 Object.keys(entries) 当下标表会让每个预测都挂到不相干的物种上。
  // 老产物没有 labels 字段时宁可报错，也不要静默给出错误物种。
  if (!Array.isArray(map.labels) || !map.labels.length) {
    throw new Error(`label map has no "labels" index array: ${url} (rebuild via build:model-labels)`)
  }
  mapCache.set(task, map)
  return map
}

export function labelMapReady(task = 'audio'): LabelMapFile | null {
  return mapCache.get(task) ?? null
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

/**
 * 把原始推理输出整理成 BirdIdResult（分数已归一化到 0~1）
 *
 * 剔除 `entry === null` 的候选：图像侧 top-1 几乎恒是 `bird` 这类上位分类标签
 * （概率饱和到 99.9%，实测没有区分度），留在候选里只会挤掉真正的种。
 * 故图像侧要多取一些原始 topK 再过滤（见 index.ts 的 topN）。
 *
 * 注意：标签必须从**本次传入的 map** 取，不能用全局变量 —— 音频与图像
 * 两套标签的下标含义完全不同，混用会静默返回错种。
 */
export function toResult(
  indices: number[],
  scores: number[],
  map: LabelMapFile,
  durationSec: number,
  windows: number,
): BirdIdResult {
  const labels = map.labels ?? []
  const all = indices.map((i) => labels[i] ?? '').map((label, k) => {
    const entry = map.entries[label] ?? null
    return {
      label,
      score: scores[k] ?? 0,
      entry,
      speciesId: entry && entry.t <= TIER_ZH ? entry.s : null,
    }
  })
  const candidates = all.filter((c) => c.entry !== null)
  if (import.meta.env.DEV) {
    // 本地实测用：把原始 top-N（含被剔除的无映射标签）打出来，
    // 否则「模型说了什么」与「页面显示什么」对不上时无从查证。
    console.info(
      `[birdId] raw top${all.length} -> kept ${candidates.length} (dropped ${all.length - candidates.length})`,
      all.map((c) => `${(c.score * 100).toFixed(1)}% ${c.label}${c.entry ? '' : ' [unmapped]'}`),
    )
  }
  return {
    candidates,
    skippedUnmapped: all.length - candidates.length,
    durationSec,
    windows,
  }
}

export { TIER_EXACT, TIER_EN, TIER_ZH }
