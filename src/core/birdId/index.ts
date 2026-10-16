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
 * SpeciesNet v4.0.3b full_image 实测契约是 NHWC `['batch', 480, 480, 3]`
 * —— 注意**不是**常见的 NCHW，也不是 224。弄错会直接报
 * 「Got invalid dimensions for input」。
 */
export const IMAGE_SIZE = 480

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
 * 任意图片 → 模型输入张量。
 * 做法：等比缩放到不超过 IMAGE_SIZE 的最长边，再中心裁成正方形，
 * 最后按 ImageNet 口径归一化（均值/方差减均值除标准差）。
 * 中心裁剪会切掉长焦照片的边缘，故先留边（letterbox）到正方形更稳 —— 这里取留边。
 */
export async function prepareImage(blob: Blob, size = IMAGE_SIZE): Promise<Float32Array> {
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    // 等比缩放后居中留边，避免裁掉主体
    const scale = Math.min(size / bmp.width, size / bmp.height)
    const w = bmp.width * scale
    const h = bmp.height * scale
    ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h)
    const { data } = ctx.getImageData(0, 0, size, size)
    // SpeciesNet 的预处理是 **/255 归一化到 0~1 + NHWC**（不是 ImageNet 的
    // mean/std 标准化，也不是 NCHW）。本地 image_eval.py 已按此口径验证过。
    // 逐像素把 RGB 三个通道写进 NHWC 布局的相邻位置
    const out = new Float32Array(size * size * 3)
    for (let px = 0; px < size * size; px++) {
      out[px * 3] = (data[px * 4] ?? 0) / 255
      out[px * 3 + 1] = (data[px * 4 + 1] ?? 0) / 255
      out[px * 3 + 2] = (data[px * 4 + 2] ?? 0) / 255
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
