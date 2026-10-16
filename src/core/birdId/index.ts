/**
 * 端上识鸟对外入口：解码 → Worker 推理 → 对表 → 置信度分流
 *
 * 全程端上，音频不离开设备（055 §5.3）。
 */
import { loadLabelMap, toResult } from './labels'
import { ensureModel } from './modelCache'
import { present } from './confidence'
import type { Presented } from './confidence'
import type { BirdIdResult } from './types'
import type { InferResponse, InferError } from './worker'

export { loadLabelMap } from './labels'
export { ensureModel, cachedModel, modelSize, clearModelCache } from './modelCache'
export { present, bandOf, CONF_OK, CONF_LOW } from './confidence'
export type { Presented } from './confidence'
export type { ConfidenceBand, BirdIdResult, Candidate } from './types'

const SR = 48000
const WIN = 144000

/** 把任意可解码的音频（Blob/File）解成 48kHz 单声道 Float32 */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const Ctx: typeof AudioContext =
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || window.AudioContext
  const ctx = new Ctx()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (decoded.sampleRate === SR && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice()
    }
    const off = new OfflineAudioContext(1, Math.ceil((decoded.duration * SR)), SR)
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

let worker: Worker | null = null
let workerBuf: ArrayBuffer | null = null
/** 模型是否已随首条消息 transfer 给 Worker。transfer 会让本地 buffer 失效，
 *  且 Worker 侧首次 loadTFLiteModel 后就持有了模型，后续无需再传。 */
let modelSent = false

function ensureWorker(): Worker {
  if (!worker) {
    // module worker。注：曾试过 classic worker（tfjs-tflite 靠 importScripts 注入
    // wasm，而 ES module worker 不支持 importScripts），但 iife 产物里残留 CommonJS 的
    // `exports` 引用，在 classic worker 下同样抛错 —— 见 docs/055 §8「运行时阻塞」。
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

/** 跑一次识别。onProgress 用于回传模型下载进度。 */
export async function identify(
  blob: Blob,
  onProgress?: (received: number, total: number) => void,
): Promise<{ result: BirdIdResult; view: Presented }> {
  const map = await loadLabelMap('audio')
  const samples = await decodeAudio(blob)
  if (samples.length < WIN * 0.25) throw new Error('录音太短，至少需要 1 秒')

  const buffer = workerBuf ?? (workerBuf = await ensureModel(onProgress))
  const w = ensureWorker()
  // Worker 重启后 modelSent 要跟着复位，否则它会以为还持有模型
  modelSent = false

  const res = (await new Promise<InferResponse>((resolve, reject) => {
    const onMsg = (ev: MessageEvent<InferResponse | InferError>) => {
      if (ev.data.type === 'error') reject(new Error(ev.data.message))
      else resolve(ev.data)
      w.removeEventListener('message', onMsg)
    }
    w.addEventListener('message', onMsg)
    const payload: Record<string, unknown> = {
      type: 'infer',
      samples,
      windowSize: WIN,
      hop: WIN >> 1,
      topN: 5,
    }
    if (!modelSent) {
      // 模型必须**放进消息体**，只放进 transfer 列表等于什么都没传（Transferable
      // 必须在 structured clone 的消息里）。transfer 零拷贝；transfer 后本地 buffer
      // 失效，故只发这一次，Worker 侧 loadTFLiteModel 后自己持有。
      payload.buffer = buffer
      modelSent = true
      w.postMessage(payload, [buffer])
    } else {
      w.postMessage(payload)
    }
  })) as InferResponse

  const result = toResult(res.indices, res.scores, map, samples.length / SR, res.windows)
  return { result, view: present(result, 3) }
}

export function disposeBirdId(): void {
  worker?.terminate()
  worker = null
  workerBuf = null
  modelSent = false
}
