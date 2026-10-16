/**
 * 一次性诊断：这个 ONNX 是「整幅场景」模型还是「已裁切的鸟」分类器？
 * 做法：同一张图按不同裁切比例喂进去，看真值能否升到第 1。
 *   node experiments/birdid/crop_probe.mjs <图片>
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ort = await import('../../node_modules/onnxruntime-web/dist/ort.bundle.min.mjs')
ort.env.wasm.numThreads = 1

const doc = JSON.parse(fs.readFileSync('public/data/model-labels-image.json', 'utf8'))
const LABELS = doc.labels
const ENTRIES = doc.entries
const S = 480
const sess = await ort.InferenceSession.create(fs.readFileSync('public/models/speciesnet-whole.onnx'), {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})

function dims(file) {
  const o = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',file], { encoding: 'utf8' }).trim()
  const [w, h] = o.split(',').map(Number)
  return { w, h }
}

/** crop: [x0,y0,x1,y1] 归一化；null = 整幅 letterbox */
function prep(file, crop) {
  const { w, h } = dims(file)
  let vf = ''
  if (crop) {
    const cw = Math.round((crop[2] - crop[0]) * w)
    const ch = Math.round((crop[3] - crop[1]) * h)
    const cx = Math.round(crop[0] * w)
    const cy = Math.round(crop[1] * h)
    vf = `crop=${cw}:${ch}:${cx}:${cy},`
  }
  vf += `scale=${S}:${S}:force_original_aspect_ratio=decrease,pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:color=black`
  const buf = execFileSync('ffmpeg', ['-v','error','-i',file,'-vf',vf,'-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 1 << 30 })
  const u8 = new Uint8Array(buf)
  const f32 = new Float32Array(u8.length)
  for (let i = 0; i < u8.length; i++) f32[i] = u8[i] / 255
  return f32
}

async function top(file, crop, k = 3) {
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', prep(file, crop), [1, S, S, 3]) })
  const sc = Float32Array.from(out[sess.outputNames[0]].data, (v) => 1 / (1 + Math.exp(-v)))
  const order = [...sc.keys()].sort((a, b) => sc[b] - sc[a])
  return order.slice(0, 40)
    .filter((i) => LABELS[i] in ENTRIES && ENTRIES[LABELS[i]].s)
    .slice(0, k)
    .map((i) => `${(sc[i] * 100).toFixed(1)}% ${ENTRIES[LABELS[i]].z}`)
}

const CROPS = {
  '整幅(letterbox)': null,
  '居中 70%': [0.15, 0.15, 0.85, 0.85],
  '居中 50%': [0.25, 0.25, 0.75, 0.75],
  '居中 35%': [0.325, 0.325, 0.675, 0.675],
  '居中 25%': [0.375, 0.375, 0.625, 0.625],
}

for (const f of process.argv.slice(2)) {
  console.log(`\n════ ${path.basename(path.dirname(f))} ════`)
  for (const [name, crop] of Object.entries(CROPS)) {
    console.log(`  ${name.padEnd(16)} ${(await top(f, crop)).join('  ·  ')}`)
  }
}