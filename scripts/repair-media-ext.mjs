#!/usr/bin/env node
/**
 * 修复「扩展名与真实格式不符」的媒体文件
 *
 *   node scripts/repair-media-ext.mjs            # 先看会改什么(演练)
 *   node scripts/repair-media-ext.mjs --apply    # 真改
 *
 * 背景：ND 等「不转码」素材必须原样保留字节，但 XC 的 /download 地址不带扩展名
 * (https://xeno-canto.org/1160726/download)，管道曾默认猜 .mp3，而 XC 实际经常
 * 返回 WAV。结果是 WAV 字节存成 .mp3，R2 按扩展名发 Content-Type: audio/mpeg，
 * WebKit 会拒播(docs/033 同类故障)，且未压缩 PCM 体积是转码 mp3 的 5~8 倍。
 *
 * 这里**只改扩展名与台账里的 URL 指向，一个字节都不动** —— 重编码会违反 ND 许可。
 * 管道侧的根因已在 scripts/build-bank.mjs 修掉(sniffExtBuf / sniffExtFile /
 * guessContentType 按真实格式定扩展名与 Content-Type)，本脚本只收拾存量。
 *
 * 退出码：0 无需修 / 1 有已上传的错名文件(需人工删 R2 对象) / 2 --apply 成功
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const MEDIA_DIR = path.join(ROOT, 'public/media')
const LEDGER = path.join(ROOT, 'data-cache/manifest-global.json')
const UPLOADED = path.join(ROOT, 'data-cache/r2-uploaded.json')
const APPLY = process.argv.includes('--apply')

function sniffExtBuf(b) {
  if (b.length < 4) return ''
  const a = (s, e) => b.subarray(s, e).toString('latin1')
  if (a(0, 4) === 'RIFF') return a(8, 12) === 'WAVE' ? 'wav' : ''
  if (a(0, 3) === 'ID3') return 'mp3'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'
  if (a(0, 3) === 'OggS') return 'ogg'
  if (a(4, 8) === 'ftyp') return /^M4A|^mp4|^isom|^M4B/.test(a(8, 12)) ? 'm4a' : ''
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && a(1, 4) === 'PNG') return 'png'
  if (a(0, 4) === 'RIFF') return a(8, 12) === 'WEBP' ? 'webp' : a(8, 12) === 'WAVE' ? 'wav' : ''
  if (a(4, 8) === 'ftyp' && /ftypavif|ftypavis/.test(a(8, 16))) return 'avif'
  return ''
}

async function walk(dir, base = '') {
  const out = []
  let ents
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    if (e.name === '.DS_Store') continue
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)))
    else out.push(rel)
  }
  return out
}

if (!fs.existsSync(MEDIA_DIR)) {
  console.log('✓ public/media 不存在,无需修复')
  process.exit(0)
}

const files = await walk(MEDIA_DIR)
const fixes = []
for (const rel of files) {
  const abs = path.join(MEDIA_DIR, rel)
  const curExt = path.extname(rel).slice(1).toLowerCase()
  if (!curExt) continue
  const fd = await fsp.open(abs, 'r')
  const buf = Buffer.alloc(16)
  const { bytesRead } = await fd.read(buf, 0, 16, 0)
  await fd.close()
  const real = sniffExtBuf(buf.subarray(0, bytesRead))
  if (!real || real === curExt) continue // 认不出，或本来就对
  // webp/avif/jpg 同属图片族，互认不算错配
  const fam = (e) => (['webp', 'avif', 'jpg', 'jpeg', 'png'].includes(e) ? 'img' : 'aud')
  if (fam(real) === fam(curExt) && real !== 'wav' && curExt !== 'wav') continue
  fixes.push({ rel, from: curExt, to: real, size: (await fsp.stat(abs)).size })
}

const uploaded = new Set(fs.existsSync(UPLOADED) ? JSON.parse(fs.readFileSync(UPLOADED, 'utf8')) : [])
const uploadedBad = fixes.filter((f) => uploaded.has(`media/${f.rel}`))

if (fixes.length) {
  console.log(`\n发现 ${fixes.length} 个错名文件(合计 ${(fixes.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(0)}MB)`)
  for (const f of fixes.slice(0, 8)) {
    console.log(`  ${f.rel}  .${f.from} → .${f.to}  ${(f.size / 1048576).toFixed(1)}MB`)
  }
  if (fixes.length > 8) console.log(`  … 另有 ${fixes.length - 8} 个`)
} else {
  console.log('\n本地无扩展名错配文件(改名阶段无需处理,仍会对账台账)')
}

if (uploadedBad.length) {
  console.log(`\n⛔ 其中 ${uploadedBad.length} 个已传上 R2。R2 对象的 Content-Type 是上传时写死的，`)
  console.log(`   改本地文件名修不了线上。需人工删除这些 R2 对象后重传：`)
  for (const f of uploadedBad.slice(0, 10)) {
    console.log(`     npx wrangler r2 object delete uniaoerbucket/media/${f.rel} --remote`)
  }
  if (uploadedBad.length > 10) console.log(`     … 另有 ${uploadedBad.length - 10} 个`)
  process.exit(1)
}

console.log(`\n${APPLY ? '应用修复…' : '(演练模式，加 --apply 才会真正改名)'}`)
if (!APPLY) process.exit(0)

// ---- 1. 台账里所有指向旧路径的字段改成新路径 ----
const ledger = JSON.parse(await fsp.readFile(LEDGER, 'utf8'))
const remap = new Map(fixes.map((f) => [`media/${f.rel}`, `media/${f.rel.replace(/\.[^.]+$/, `.${f.to}`)}`]))
let touched = 0
for (const sp of ledger.species) {
  for (const kind of ['images', 'audios']) {
    for (const a of sp[kind] || []) {
      for (const f of ['url', 'thumbUrl', 'xlUrl', 'avifUrl']) {
        if (!a[f]) continue
        const m = String(a[f]).match(/\/media\/.+$/)
        if (!m) continue
        // 台账里是 `/media/...`(带前导斜杠),remap 键是 `media/...`,两边要归一化
        const key = m[0].replace(/^\//, '')
        if (remap.has(key)) {
          a[f] = String(a[f]).replace(m[0], `/${remap.get(key)}`)
          touched++
        }
      }
    }
  }
}

// ---- 2. 改名 ----
let renamed = 0
for (const f of fixes) {
  const from = path.join(MEDIA_DIR, f.rel)
  const to = path.join(MEDIA_DIR, f.rel.replace(/\.[^.]+$/, `.${f.to}`))
  try {
    await fsp.access(to)
    console.log(`  ⚠️ 目标已存在，跳过 ${path.basename(to)}`)
    continue
  } catch {}
  await fsp.rename(from, to)
  renamed++
}

// ---- 2.5 台账↔磁盘对账(与改名分开,修「台账指 .mp3 而磁盘只有 .wav」的存量) ----
const AUDIO_EXT = ['.wav', '.mp3', '.m4a', '.ogg']
let reconciled = 0
for (const sp of ledger.species) {
  for (const kind of ['images', 'audios']) {
    for (const a of sp[kind] || []) {
      for (const f of ['url', 'thumbUrl', 'xlUrl', 'avifUrl']) {
        if (!a[f] || !String(a[f]).includes('/media/')) continue
        const rel = String(a[f]).split('/media/').pop()
        if (fs.existsSync(path.join(MEDIA_DIR, rel))) continue
        const base = rel.replace(/\.[^.]+$/, '')
        for (const ext of AUDIO_EXT) {
          if (ext === path.extname(rel)) continue
          if (fs.existsSync(path.join(MEDIA_DIR, base + ext))) {
            a[f] = String(a[f]).replace(rel, base + ext)
            touched++
            reconciled++
            break
          }
        }
      }
    }
  }
}

// ---- 3. 原子落盘 ----
const tmp = LEDGER + '.tmp'
await fsp.writeFile(tmp, JSON.stringify(ledger))
await fsp.rename(tmp, LEDGER)

console.log(`\n✅ 完成：改名 ${renamed} 个文件,台账改写 ${touched} 个 URL 字段(其中 ${reconciled} 个来自磁盘对账)`)
console.log(`   字节内容零改动（ND 许可要求不得重编码）。`)
if (fixes.length) console.log(`   这些文件尚未推送,会以正确的 .${fixes[0].to} 扩展名与 Content-Type 上传。`)
else console.log(`   台账指向已与磁盘一致。\n`)
process.exit(2) // 2 = 有改动，供调用方区分「无需修」与「已修」