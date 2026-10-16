/**
 * 识别推理 Worker —— 全部在 Worker 线程，主线程不卡
 *
 * 模型契约（BirdNET+ 2.4 实测，非猜测）：
 *   输入  (1, 144000) float32 = 48kHz × 3 秒
 *   输出  (1, 6522)    float32 = 6,522 类（输出的是 logits，需过 sigmoid）
 *
 * 运行时用 @tensorflow/tfjs-tflite（唯一能在浏览器直接吃 TFLite 权重的公开方案；
 * onnxruntime-web 需要 ONNX 权重，而 tflite2onnx 转不动这个模型 —— 图内有 REDUCE_MIN）。
 */

/// <reference lib="webworker" />

export interface InferRequest {
  type: 'infer'
  /** 48kHz 单声道 Float32 的完整音频 */
  samples: Float32Array
  /** 每窗样本数，默认 144000（3 秒） */
  windowSize?: number
  /** 50% 重叠 */
  hop?: number
  /** 最多取多少窗（长录音均匀采样，避免一条 70 秒的文件跑 45 遍） */
  maxWindows?: number
  /** 要回传的候选数 */
  topN?: number
  /** 模型权重字节；**仅首条消息携带**，之后 Worker 自己持有 */
  buffer?: ArrayBuffer
}

export interface InferResponse {
  type: 'result'
  indices: number[]
  scores: number[]
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

let modelPromise: Promise<unknown> | null = null

async function getModel(buffer: ArrayBuffer) {
  if (!modelPromise) {
    modelPromise = (async () => {
      // ① 先手动引入 WASM client glue。tfjs-tflite 在 Worker 里靠 importScripts
      //    加载 emscripten 运行时，而它要先用 getWasmFeatures() 探测 SIMD/多线程支持，
      //    该探测依赖 tflite_web_api_client.js。alpha 版把该文件放在 wasm/ 下而非
      //    dist/（dist 里只有 .d.ts），所以包根入口在现代打包器下直接解析失败，
      //    我们改用自包含的 es2017 入口 + 手动补这一枪。
      importScripts('/wasm-tflite/tflite_web_api_client.js')

      // ② 预打包 ESM 入口（自包含，仅外链 tfjs-core 的 float64）
      const tflite = await import('@tensorflow/tfjs-tflite/dist/tf-tflite.es2017.js')
      // ③ 指向 public/ 下由 scripts/fetch-birdnet-model.mjs 同步拷贝的 wasm 运行时。
      //    选 simd 单线程变体：比 threaded 少 ~3.6MB，且我们已经在 Worker 里了，
      //    再套一层 pthread worker 只是白白多下一份 wasm。
      tflite.setWasmPath('/wasm-tflite/')
      return tflite.loadTFLiteModel(buffer)
    })()
  }
  return modelPromise
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

self.onmessage = async (ev: MessageEvent<InferRequest>) => {
  const req = ev.data
  if (!req || req.type !== 'infer') return
  const t0 = Date.now()
  try {
    if (!req.buffer)
      throw new Error(
        '缺少模型 buffer：识别模型的 25MB 权重没有随消息送达。若你在 Worker 里看到这条，' +
          '通常是 @tensorflow/tfjs-tflite 的 wasm 运行时加载失败（详见 docs/055 §8）。',
      )
    const model = (await getModel(req.buffer)) as {
      predict: (x: Float32Array) => { data: Float32Array | number[] }
    }

    const win = req.windowSize || WIN
    const hop = req.hop || win >> 1
    const maxW = req.maxWindows || 12
    const sig = req.samples

    // 滑窗索引，长录音均匀抽样
    const n = sig.length > win ? Math.floor((sig.length - win) / hop) + 1 : 1
    const idx: number[] = []
    if (n <= maxW) for (let i = 0; i < n; i++) idx.push(i)
    else for (let i = 0; i < maxW; i++) idx.push(Math.round((i * (n - 1)) / (maxW - 1)))

    const N_CLASS = 6522
    const acc = new Float64Array(N_CLASS)
    const buf = new Float32Array(win)
    for (const i of idx) {
      const start = i * hop
      buf.fill(0)
      const avail = Math.min(win, Math.max(0, sig.length - start))
      if (avail <= 0) continue
      buf.set(sig.subarray(start, start + avail))
      const d = model.predict(buf).data as ArrayLike<number>
      for (let c = 0; c < N_CLASS; c++) acc[c] = (acc[c] ?? 0) + sigmoid(Number(d[c] ?? 0))
    }
    const mean = new Float32Array(N_CLASS)
    const denom = Math.max(1, idx.length)
    for (let c = 0; c < N_CLASS; c++) mean[c] = (acc[c] ?? 0) / denom

    const topN = req.topN || 5
    const order: number[] = Array.from(mean.keys())
      .sort((a, b) => (mean[b] ?? 0) - (mean[a] ?? 0))
      .slice(0, topN)
    const res: InferResponse = {
      type: 'result',
      indices: order,
      scores: order.map((i) => mean[i] ?? 0),
      windows: idx.length,
      elapsedMs: Date.now() - t0,
    }
    ;(self as unknown as { postMessage: (v: InferResponse) => void }).postMessage(res)
  } catch (e) {
    const err: InferError = { type: 'error', message: e instanceof Error ? e.message : String(e) }
    ;(self as unknown as { postMessage: (v: InferError) => void }).postMessage(err)
  }
}

export { SR, WIN }
