#!/usr/bin/env node
/**
 * 线上媒体全量抽检:扩展名 / Content-Type / 真实字节 三者是否一致
 *
 *   node scripts/check-r2-media-magic.mjs                # 全量(音频+图片)
 *   node scripts/check-r2-media-magic.mjs --audio        # 只查音频(WAV bug 所在)
 *   node scripts/check-r2-media-magic.mjs --limit 500    # 抽样冒烟
 *   node scripts/check-r2-media-magic.mjs --concurrency 40
 *
 * 为什么必须查线上:本地暂存区只能看到「还没推送」的文件,而 Content-Type 是
 * R2 在**上传那一刻**写死的,事后改本地文件名修不了线上。历史上曾出现
 * WAV 字节被存成 .mp3、R2 按扩展名发 Content-Type: audio/mpeg 的问题
 * (docs/033 同类故障,WebKit 拒播),本脚本就是把这类问题在生产上兜住的那道网。
 *
 * 范围取 public/data/assets/*.json —— 即前端真正会请求的那份产物,
 * 而不是 R2 里所有对象(后者含未上线的新素材,不影响用户)。
 *
 * 退出码：0 全绿 / 1 发现错配 / 2 网络错误过多
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const ASSETS = path.join(ROOT, 'public/data/assets')
const REPORT = path.join(ROOT, 'data-cache/r2-media-magic-report.json')

const args = process.argv.slice(2)
const onlyAudio = args.includes('--audio')
const skipAudio = args.includes('--image')
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) || 500 : 0
const CONC = args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) || 24 : 24

function sniffExtBuf(b) {
  if (b.length < 4) return ''
  const a = (s, e) => b.subarray(s, Math.min(e, b.length)).toString('latin1')
  if (a(0, 4) === 'RIFF') {
    const f = a(8, 12)
    return f === 'WAVE' ? 'wav' : f === 'WEBP' ? 'webp' : ''
  }
  if (a(0, 3) === 'ID3') return 'mp3'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'
  if (a(0, 3) === 'OggS') return 'ogg'
  if (a(4, 8) === 'ftyp') {
    const brand = a(8, 12)
    if (/avif|avis/.test(a(8, 16))) return 'avif'
    if (/^M4A|^mp4|^isom|^M4B/.test(brand)) return 'm4a'
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && a(1, 4) === 'PNG') return 'png'
  return ''
}

/** 扩展名 → 期望的 Content-Type */
const EXPECT_CT = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4', // R2 实际给 audio/x-m4a —— 两者都是 m4a 的合法 MIME,浏览器都认,故下面单独容忍
  ogg: 'audio/ogg',
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
}

// ---- 收集待检 URL ----
if (!fs.existsSync(ASSETS)) {
  console.error(`✗ 找不到 ${ASSETS}`)
  process.exit(2)
}
const seen = new Set()
const targets = []
for (const f of fs.readdirSync(ASSETS).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(await fsp.readFile(path.join(ASSETS, f), 'utf8'))
  for (const sid in d.species) {
    const sp = d.species[sid]
    for (const kind of ['images', 'audios']) {
      if (kind === 'images' && onlyAudio) continue
      if (kind === 'audios' && skipAudio) continue
      for (const a of sp[kind] || []) {
        const u = a.url
        if (!u || !u.startsWith('http')) continue
        if (seen.has(u)) continue
        seen.add(u)
        targets.push({ url: u, sid, kind, ext: (u.split('.').pop() || '').toLowerCase() })
      }
    }
  }
}
const list = LIMIT ? targets.slice(0, LIMIT) : targets

console.log(`\n${'─'.repeat(64)}`)
console.log(`  线上媒体全量抽检 · ${list.length} 个去重 URL${LIMIT ? `(抽样 ${LIMIT})` : '(全量)'}`)
console.log(`${'─'.repeat(64)}\n`)

// ---- 并发探测 ----
const mismatches = []
const netErrors = []
let done = 0
let idx = 0
const t0 = Date.now()

async function probe(t) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(t.url, { headers: { Range: 'bytes=0-31' } })
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
      const real = sniffExtBuf(buf)
      const expectCt = EXPECT_CT[t.ext]

      const problems = []
      // 1) 字节与扩展名不符(最严重:格式认错)
      if (real && real !== t.ext && real !== 'jpeg' && t.ext !== 'jpeg') {
        problems.push(`实际字节是 .${real} 但扩展名是 .${t.ext}`)
      }
      // 2) Content-Type 与扩展名不符(WebKit 拒播的直接原因)
      // 同格式的多种合法 MIME 记法不算错配(m4a: audio/mp4 与 audio/x-m4a 都行)
      const CT_ALIAS = { 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'audio/x-wav': 'audio/wav' }
      const normCt = CT_ALIAS[ct] || ct
      if (expectCt && ct && normCt !== expectCt) {
        problems.push(`Content-Type 是 ${ct} 但扩展名是 .${t.ext}(应为 ${expectCt})`)
      }
      if (problems.length) {
        mismatches.push({ url: t.url, sid: t.sid, kind: t.kind, ext: t.ext, real, ct, problems })
      }
      return
    } catch (e) {
      if (attempt === 2) netErrors.push({ url: t.url, err: String(e.message || e) })
      else await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
}

async function worker() {
  while (idx < list.length) {
    const i = idx++
    await probe(list[i])
    done++
    if (done % 500 === 0 || done === list.length) {
      const el = (Date.now() - t0) / 1000
      const eta = el / done * (list.length - done)
      process.stdout.write(
        `\r  进度 ${done}/${list.length} (${((done / list.length) * 100).toFixed(1)}%)` +
          `  ${(done / el).toFixed(0)}/s  剩余 ~${Math.round(eta)}s   `,
      )
    }
  }
}

await Promise.all(Array.from({ length: CONC }, worker))
process.stdout.write('\n\n')

// ---- 报告 ----
const byExt = new Map()
for (const m of mismatches) {
  const k = `${m.ext} → ${m.real || '?'} (${m.ct})`
  byExt.set(k, (byExt.get(k) || 0) + 1)
}

await fsp.writeFile(
  REPORT,
  JSON.stringify({ generatedAt: new Date().toISOString(), checked: list.length, mismatches, netErrors }, null, 2),
)

console.log(`【探测结果】`)
console.log(`  已检 ${list.length} 个 URL,耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
console.log(`  网络错误 ${netErrors.length} 个${netErrors.length ? `(前3: ${netErrors.slice(0, 3).map((e) => e.err).join(' / ')})` : ''}`)
console.log(`  错配     ${mismatches.length} 个`)

if (!mismatches.length) {
  console.log(`\n✅ 全绿 —— 线上媒体的扩展名 / Content-Type / 实际字节三者一致\n`)
  process.exit(netErrors.length > list.length * 0.05 ? 2 : 0)
}

console.log(`\n错配类型分布:`)
for (const [k, v] of [...byExt.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(5)}  ${k}`)
console.log(`\n前 20 条明细:`)
for (const m of mismatches.slice(0, 20)) {
  console.log(`  ${m.kind.slice(0, 1)} ${m.sid}  ${m.url.split('/media/').pop()}`)
  for (const p of m.problems) console.log(`      · ${p}`)
}
console.log(`\n完整清单: ${path.relative(ROOT, REPORT)}`)
console.log(`\n⛔ 这些对象线上就是坏的。修法见文末提示。\n`)
process.exit(1)