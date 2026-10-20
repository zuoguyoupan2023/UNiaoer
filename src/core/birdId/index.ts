/**
 * 端上识鸟对外入口：解码 → Worker 推理 → 对表 → 置信度分流
 *
 * 全程端上，音频与图片都不离开设备（docs/055 §5.3）。
 * 音频与图像**共用**同一个 Worker 与同一套对表/置信度逻辑，
 * 这样「先用声音认出鸟 → 再用照片确认」只需换一个 task，不需重写流程。
 */
import { loadLabelMap, toResult } from './labels'
import { ensureModel } from './modelCache'
import { present } from './confidence'
import { rerankByRegion } from './regionPrior'
import type { Presented } from './confidence'
import type { BirdIdResult } from './types'
import type { InferResponse, InferError } from './worker'
import { MODELS, type TaskName } from './weights'

export { loadLabelMap } from './labels'
export { ensureModel, cachedModel, modelSize, clearModelCache } from './modelCache'
export { MODELS, weightsUrl, labelsUrl } from './weights'
export type { TaskName } from './weights'
export { present, bandOf, CONF_OK, CONF_LOW } from './confidence'
export type { Presented } from './confidence'
export { rerankByRegion, applyRegionPrior, loadTierMap } from './regionPrior'
export type { ConfidenceBand, BirdIdResult, Candidate } from './types'

const SR = 48000
const WIN = 144000

/**
 * 图像模型的输入边长。
 *
 * 2026-10-20 起图像模型换成 **OSEA ResNet34**：
 *   输入 `[1, 3, 224, 224]`（NCHW），ImageNet mean/std 标准化，squash 到 224。
 * 旧的 SpeciesNet 是 NHWC 480 + /255，两者契约完全不同；不要再复用旧常量。
 */
export const IMAGE_SIZE = 224

/**
 * 调试用：描述「真正喂给模型的张量」。
 * 本地与浏览器结果对不上时，只有像素指纹能定位（2026-10-16 实测踩过：
 * 同一份权重、同一套 ORT，浏览器与 Python 给出的物种完全不同）。
 * 打印 8×8 亮度网格，两边逐格比对即可判断是解码/缩放出了问题还是模型的问题。
 */
function describeTensor(
  out: Float32Array,
  size: number,
  rgba: Uint8ClampedArray,
  bmp: ImageBitmap,
): string {
  let mn = 1
  let mx = 0
  let sum = 0
  for (let i = 0; i < out.length; i++) {
    const v = out[i]!
    if (v < mn) mn = v
    if (v > mx) mx = v
    sum += v
  }
  const step = size / 8
  const grid: string[] = []
  for (let gy = 0; gy < 8; gy++) {
    let row = ''
    for (let gx = 0; gx < 8; gx++) {
      const px = Math.min(size - 1, Math.round((gy + 0.5) * step))
      const p = (px * size + Math.round((gx + 0.5) * step)) * 4
      const g = Math.round((rgba[p] ?? 0) * 0.299 + (rgba[p + 1] ?? 0) * 0.587 + (rgba[p + 2] ?? 0) * 0.114)
      row += String(g).padStart(4)
    }
    grid.push(row)
  }
  return (
    `src ${bmp.width}x${bmp.height} -> ${size}x${size} · len ${out.length} · ` +
    `min ${mn.toFixed(3)} max ${mx.toFixed(3)} mean ${(sum / out.length).toFixed(4)}\n` +
    `8x8 luma grid:\n${grid.join('\n')}`
  )
}

/** 任意音频 → 48kHz 单声道 Float32 */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const Ctx: typeof AudioContext =
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || window.AudioContext
  const ctx = new Ctx()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (decoded.sampleRate === SR && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice()
    }
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    const out = await off.startRendering()
    return out.getChannelData(0).slice()
  } finally {
    void ctx.close()
  }
}

/**
 * 任意图片 → OSEA 输入张量。
 *
 * 做法（2026-10-20 实测）：
 *   1. 取**中心正方形**（短边的 90%，留 5% 边），而不是 letterbox；
 *   2. squash 到 224×224（不做等比留边，OSEA 官方 CLI 就是直接 resize）；
 *   3. ImageNet mean/std 标准化；
 *   4. 写成 **NCHW** `[1,3,224,224]`。
 *
 * 为什么不用 letterbox：同一批 79 张真实素材上，中心裁剪 top-1 81.0% / top-3 91.1%，
 * letterbox 只有 74.7% / 84.8%（squash 全程 78.5% / 88.6%）。
 * 中心裁剪的代价是鸟不在画面中央时可能切掉主体；后续若接检测器，应改成“检测框裁剪”。
 */
export async function prepareImage(blob: Blob, size = IMAGE_SIZE): Promise<Float32Array> {
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')

    // 短边的 90% 作为正方形；0.8 / 0.9 实测同为 81.0% / 91.1%，取 0.9 保留更多上下文。
    const side = Math.min(bmp.width, bmp.height) * 0.9
    const sx = (bmp.width - side) / 2
    const sy = (bmp.height - side) / 2
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size)

    const { data } = ctx.getImageData(0, 0, size, size)
    const mean = [0.485, 0.456, 0.406] as const
    const std = [0.229, 0.224, 0.225] as const
    const out = new Float32Array(3 * size * size)
    const plane = size * size
    for (let px = 0; px < plane; px++) {
      out[px] = ((data[px * 4] ?? 0) / 255 - mean[0]) / std[0]
      out[plane + px] = ((data[px * 4 + 1] ?? 0) / 255 - mean[1]) / std[1]
      out[2 * plane + px] = ((data[px * 4 + 2] ?? 0) / 255 - mean[2]) / std[2]
    }
    if (import.meta.env.DEV) console.info(`[birdId] image tensor ${describeTensor(out, size, data, bmp)}`)
    return out
  } finally {
    bmp.close()
  }
}

let worker: Worker | null = null
/** 已随消息 transfer 给 Worker 的模型，避免每轮拷几十 MB */
const sentModels = new Set<TaskName>()

function ensureWorker(): Worker {
  if (!worker) {
    // module worker：onnxruntime-web 是标准 ESM，不依赖 importScripts
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

async function runInfer(
  task: TaskName,
  payload: Record<string, unknown>,
  topN: number,
  onProgress?: (received: number, total: number) => void,
) {
  const ref = MODELS[task]
  const buffer = await ensureModel(ref, onProgress)
  const w = ensureWorker()
  sentModels.delete(task)
  const msg: Record<string, unknown> = { kind: task, ...payload, topN }
  msg.buffer = buffer
  sentModels.add(task)
  return (await new Promise<InferResponse>((resolve, reject) => {
    const onMsg = (ev: MessageEvent<InferResponse | InferError>) => {
      if (ev.data.type === 'error') reject(new Error(ev.data.message))
      else resolve(ev.data)
      w.removeEventListener('message', onMsg)
    }
    w.addEventListener('message', onMsg)
    w.postMessage(msg, [buffer])
  })) as InferResponse
}

/**
 * 识别一段音频
 * @param region 地区键（`CN` / `CN-11` / `ALL`），用于按当地常见度重排候选
 */
export async function identifyAudio(
  blob: Blob,
  onProgress?: (received: number, total: number) => void,
  region = 'ALL',
): Promise<{ result: BirdIdResult; view: Presented }> {
  const map = await loadLabelMap('audio')
  const samples = await decodeAudio(blob)
  if (samples.length < WIN * 0.25) throw new Error('too-short')
  const res = await runInfer(
    'audio',
    { samples, windowSize: WIN, hop: WIN >> 1, maxWindows: 12 },
    5,
    onProgress,
  )
  const result = toResult(res.indices, res.scores, map, samples.length / SR, res.windows)
  result.candidates = await rerankByRegion(result.candidates, region)
  return { result, view: present(result, 3) }
}

/**
 * 图像侧的原始 topK 取 12：概率饱和到 99.9% 且 top-1 恒是 `bird` 这类无映射标签，
 * 少取几个就会把真正的种挤掉（labels.ts 的 toResult 会剔掉无映射候选）。
 */
const IMAGE_TOP_K = 12

/**
 * 识别一张图片
 * @param region 地区键（`CN` / `CN-11` / `ALL`），用于按当地常见度重排候选
 */
export async function identifyImage(
  blob: Blob,
  onProgress?: (received: number, total: number) => void,
  region = 'ALL',
): Promise<{ result: BirdIdResult; view: Presented }> {
  const map = await loadLabelMap('image')
  const samples = await prepareImage(blob)
  const res = await runInfer(
    'image',
    { samples, imageSize: [IMAGE_SIZE, IMAGE_SIZE] },
    IMAGE_TOP_K,
    onProgress,
  )
  const result = toResult(res.indices, res.scores, map, 0, 1)
  result.candidates = await rerankByRegion(result.candidates, region)
  return { result, view: present(result, 3) }
}

export function disposeBirdId(): void {
  worker?.terminate()
  worker = null
  sentModels.clear()
}
