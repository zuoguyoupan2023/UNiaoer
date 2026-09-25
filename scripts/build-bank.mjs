#!/usr/bin/env node
/**
 * P1 静态题库构建脚本
 * 抓取 iNaturalist（图片 / 声音）与 Xeno-canto（音频）→ 许可过滤 → 生成 manifest
 *
 * 用法：
 *   node scripts/build-bank.mjs [--limit 8] [--policy relaxed] [--media remote|download]
 *                               [--concurrency 3] [--force] [--xc] [--xc-key <KEY>]
 *
 * 环境变量：XC_API_KEY（也可写在 .env 中）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  parseArgs,
  loadEnv,
  fetchJson,
  cachedJson,
  mapPool,
  sleep,
  slug,
  ensureDir,
} from './lib/util.mjs'
import {
  licenseAllowed,
  canTranscode,
  inatLicenseQuery,
  normalizeLicense,
} from './lib/license.mjs'
import { makeR2 } from './lib/r2.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INAT = 'https://api.inaturalist.org/v1'
const CACHE = path.join(ROOT, 'data-cache')
const PUBLIC_DATA = path.join(ROOT, 'public/data')
const PUBLIC_MEDIA = path.join(ROOT, 'public/media')
const TMP = path.join(os.tmpdir(), 'uniaoer-bank')

const args = parseArgs(process.argv.slice(2))
const OPT = {
  limit: args.limit ? Number(args.limit) : Infinity,
  policy: args.policy || 'relaxed',
  media: args.media || 'remote', // remote | download | stage | r2
  concurrency: args.concurrency ? Number(args.concurrency) : 3,
  maxMinutes: args['max-minutes'] ? Number(args['max-minutes']) : Infinity,
  force: !!args.force,
  xcKey: args['xc-key'] || process.env.XC_API_KEY || '',
  publicBase: (args['public-base'] || process.env.R2_PUBLIC_BASE || '').replace(/\/$/, ''),
}

/** R2 S3 客户端（仅 --media r2 用）；--media stage 只需 publicBase */
let R2CLIENT = null
let PUBLIC_BASE = ''

function stub(sp) {
  return {
    id: slug(sp.nameSci),
    nameZh: sp.nameZh,
    nameSci: sp.nameSci,
    family: sp.family,
    commonness: sp.commonness,
    desc: '',
    location: '',
    habit: '',
    image: null,
    audio: null,
  }
}

async function main() {
  await loadEnv(path.join(ROOT, '.env'))
  OPT.xcKey = OPT.xcKey || process.env.XC_API_KEY || ''
  // .env 在模块加载后才读取，这里补读并规范化 R2_PUBLIC_BASE
  OPT.publicBase = OPT.publicBase || (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
  if (OPT.publicBase && !/^https?:\/\//i.test(OPT.publicBase)) {
    OPT.publicBase = 'https://' + OPT.publicBase
  }
  const useXc = !!OPT.xcKey
  const deadline = OPT.maxMinutes === Infinity ? Infinity : Date.now() + OPT.maxMinutes * 60_000

  const R2 = OPT.media === 'r2' ? makeR2() : null
  if (R2 && !R2.ready) {
    console.error(`❌ --media r2 需要环境变量：${R2.missing.join(', ')}`)
    process.exit(1)
  }
  R2CLIENT = R2
  PUBLIC_BASE = OPT.publicBase
  if (OPT.media === 'stage' && !PUBLIC_BASE) {
    console.error('❌ --media stage 需要 R2_PUBLIC_BASE（或 --public-base），用于改写 manifest 里的媒体地址')
    process.exit(1)
  }

  const species = JSON.parse(await fs.readFile(path.join(ROOT, 'data/species.json'), 'utf8'))
  const list = species.slice(0, OPT.limit)

  console.log(`\n🐦 UNiaoer 题库构建`)
  console.log(`   物种: ${list.length}/${species.length}  策略: ${OPT.policy}  媒体: ${OPT.media}`)
  console.log(`   音频源: iNaturalist sounds${useXc ? ' + Xeno-canto' : '（未提供 XC_API_KEY，仅 iNat）'}`)
  console.log(`   时间预算: ${OPT.maxMinutes === Infinity ? '不限' : OPT.maxMinutes + ' 分钟'}`)
  if (R2) console.log(`   R2: ${R2.publicBase}/media/<species>/…`)
  console.log('')

  let done = 0
  let skipped = 0
  const records = await mapPool(list, OPT.concurrency, async (sp) => {
    if (Date.now() > deadline) {
      skipped++
      return stub(sp)
    }
    const rec = await buildSpecies(sp, useXc)
    done++
    const flags = [rec.image ? '图' : '·', rec.audio ? '音' : '·'].join('')
    console.log(`   [${String(done).padStart(3)}/${list.length}] ${flags} ${sp.nameZh} (${sp.nameSci})`)
    await sleep(200)
    return rec
  })

  const withImage = records.filter((r) => r.image).length
  const withAudio = records.filter((r) => r.audio).length
  const manifest = {
    generatedAt: new Date().toISOString(),
    policy: OPT.policy,
    mediaMode: OPT.media,
    total: records.length,
    stats: { withImage, withAudio },
    species: records,
  }

  await ensureDir(PUBLIC_DATA)
  await fs.writeFile(path.join(PUBLIC_DATA, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(`\n✅ 完成：${records.length} 种，图片 ${withImage}，音频 ${withAudio}`)
  if (skipped) console.log(`   ⏱️ 因时间预算跳过 ${skipped} 种（下次构建会补齐）`)
  console.log(`   写入 public/data/manifest.json`)
  const failed = records.filter((r) => !r.image && !r.audio && !skipped).map((r) => r.nameZh)
  if (failed.length) console.log(`   ⚠️ 无任何素材: ${failed.join('、')}`)
}

async function buildSpecies(sp, useXc) {
  const id = slug(sp.nameSci)
  const base = stub(sp)

  try {
    const taxon = await resolveTaxon(sp)
    if (!taxon) return base

    const [photos, sounds] = await Promise.all([
      fetchInat(taxon.id, 'photos'),
      fetchInat(taxon.id, 'sounds'),
    ])

    base.image = pickInatImage(photos, OPT.policy)
    base.audio = pickInatAudio(sounds, OPT.policy)

    if (useXc) {
      const xc = await fetchXc(sp.nameSci)
      const xcAudio = pickXcAudio(xc, OPT.policy)
      if (xcAudio) base.audio = xcAudio // XC 优先（质量更可控）
    }

    // 给媒体补上归属信息（前端错题本等依赖 speciesId）
    for (const kind of ['image', 'audio']) {
      const a = base[kind]
      if (a) {
        a.speciesId = base.id
        a.type = kind
      }
    }

    if (OPT.media === 'download' || OPT.media === 'stage' || OPT.media === 'r2') {
      await materialize(base, id)
    }
  } catch (e) {
    console.warn(`   ⚠️ ${sp.nameZh}: ${e.message}`)
  }
  return base
}

/** 解析 iNat 分类单元 id（先科学名，再中文名） */
async function resolveTaxon(sp) {
  const cacheFile = path.join(CACHE, 'inat/taxon', `${slug(sp.nameSci)}.json`)
  const data = await cachedJson(
    cacheFile,
    async () => {
      const tryQuery = async (q) => {
        const url = `${INAT}/taxa?q=${encodeURIComponent(q)}&rank=species&locale=zh-CN&per_page=5`
        const d = await fetchJson(url)
        return (d.results || []).filter((r) => r.rank === 'species')
      }
      let found = await tryQuery(sp.nameSci)
      let hit = found.find((r) => r.name.toLowerCase() === sp.nameSci.toLowerCase())
      if (!hit && found.length) hit = found[0]
      if (!hit) {
        found = await tryQuery(sp.nameZh)
        hit = found[0]
      }
      return hit ? { id: hit.id, name: hit.name } : null
    },
    { force: OPT.force },
  )
  return data
}

/** 抓取 iNat observations（photos 或 sounds），带缓存 */
async function fetchInat(taxonId, kind) {
  const cacheFile = path.join(CACHE, `inat/${kind}/${OPT.policy}`, `${taxonId}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      const licenseParam = kind === 'photos' ? 'photo_license' : 'sound_license'
      const flag = kind === 'photos' ? 'photos=true' : 'sounds=true'
      const url =
        `${INAT}/observations?taxon_id=${taxonId}&${licenseParam}=${inatLicenseQuery(OPT.policy)}` +
        `&quality_grade=research&${flag}&order_by=votes&per_page=30&locale=zh-CN`
      const d = await fetchJson(url)
      return d.results || []
    },
    { force: OPT.force },
  )
}

/** 抓取 Xeno-canto（带缓存） */
async function fetchXc(sci) {
  const cacheFile = path.join(CACHE, 'xc', `${slug(sci)}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      const query = `sp:"${sci}"`
      const url = `https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(query)}&per_page=100&key=${encodeURIComponent(OPT.xcKey)}`
      return await fetchJson(url)
    },
    { force: OPT.force },
  )
}

function pickInatImage(results, policy) {
  for (const o of results) {
    for (const p of o.photos || []) {
      if (!licenseAllowed(p.license_code, policy)) continue
      const url = (p.url || '').replace('/square.', '/medium.')
      if (!url) continue
      return asset(url, p.license_code, p.attribution, 'iNaturalist', `https://www.inaturalist.org/observations/${o.id}`)
    }
  }
  return null
}

function pickInatAudio(results, policy) {
  for (const o of results) {
    for (const s of o.sounds || []) {
      if (!licenseAllowed(s.license_code, policy)) continue
      if (!s.file_url) continue
      return asset(s.file_url, s.license_code, s.attribution, 'iNaturalist', `https://www.inaturalist.org/observations/${o.id}`)
    }
  }
  return null
}

function pickXcAudio(data, policy) {
  const order = { A: 0, B: 1, C: 2, D: 3, E: 4 }
  // 质量优先；同质量下优先短录音（体积小、加载快）
  const recs = [...(data.recordings || [])].sort(
    (a, b) => (order[a.q] ?? 9) - (order[b.q] ?? 9) || lengthSec(a.length) - lengthSec(b.length),
  )
  for (const r of recs) {
    if (!licenseAllowed(r.lic, policy)) continue
    let file = r.file || ''
    if (file.startsWith('//')) file = 'https:' + file
    if (!file) continue
    const a = asset(file, r.lic, r.rec, 'Xeno-canto', r.url || '')
    a.quality = r.q || ''
    return a
  }
  return null
}

/** "4:08" → 248 秒；未知按很长处理 */
function lengthSec(s) {
  const m = String(s || '').match(/^(\d+):(\d{1,2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 9999
}

function asset(url, rawLicense, author, source, sourceUrl) {
  return {
    url,
    license: normalizeLicense(rawLicense),
    licenseRaw: rawLicense || '',
    author: (author || '').trim() || '未知作者',
    source,
    sourceUrl,
    transcode: canTranscode(rawLicense),
  }
}

/** 下载 →（可选）转码 → 落盘 public/media，或 stage（本地暂存+URL 指向 R2），或上传 R2 */
async function materialize(rec, id) {
  if (rec.image) rec.image = await persistOne(rec.image, id, 'image', 'webp')
  if (rec.audio) rec.audio = await persistOne(rec.audio, id, 'audio', 'mp3')
}

async function persistOne(a, id, kind, ext) {
  const tmpDir = path.join(TMP, id)
  await ensureDir(tmpDir)

  let raw
  try {
    raw = await download(a.url, path.join(tmpDir, `${kind}.src`))
  } catch (e) {
    // 下载失败：保留源站地址，不阻塞整个物种
    console.warn(`      ↳ ${kind} 下载失败，保留源站地址：${e.message}`)
    await fs.rm(tmpDir, { recursive: true, force: true })
    return a
  }

  let file = raw
  // 未转码（ND 或转码失败）时保留原始扩展名，避免出现 image.src 这种怪文件名
  let outExt = extFromUrl(a.url) || (kind === 'image' ? 'jpg' : 'mp3')
  if (a.transcode) {
    const out = path.join(tmpDir, `${kind}.${ext}`)
    try {
      await transcode(kind, raw, out)
      file = out
      outExt = ext
      await fs.rm(raw, { force: true })
    } catch {
      file = raw
    }
  }

  const rel = `media/${id}/${kind}.${outExt}`
  let url
  if (OPT.media === 'r2') {
    const body = await fs.readFile(file)
    await R2CLIENT.put(rel, body, guessContentType(a.url, kind, outExt))
    url = `${R2CLIENT.publicBase}/${rel}`
  } else {
    const dir = path.join(PUBLIC_MEDIA, id)
    await ensureDir(dir)
    await fs.copyFile(file, path.join(dir, `${kind}.${outExt}`))
    // stage：本地暂存，但 manifest 指向 R2（之后用 wrangler 把 public/media 上传到桶）
    url = OPT.media === 'stage' ? `${PUBLIC_BASE}/${rel}` : `/media/${id}/${kind}.${outExt}`
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
  return { ...a, url }
}

/** 从 URL 猜原始扩展名 */
function extFromUrl(url) {
  const m = String(url || '').match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  return m ? m[1].toLowerCase() : ''
}

async function transcode(kind, src, out) {
  if (kind === 'image') {
    await execFileP('ffmpeg', [
      '-y', '-i', src,
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libwebp', '-quality', '80', out,
    ])
  } else {
    await execFileP('ffmpeg', [
      '-y', '-i', src,
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '1', out,
    ])
  }
}

function guessContentType(url, kind, ext) {
  if (ext === 'webp') return 'image/webp'
  if (ext === 'mp3') return 'audio/mpeg'
  const u = (url || '').toLowerCase()
  if (u.includes('.png')) return 'image/png'
  if (u.includes('.webp')) return 'image/webp'
  if (u.includes('.wav')) return 'audio/wav'
  if (u.includes('.ogg')) return 'audio/ogg'
  if (u.includes('.mp3')) return 'audio/mpeg'
  return kind === 'image' ? 'image/jpeg' : 'audio/mpeg'
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'UNiaoer-build/0.1' } })
  if (!res.ok) throw new Error('download HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(dest, buf)
  return dest
}

main().catch((e) => {
  console.error('❌ 构建失败:', e)
  process.exit(1)
})
