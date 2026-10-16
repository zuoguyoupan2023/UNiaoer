/**
 * 一次性诊断：同图对比「Python CPU(fp16)」与「浏览器同款 ORT-web wasm(fp16)」的 top-5。
 * 若 wasm 侧输出与输入无关（恒定同一个种），即 fp16 权重在 wasm EP 下退化。
 *   node experiments/birdid/wasm_vs_cpu.mjs <图片>
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ort = require('onnxruntime-web')
const distDir = path.dirname(require.resolve('onnxruntime-web'))
ort.env.wasm.wasmPaths = distDir.endsWith('/') ? distDir : `${distDir}/`
ort.env.wasm.numThreads = 1

const MODEL = 'public/models/speciesnet-whole.onnx'
const LABELS = fs.readFileSync('public/models/speciesnet-labels.txt', 'utf8').split('\n').filter(Boolean)
const S = 480

function prep(file) {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `scale=${S}:${S}:force_original_aspect_ratio=decrease,pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 1 << 30 })
  const u8 = new Uint8Array(buf)
  const f32 = new Float32Array(u8.length)
  for (let i = 0; i < u8.length; i++) f32[i] = u8[i] / 255
  return f32
}

function top5(scores) {
  const idx = [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, 5)
  return idx.map((i) => `${(scores[i] * 100).toFixed(1)}% ${LABELS[i]}`)
}

const sess = await ort.InferenceSession.create(fs.readFileSync(MODEL), {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})
console.log('输入契约:', sess.inputNames, sess.inputMetadata?.[0] ?? '')
console.log('输出契约:', sess.outputNames)

for (const f of process.argv.slice(2)) {
  const t = prep(f)
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', t, [1, S, S, 3]) })
  const flat = out[sess.outputNames[0]].data
  let mn = Infinity, mx = -Infinity, sum = 0
  for (const v of flat) { mn = Math.min(mn, v); mx = Math.max(mx, v); sum += Math.max(0, v) }
  const sc = mn < -0.01 || mx > 1.01
    ? Float32Array.from(flat, (v) => 1 / (1 + Math.exp(-v)))
    : Float32Array.from(flat, (v) => Math.max(0, v) / sum)
  console.log(`\n${f}\n  原始范围 [${mn.toFixed(2)}, ${mx.toFixed(2)}] 视为${sc === undefined ? '' : mn < -0.01 ? 'logits' : '概率'}`)
  for (const l of top5(sc)) console.log('   ', l)
}