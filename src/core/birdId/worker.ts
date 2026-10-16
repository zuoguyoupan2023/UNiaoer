/// <reference lib="webworker" />

/**
 * 识别推理 Worker —— 全部在 Worker 线程，主线程不卡
 *
 * ## 运行时为什么是 ONNX Runtime Web 而不是 tfjs-tflite
 *
 * `@tensorflow/tfjs-tflite@0.0.1-alpha.10` 在浏览器里连不起来，踩了四处不兼容
 * （详见 docs/055 §8.3）：包根 import 一个只有 .d.ts 没有 .js 的文件、
 * iife worker 里 `exports is not defined`、module worker 拒绝 `importScripts`、
 * WASM 实例化拿到未初始化的 Module。
 *
 * BirdNET v2.4 的 ONNX 是**现成发布**的（huggingface.co/tphakala/BirdNET-v2.4），
 * 输入输出契约与 TFLite 完全一致，故对表产物与门禁一行都不用改。见 docs/056 §2。
 *
 * ## 模型契约（实测，非猜测）
 *
 *   输入  input  ['batch', 144000] float32 = 48kHz × 3 秒
 *   输出  output ['batch', 6522]    float32 = 6,522 类（logits，需 sigmoid）
 *
 * 支持 batch → 一次 forward 跑完全部滑窗，比 TFLite 逐窗推理高效得多。
 */

import * as ort from 'onnxruntime-web'

export type TaskKind = 'audio' | 'image'

export interface InferRequest {
  kind: TaskKind
  /** 模型权重；仅首条消息携带，之后 Worker 自己持有 */
  buffer?: ArrayBuffer
  /** kind=audio：48kHz 单声道。kind=image：RGB 张量（已归一化） */
  samples?: Float32Array
  /** kind=image：输入宽高（整除到模型要求且保持长宽比） */
  imageSize?: [number, number]
  /** kind=audio：每窗样本数 / 步长 / 最多窗数 */
  windowSize?: number
  hop?: number
  maxWindows?: number
  topN?: number
}

export interface InferResponse {
  type: 'result'
  indices: number[]
  scores: number[]
  /** audio=实际窗数；image=1 */
  windows: number
  elapsedMs: number
}

export interface InferError {
  type: 'error'
  message: string
}

export type InferOut = InferResponse | InferError

const SR = 48000
const WIN = 144000
const post = (m: InferOut) => (self as unknown as { postMessage: (v: InferOut) => void }).postMessage(m)

// 每种任务一个 session，模型只初始化一次
const sessions: Partial<Record<TaskKind, ort.InferenceSession>> = {}
const loading: Partial<Record<TaskKind, Promise<ort.InferenceSession>>> = {}

async function getSession(kind: TaskKind, buffer: ArrayBuffer) {
  if (sessions[kind]) return sessions[kind]!
  if (!loading[kind]) {
    loading[kind] = (async () => {
      const s = await ort.InferenceSession.create(buffer, {
        // WASM 而非 WebGPU：ORT-web 的 wasm EP 在各浏览器上行为最一致；
        // WebGPU EP 仍处实验阶段，且大模型在移动 GPU 上常因显存/驱动回退。
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
      sessions[kind] = s
      return s
    })()
  }
  return loading[kind]!
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

function topK(scores: Float32Array | Float64Array, k: number) {
  const order = Array.from(scores.keys()).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0)).slice(0, k)
  return { order, values: order.map((i) => Number(scores[i] ?? 0)) }
}

self.onmessage = async (ev: MessageEvent<InferRequest>) => {
  const req = ev.data
  if (!req) return
  const t0 = Date.now()
  try {
    if (!req.buffer) throw new Error('缺少模型 buffer：权重没有随消息送达（见 docs/056 §2）')
    const s = await getSession(req.kind, req.buffer)
    const inName = s.inputNames[0]!
    const outName = s.outputNames[0]!
    let res: InferResponse

    if (req.kind === 'image') {
      // SpeciesNet v4.0.3b full_image 的契约是 **NHWC** `['batch', 480, 480, 3]`。
      // 曾按常见的 NCHW 建成 [1,3,224,224]，ORT 直接报
      // 「Got invalid dimensions for input: image」（index 1 期望 480 却给了 3）。
      const [w, h] = req.imageSize ?? [480, 480]
      const n = 1
      const tensor = new ort.Tensor('float32', req.samples!, [n, h, w, 3])
      const out = await s.run({ [inName]: tensor })
      const flat = out[outName]!.data as Float32Array
      // 输出可能是 logits 或已归一化的概率，两种都归一到 0~1。
      // 原实现只取**前 50 类**判量级，若恰好那 50 类都是低分(logit << 0)，
      // 就会把 logits 当成已归一化的概率，sigmoid 整个漏掉。
      // 改成对**全量**判断，并在真概率时归一化而非原样使用。
      let mx = -Infinity
      let mn = Infinity
      for (let i = 0; i < flat.length; i++) {
        const v = Number(flat[i] ?? 0)
        if (v > mx) mx = v
        if (v < mn) mn = v
      }
      const looksLikeLogits = mn < -0.01 || mx > 1.01
      const sc = new Float32Array(flat.length)
      if (looksLikeLogits) {
        for (let i = 0; i < flat.length; i++) sc[i] = sigmoid(Number(flat[i] ?? 0))
      } else {
        let sum = 0
        for (let i = 0; i < flat.length; i++) sum += Math.max(0, Number(flat[i] ?? 0))
        for (let i = 0; i < flat.length; i++) sc[i] = sum > 0 ? Math.max(0, Number(flat[i] ?? 0)) / sum : 0
      }
      const { order, values } = topK(sc, req.topN || 5)
      res = { type: 'result', indices: order, scores: values, windows: 1, elapsedMs: Date.now() - t0 }
    } else {
      const win = req.windowSize || WIN
      const hop = req.hop || win >> 1
      const maxW = req.maxWindows || 12
      const sig = req.samples ?? new Float32Array()
      const nWin = sig.length > win ? Math.floor((sig.length - win) / hop) + 1 : 1
      const picks: number[] =
        nWin <= maxW
          ? Array.from({ length: nWin }, (_, i) => i)
          : Array.from({ length: maxW }, (_, k) => Math.round((k * (nWin - 1)) / (maxW - 1)))

      // 一次 forward 跑完全部窗（ONNX 支持 batch）
      const batch = new Float32Array(picks.length * win)
      picks.forEach((i, j) => {
        const start = i * hop
        const avail = Math.min(win, Math.max(0, sig.length - start))
        if (avail > 0) batch.set(sig.subarray(start, start + avail), j * win)
      })
      const tensor = new ort.Tensor('float32', batch, [picks.length, win])
      const out = await s.run({ [inName]: tensor })
      const raw = out[outName]!.data as Float32Array
      const nClass = raw.length / picks.length
      const med = new Float32Array(nClass)
      for (let c = 0; c < nClass; c++) {
        const vals: number[] = []
        for (let j = 0; j < picks.length; j++) vals.push(sigmoid(Number(raw[j * nClass + c] ?? 0)))
        vals.sort((a, b) => a - b)
        med[c] = vals[vals.length >> 1] ?? 0
      }
      const { order, values } = topK(med, req.topN || 5)
      res = {
        type: 'result',
        indices: order,
        scores: values,
        windows: picks.length,
        elapsedMs: Date.now() - t0,
      }
    }
    post(res)
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export { SR, WIN }
