/**
 * 一次性诊断：缩放算法是否影响 SpeciesNet 的判断。
 * canvas 默认 imageSmoothingQuality='low' ≈ 一次性双线性；ffmpeg 默认 bicubic。
 * 若两者结果差异巨大 → 浏览器里的低质量缩放就是识别变差的原因。
 *   node experiments/birdid/scaler_sweep.mjs <图片...>
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ort = await import('../../node_modules/onnxruntime-web/dist/ort.bundle.min.mjs')
ort.env.wasm.numThreads = 1

const LABELS = fs.readFileSync('public/models/speciesnet-labels.txt', 'utf8').split('\n').filter(Boolean)
const S = 480
const sess = await ort.InferenceSession.create(fs.readFileSync('public/models/speciesnet-whole.onnx'), {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})

const FLAGS = {
  'bilinear(≈canvas low)': 'bilinear',
  'bicubic(ffmpeg 默认)': 'bicubic',
  'lanczos': 'lanczos',
  'area(≈canvas high)': 'area',
}

function prep(file, flag) {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-sws_flags', flag, '-i', file,
    '-vf', `scale=${S}:${S}:force_original_aspect_ratio=decrease,pad=${S}:{S}:(ow-iw)/2:(oh-ih)/2:color=black`.replace('{S}', String(S)),
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 1 << 30 })
  const u8 = new Uint8Array(buf)
  const f32 = new Float32Array(u8.length)
  for (let i = 0; i < u8.length; i++) f32[i] = u8[i] / 255
  return f32
}

async function top5(file, flag) {
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', prep(file, flag), [1, S, S, 3]) })
  const sc = Float32Array.from(out[sess.outputNames[0]].data, (v) => 1 / (1 + Math.exp(-v)))
  const idx = [...sc.keys()].sort((a, b) => sc[b] - sc[a]).slice(0, 5)
  return idx.map((i) => `${(sc[i] * 100).toFixed(1)}% ${LABELS[i].split(';').pop()}`)
}

for (const f of process.argv.slice(2)) {
  console.log(`\n══ ${path.basename(path.dirname(f))}/${path.basename(f)} ══`)
  for (const [name, flag] of Object.entries(FLAGS)) {
    console.log(`  ${name.padEnd(22)}`, (await top5(f, flag)).join(' · '))
  }
}