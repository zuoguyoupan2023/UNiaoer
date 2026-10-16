/**
 * 一次性诊断：复现「浏览器那份 ORT 构建」（ort.bundle.min.mjs，wasm 内嵌 base64）
 * 与 Node 构建（ort.node.min.js，外链 wasm）的差异。
 *   node experiments/birdid/wasm_bundle_vs_node.mjs <图片...>
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ort = await import('../../node_modules/onnxruntime-web/dist/ort.bundle.min.mjs')
ort.env.wasm.numThreads = 1

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

console.log('ort 版本:', ort.env.versions?.common ?? '?')
const sess = await ort.InferenceSession.create(fs.readFileSync('public/models/speciesnet-whole.onnx'), {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})

for (const f of process.argv.slice(2)) {
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', prep(f), [1, S, S, 3]) })
  const flat = out[sess.outputNames[0]].data
  let mn = Infinity, mx = -Infinity
  for (const v of flat) { if (v < mn) mn = v; if (v > mx) mx = v }
  const sc = Float32Array.from(flat, (v) => 1 / (1 + Math.exp(-v)))
  const idx = [...sc.keys()].sort((a, b) => sc[b] - sc[a]).slice(0, 5)
  console.log(`\n${path.basename(path.dirname(f))}  logit 范围 [${mn.toFixed(2)}, ${mx.toFixed(2)}]`)
  for (const i of idx) console.log(`   ${(sc[i] * 100).toFixed(1)}%  ${LABELS[i]}`)
}