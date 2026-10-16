/**
 * 反推浏览器到底喂了什么：穷举常见「输入张量搞错」的方式，
 * 找出哪一种能复现浏览器里的输出（Pileated Woodpecker 排第一）。
 *   node experiments/birdid/what_browser_fed.mjs <图片>
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const ort = await import('../../node_modules/onnxruntime-web/dist/ort.bundle.min.mjs')
ort.env.wasm.numThreads = 1

const LABELS = fs.readFileSync('public/models/speciesnet-labels.txt', 'utf8').split('\n').filter(Boolean)
const S = 480
const sess = await ort.InferenceSession.create(fs.readFileSync('public/models/speciesnet-whole.onnx'), {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})

const f = process.argv[2]
const buf = execFileSync('ffmpeg', ['-v','error','-i',f,
  '-vf', `scale=${S}:${S}:force_original_aspect_ratio=decrease,pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:color=black`,
  '-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 1 << 30 })
const rgb = new Uint8Array(buf)

/** 把 480×480 RGB 变成各种「可能搞错」的 NHWC 张量 */
function variants() {
  const N = S * S * 3
  const out = {}
  const norm = () => { const a = new Float32Array(N); for (let i=0;i<N;i++) a[i]=rgb[i]/255; return a }
  out['基准 RGB/255'] = norm()

  const bgr = norm(); for (let p=0;p<N;p+=3){const t=bgr[p];bgr[p]=bgr[p+2];bgr[p+2]=t}
  out['BGR 通道顺序'] = bgr

  out['全 0（空图）'] = new Float32Array(N)
  out['全 1（白图）'] = new Float32Array(N).fill(1)

  const gray = new Float32Array(N)
  for (let p=0;p<N;p+=3){const g=(rgb[p]*0.299+rgb[p+1]*0.587+rgb[p+2]*0.114)/255; gray[p]=gray[p+1]=gray[p+2]=g}
  out['灰度三通道'] = gray

  out['-1..1'] = new Float32Array(N).map((_,i)=>rgb[i]/127.5-1)

  // NHWC 写成了 NCHW 的排布（像素顺序完全错乱）
  const nchw = new Float32Array(N)
  for (let y=0;y<S;y++) for (let x=0;x<S;x++) for (let c=0;c<3;c++) {
    nchw[c*S*S + y*S + x] = rgb[(y*S+x)*3+c]/255
  }
  out['写成 NCHW 排布'] = nchw

  // 上下/左右翻转
  const flip = norm()
  for (let y=0;y<S;y++) for (let x=0;x<S;x++) for (let c=0;c<3;c++) {
    flip[(y*S+x)*3+c] = rgb[((S-1-y)*S+x)*3+c]/255
  }
  out['上下翻转'] = flip
  return out
}

async function top(t, n = 5) {
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', t, [1, S, S, 3]) })
  const raw = out[sess.outputNames[0]].data
  let mn=Infinity,mx=-Infinity; for (const v of raw){if(v<mn)mn=v;if(v>mx)mx=v}
  const sc = (mn<-0.01||mx>1.01) ? Float32Array.from(raw,v=>1/(1+Math.exp(-v)))
                                : (()=>{let s=0;for(const v of raw)s+=Math.max(0,v);return Float32Array.from(raw,v=>Math.max(0,v)/s)})()
  const idx=[...sc.keys()].sort((a,b)=>sc[b]-sc[a]).slice(0,n)
  return idx.map(i=>`${(sc[i]*100).toFixed(1)}% ${LABELS[i].split(';').pop()}`).join(' · ')
}

console.log(`图片 ${f}  尺寸 ${rgb.length/3} 字节\n`)
for (const [name, t] of Object.entries(variants())) {
  console.log(`  ${name.padEnd(16)}`, await top(t))
}