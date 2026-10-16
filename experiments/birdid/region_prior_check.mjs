/**
 * 一次性验证：地域先验对「模型排错但真值在当地常见」的场景是否有效。
 * 用产物 + 真实的 CN 档位数据离线复算，与线上 applyRegionPrior 同规则。
 *   node experiments/birdid/region_prior_check.mjs <图片...>
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

/** 与 src/core/birdId/regionPrior.ts 同规则 */
function applyRegionPrior(cands, tiers) {
  const withTier = cands.map((c) => ({ ...c, regionTier: tiers?.[c.speciesId] ?? null }))
  const idx = withTier.map((c, i) => ({ c, i }))
  idx.sort((a, b) => {
    const ta = a.c.regionTier, tb = b.c.regionTier
    if (ta != null && tb != null) return ta - tb || b.c.score - a.c.score || a.i - b.i
    if (ta != null) return -1
    if (tb != null) return 1
    return b.c.score - a.c.score || a.i - b.i
  })
  return idx.map((x) => x.c)
}

function prep(file) {
  const buf = execFileSync('ffmpeg', ['-v','error','-i',file,
    '-vf', `scale=${S}:${S}:force_original_aspect_ratio=decrease,pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 1 << 30 })
  const u8 = new Uint8Array(buf)
  const f32 = new Float32Array(u8.length)
  for (let i = 0; i < u8.length; i++) f32[i] = u8[i] / 255
  return f32
}

const cn = JSON.parse(fs.readFileSync('public/data/province-commonness/CN.country.json', 'utf8')).tiers
const cnB = JSON.parse(fs.readFileSync('public/data/province-commonness/CN.json', 'utf8')).tiersByCode['CN-11']
const REGIONS = { '不限地区': null, '中国(CN)': cn, '中国·北京(CN-11)': cnB }

for (const f of process.argv.slice(2)) {
  const truth = path.basename(path.dirname(f))
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', prep(f), [1, S, S, 3]) })
  const sc = Float32Array.from(out[sess.outputNames[0]].data, (v) => 1 / (1 + Math.exp(-v)))
  const order = [...sc.keys()].sort((a, b) => sc[b] - sc[a])
  const K = Number(process.env.TOPK || 12)
  const cands = order.slice(0, K).filter((i) => LABELS[i] in ENTRIES)
    .map((i) => ({ label: LABELS[i], score: sc[i], speciesId: ENTRIES[LABELS[i]].s, z: ENTRIES[LABELS[i]].z }))

  console.log(`\n════ 真值 ${truth} ════`)
  for (const [name, tiers] of Object.entries(REGIONS)) {
    const ranked = tiers ? applyRegionPrior(cands, tiers) : cands
    const disp = ranked.slice(0, 3).map((c, i) => {
      const mark = c.speciesId === truth ? '★' : ' '
      const t = c.regionTier != null ? `当地${c.regionTier}` : '当地?'
      return `${i + 1}.${mark}${c.z || c.label}(${t})`
    })
    console.log(`  ${name.padEnd(18)} ${disp.join('  ')}`)
  }
}