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
import { rgbaToThumbHash } from 'thumbhash'

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
  taxa: !!args.taxa, // 以 data/taxa.json 为物种清单（M1+）
  noXc: !!args['no-xc'], // 临时禁用 Xeno-canto（XC 限流时用 iNat 音频兜底）
  per: args.per ? Number(args.per) : 1, // 每物种最多图/音数（M1=1）
  out: args.out || '', // manifest 输出路径（默认 public/data/manifest.json；测试用可另指）
}

/** R2 S3 客户端（仅 --media r2 用）；--media stage 只需 publicBase */
let R2CLIENT = null
let PUBLIC_BASE = ''
/** 人工覆盖表（data/media-overrides.json） */
let OVERRIDES = {}
/** 可用的 AV1 静图编码器（检测一次；null = 不产出 AVIF） */
let AVIF_ENCODER = null

/** 可用磁盘字节（statfs；失败返回 Infinity，视为充足） */
async function freeBytes() {
  try {
    const s = await fs.statfs(ROOT)
    return s.bsize * s.bavail
  } catch {
    return Infinity
  }
}

function stub(sp) {
  return {
    id: sp.id || slug(sp.nameSci),
    taxonId: sp.taxonId ?? null,
    nameZh: sp.nameZh,
    nameSci: sp.nameSci,
    nameEn: sp.nameEn || '',
    family: sp.family,
    commonness: sp.commonness,
    rankWorld: sp.rankWorld ?? null,
    rankCN: sp.rankCN ?? null,
    inCN: sp.inCN ?? null,
    desc: '',
    location: '',
    habit: '',
    images: [],
    audios: [],
    // 兼容旧前端/旧 manifest
    image: null,
    audio: null,
  }
}

/** 人工覆盖表 data/media-overrides.json（可选）：{ "<id 或学名>": { images:[], audios:[], excludeUrls:[] } } */
async function loadOverrides() {
  try {
    const d = JSON.parse(await fs.readFile(path.join(ROOT, 'data/media-overrides.json'), 'utf8'))
    return (d && d.overrides) || {}
  } catch {
    return {}
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
  const useXc = !OPT.noXc && !!OPT.xcKey
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
  AVIF_ENCODER = await detectAvifEncoder()

  const source = OPT.taxa ? 'data/taxa.json' : 'data/species.json'
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, source), 'utf8'))
  const species = Array.isArray(raw) ? raw : raw.species || []
  const list = species.slice(0, OPT.limit)
  OVERRIDES = await loadOverrides()

  console.log(`\n🐦 UNiaoer 题库构建`)
  console.log(`   清单: ${source}  物种: ${list.length}/${species.length}  策略: ${OPT.policy}  媒体: ${OPT.media}`)
  console.log(`   每物种: 图≤${OPT.per} 音≤${OPT.per}${OPT.taxa ? '（taxa 模式：default_photo 优先）' : ''}  覆盖表: ${Object.keys(OVERRIDES).length} 条`)
  console.log(`   音频源: iNaturalist sounds${useXc ? ' + Xeno-canto' : '（未提供 XC_API_KEY，仅 iNat）'}`)
  console.log(`   图像: large 母版 → thumb/full/xl${AVIF_ENCODER ? ' + AVIF(' + AVIF_ENCODER + ')' : '（无 AV1 编码器，跳过 AVIF）'}`)
  console.log(`   时间预算: ${OPT.maxMinutes === Infinity ? '不限' : OPT.maxMinutes + ' 分钟'}`)
  if (R2) console.log(`   R2: ${R2.publicBase}/media/<species>/…`)
  console.log('')

  let done = 0
  let skipped = 0
  let lowDisk = false
  const records = await mapPool(list, OPT.concurrency, async (sp) => {
    if (Date.now() > deadline) {
      skipped++
      return stub(sp)
    }
    if (!lowDisk) {
      const free = await freeBytes()
      if (free < 500 * 1024 * 1024) {
        lowDisk = true
        console.warn('   ⚠️ 可用磁盘不足 500MB：停止继续下载（已完成部分已缓存，稍后可续跑）')
      }
    }
    if (lowDisk) {
      skipped++
      return stub(sp)
    }
    const rec = await buildSpecies(sp, useXc)
    done++
    const flags = [rec.image ? '图' : '·', rec.audio ? '音' : '·'].join('')
    console.log(`   [${String(done).padStart(3)}/${list.length}] ${flags} ${sp.nameZh} (${sp.nameSci})`)
    await sleep(OPT.taxa ? 500 + Math.random() * 900 : 200)
    return rec
  })

  const withImage = records.filter((r) => r.image).length
  const withAudio = records.filter((r) => r.audio).length
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    policy: OPT.policy,
    mediaMode: OPT.media,
    source,
    perSpecies: OPT.per,
    total: records.length,
    stats: {
      withImage,
      withAudio,
      imageCount: records.reduce((n, r) => n + (r.images ? r.images.length : 0), 0),
      audioCount: records.reduce((n, r) => n + (r.audios ? r.audios.length : 0), 0),
    },
    species: records,
  }

  const outFile = OPT.out ? path.resolve(ROOT, OPT.out) : path.join(PUBLIC_DATA, 'manifest.json')
  await ensureDir(path.dirname(outFile))
  await fs.writeFile(outFile, JSON.stringify(manifest, null, 2))

  console.log(`\n✅ 完成：${records.length} 种，图片 ${withImage}，音频 ${withAudio}`)
  if (skipped) console.log(`   ⏱️ 因时间预算跳过 ${skipped} 种（下次构建会补齐）`)
  console.log(`   写入 ${path.relative(ROOT, outFile)}`)
  const failed = records.filter((r) => !r.image && !r.audio && !skipped).map((r) => r.nameZh)
  if (failed.length) console.log(`   ⚠️ 无任何素材: ${failed.join('、')}`)
}

async function buildSpecies(sp, useXc) {
  const id = slug(sp.nameSci)
  const base = stub(sp)

  try {
    const taxon = await resolveTaxon(sp)
    if (!taxon) return base

    const [photos, sounds, detail] = await Promise.all([
      fetchInat(taxon.id, 'photos'),
      fetchInat(taxon.id, 'sounds'),
      fetchTaxon(taxon.id),
    ])

    // M1：每物种 ≤per 图/音；图以 iNat taxon.default_photo 为首选（011 §4.1）
    base.images = pickInatImages(photos, OPT.policy, detail && detail.default_photo)
    base.image = base.images[0] || null

    let audios = pickInatAudios(sounds, OPT.policy)
    if (useXc) {
      const xc = await fetchXc(sp.nameSci)
      const xcAudio = pickXcAudio(xc, OPT.policy)
      if (xcAudio) audios = [xcAudio, ...audios] // XC 优先（质量更可控）
    }
    base.audios = audios.slice(0, OPT.per)
    base.audio = base.audios[0] || null

    applyOverrides(base)

    // 给媒体补上归属信息（前端错题本等依赖 speciesId）
    for (const kind of ['images', 'audios']) {
      for (const a of base[kind]) {
        a.speciesId = base.id
        a.type = kind === 'images' ? 'image' : 'audio'
      }
    }
    base.image = base.images[0] || null
    base.audio = base.audios[0] || null

    if (OPT.media === 'download' || OPT.media === 'stage' || OPT.media === 'r2') {
      await materialize(base, id)
    }
  } catch (e) {
    console.warn(`   ⚠️ ${sp.nameZh}: ${e.message}`)
  }
  return base
}

/** 解析 iNat 分类单元 id（taxa 模式直接用给定 id；否则先科学名，再中文名） */
async function resolveTaxon(sp) {
  if (sp.taxonId) return { id: sp.taxonId, name: sp.nameSci }
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
        `&quality_grade=research&${flag}&order_by=votes&per_page=10&locale=zh-CN`
      const d = await fetchJson(url)
      // 只缓存选材所需字段，避免原始观察 JSON 撑爆磁盘（1299 种量级）
      return (d.results || []).map((o) => ({
        id: o.id,
        photos: (o.photos || []).map((p) => ({
          url: p.url,
          license_code: p.license_code,
          attribution: p.attribution,
        })),
        sounds: (o.sounds || []).map((s) => ({
          file_url: s.file_url,
          license_code: s.license_code,
          attribution: s.attribution,
        })),
      }))
    },
    { force: OPT.force },
  )
}

/** 抓取 iNat taxon 详情（default_photo 等，带缓存） */
async function fetchTaxon(taxonId) {
  const cacheFile = path.join(CACHE, 'inat/taxon-detail', `${taxonId}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      const d = await fetchJson(`${INAT}/taxa/${taxonId}?locale=en`)
      return (d.results && d.results[0]) || null
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

/** 由 iNat photo 对象构造 asset（large 母版，medium 回退） */
function inatPhotoAsset(p, sourceUrl) {
  const url = p.url || ''
  if (!url) return null
  const a = asset(
    url.replace('/square.', '/large.'),
    p.license_code,
    p.attribution,
    'iNaturalist',
    sourceUrl,
  )
  const medium = url.replace('/square.', '/medium.')
  if (medium !== a.url) a.altUrl = medium
  return a
}

/** M1 取图：taxon.default_photo 优先，再按观察票数（每条观察最多 1 张），去重，≤per */
function pickInatImages(results, policy, defaultPhoto) {
  const out = []
  const seen = new Set()
  const push = (a) => {
    if (!a || seen.has(a.url)) return
    seen.add(a.url)
    out.push(a)
  }
  if (defaultPhoto && licenseAllowed(defaultPhoto.license_code, policy)) {
    push(
      inatPhotoAsset(
        defaultPhoto,
        defaultPhoto.id ? `https://www.inaturalist.org/photos/${defaultPhoto.id}` : '',
      ),
    )
  }
  for (const o of results) {
    if (out.length >= OPT.per) break
    for (const p of o.photos || []) {
      if (!licenseAllowed(p.license_code, policy)) continue
      push(inatPhotoAsset(p, `https://www.inaturalist.org/observations/${o.id}`))
      break // 每条观察最多取 1 张
    }
  }
  return out.slice(0, OPT.per)
}

/** M1 取音：iNat sounds（去重，≤per） */
function pickInatAudios(results, policy) {
  const out = []
  const seen = new Set()
  for (const o of results) {
    if (out.length >= OPT.per) break
    for (const s of o.sounds || []) {
      if (!licenseAllowed(s.license_code, policy)) continue
      if (!s.file_url || seen.has(s.file_url)) continue
      seen.add(s.file_url)
      out.push(
        asset(s.file_url, s.license_code, s.attribution, 'iNaturalist', `https://www.inaturalist.org/observations/${o.id}`),
      )
      break
    }
  }
  return out
}

/** 应用人工覆盖表（011 §4.1/§4.4）：支持 images/audios 追加与 excludeUrls 排除 */
function applyOverrides(base) {
  const ov = OVERRIDES[base.id] || OVERRIDES[base.nameSci]
  if (!ov) return
  const excl = new Set(ov.excludeUrls || [])
  const filter = (list) =>
    list.filter((a) => !excl.has(a.url) && !excl.has(a.sourceUrl))
  const toAssets = (list, kind) =>
    (list || [])
      .filter((o) => o && o.url && licenseAllowed(o.license, OPT.policy))
      .map((o) =>
        asset(o.url, o.license, o.author, o.source || 'override', o.sourceUrl || ''),
      )
      .map((a) => ({ ...a, overridden: true, type: kind, speciesId: base.id }))

  base.images = [...toAssets(ov.images, 'image'), ...filter(base.images)].slice(0, OPT.per)
  base.audios = [...toAssets(ov.audios, 'audio'), ...filter(base.audios)].slice(0, OPT.per)
}

function pickXcAudio(data, policy) {
  const order = { A: 0, B: 1, C: 2, D: 3, E: 4 }
  // 质量优先；同质量下优先短录音（体积小、加载快）
  const recs = [...(data.recordings || [])].sort(
    (a, b) => (order[a.q] ?? 9) - (order[b.q] ?? 9) || lengthSec(a.length) - lengthSec(b.length),
  )
  for (const r of recs) {
    if (!licenseAllowed(r.lic, policy)) continue
    if (lengthSec(r.length) <= 0) continue // 跳过 0:00 之类的坏录音（下载会 404）
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
  if (rec.image) rec.image = await persistImage(rec.image, id)
  if (rec.audio) rec.audio = await persistOne(rec.audio, id, 'audio', 'mp3')
  if (rec.images && rec.images.length) rec.images[0] = rec.image || rec.images[0]
  if (rec.audios && rec.audios.length) rec.audios[0] = rec.audio || rec.audios[0]
}

/**
 * 图片（可转码）：生成派生图组 thumb/full/xl(+avif) + ThumbHash（C2，详 006 §8）。
 * - ND 等不可转码的走 persistOne 原样保存（ThumbHash 亦属派生作品，ND 一律不做）
 * - stage 模式下本地派生齐全则跳过下载，ThumbHash 从现有 thumb 重算（增量补抓）
 */
async function persistImage(a, id) {
  if (!a.transcode) return persistOne(a, id, 'image', 'webp')

  const outDir = path.join(PUBLIC_MEDIA, id)
  await ensureDir(outDir)
  const files = {
    thumb: path.join(outDir, 'image.thumb.webp'),
    full: path.join(outDir, 'image.full.webp'),
    xl: path.join(outDir, 'image.xl.webp'),
    avif: path.join(outDir, 'image.full.avif'),
  }
  const exists = (f) => fs.access(f).then(() => true, () => false)

  if (OPT.media === 'stage' && (await exists(files.thumb)) && (await exists(files.full)) && (await exists(files.xl))) {
    const thumbhash = await thumbHashFromFile(files.thumb).catch(() => '')
    const out = await finalizeImage(a, id, { thumbhash, avif: await exists(files.avif) })
    console.log('      ↳ image 派生图已存在，跳过下载')
    return out
  }

  const tmpDir = path.join(TMP, id)
  await ensureDir(tmpDir)

  let raw
  let masterUrl = a.url
  try {
    raw = await download(a.url, path.join(tmpDir, 'image.src'))
  } catch (e1) {
    if (a.altUrl) {
      try {
        raw = await download(a.altUrl, path.join(tmpDir, 'image.src'))
        masterUrl = a.altUrl // large 缺失时以 medium 为母版，manifest 指向它保持一致
      } catch (e2) {
        console.warn(`      ↳ image 下载失败，保留源站地址：${e2.message}`)
        await fs.rm(tmpDir, { recursive: true, force: true })
        return a
      }
    } else {
      console.warn(`      ↳ image 下载失败，保留源站地址：${e1.message}`)
      await fs.rm(tmpDir, { recursive: true, force: true })
      return a
    }
  }

  try {
    await runFfmpeg(['-y', '-i', raw, '-vf', "scale='min(320,iw)':-2", '-c:v', 'libwebp', '-quality', '72', files.thumb])
    await runFfmpeg(['-y', '-i', raw, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libwebp', '-quality', '82', files.full])
    await runFfmpeg(['-y', '-i', raw, '-c:v', 'libwebp', '-quality', '90', files.xl])
    let avif = false
    if (AVIF_ENCODER) {
      try {
        const encArgs = ['-y', '-i', raw, '-vf', "scale='min(1280,iw)':-2", '-c:v', AVIF_ENCODER, '-crf', '45', '-still-picture', '1', '-pix_fmt', 'yuv420p']
        if (AVIF_ENCODER === 'libaom-av1') encArgs.push('-cpu-used', '6')
        await runFfmpeg([...encArgs, files.avif])
        avif = true
      } catch {
        avif = false
        await fs.rm(files.avif, { force: true })
      }
    }
    const thumbhash = await thumbHashFromFile(files.thumb)
    await fs.rm(raw, { force: true })
    await fs.rm(tmpDir, { recursive: true, force: true })
    return finalizeImage({ ...a, url: masterUrl }, id, { thumbhash, avif })
  } catch (e) {
    // 转码失败：退回单文件（保留原始扩展名），与旧行为一致；raw 复用，不再重新下载
    console.warn(`      ↳ image 转码失败，保留原文件：${e.message}`)
    for (const f of [files.thumb, files.full, files.xl, files.avif]) await fs.rm(f, { force: true })
    return persistLocalFile({ ...a, url: masterUrl }, id, 'image', raw, masterUrl, 'webp')
  }
}

/** 派生图齐全后的 URL 组装；r2 模式再把 public/media 里的派生图逐个直传 */
async function finalizeImage(a, id, { thumbhash, avif }) {
  const rels = {
    url: `media/${id}/image.full.webp`,
    thumbUrl: `media/${id}/image.thumb.webp`,
    xlUrl: `media/${id}/image.xl.webp`,
    ...(avif ? { avifUrl: `media/${id}/image.full.avif` } : {}),
  }
  const out = { ...a }
  delete out.altUrl
  if (OPT.media === 'r2') {
    for (const rel of Object.values(rels)) {
      const body = await fs.readFile(path.join(PUBLIC_MEDIA, rel))
      await R2CLIENT.put(rel, body, 'image/webp')
    }
  }
  for (const [field, rel] of Object.entries(rels)) {
    if (OPT.media === 'stage') out[field] = `${PUBLIC_BASE}/${rel}`
    else out[field] = `/${rel}`
  }
  if (thumbhash) out.thumbhash = thumbhash
  return out
}

/** 从一张 webp 读出 RGBA（缩到 ≤100px，thumbhash 包的输入上限）并编码 ThumbHash（base64） */
async function thumbHashFromFile(webp) {
  // 临时文件必须以 .webp 结尾，否则 ffmpeg 无法从扩展名推断封装格式
  const mini = webp.replace(/([^/]+)\.webp$/, 'mini.$1.webp')
  const scale = "scale='min(100,iw)':'min(100,ih)':force_original_aspect_ratio=decrease"
  try {
    await runFfmpeg(['-y', '-i', webp, '-vf', scale, '-c:v', 'libwebp', '-quality', '80', mini])
    const { stdout: wh } = await execFileP('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mini,
    ])
    const [w, h] = wh.trim().split(',').map(Number)
    if (!w || !h) throw new Error('ffprobe 尺寸解析失败')
    const { stdout } = await execFileP(
      'ffmpeg',
      ['-v', 'error', '-i', mini, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
    )
    const hash = rgbaToThumbHash(w, h, new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength))
    return Buffer.from(hash).toString('base64')
  } finally {
    await fs.rm(mini, { force: true })
  }
}

/** 检测可用的 AV1 静图编码器（libaom 体积更小优先；都没有则返回 null 跳过 AVIF） */
async function detectAvifEncoder() {
  try {
    const { stdout } = await execFileP('ffmpeg', ['-hide_banner', '-encoders'])
    if (/libaom-av1/.test(stdout)) return 'libaom-av1'
    if (/libsvtav1/.test(stdout)) return 'libsvtav1'
  } catch {
    /* 无 ffmpeg */
  }
  return null
}

function runFfmpeg(args) {
  return execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args])
}

async function persistOne(a, id, kind, ext) {
  const tmpDir = path.join(TMP, id)
  await ensureDir(tmpDir)

  // 未转码（ND 或转码失败）时保留原始扩展名，避免出现 image.src 这种怪文件名
  const outExt = a.transcode ? ext : extFromUrl(a.url) || (kind === 'image' ? 'jpg' : 'mp3')
  const localPath = path.join(PUBLIC_MEDIA, id, `${kind}.${outExt}`)

  // stage 增量：目标文件已在本地则跳过下载（补抓只拉缺失的）
  if (
    OPT.media === 'stage' &&
    (outExt === ext || !a.transcode) &&
    (await fs.access(localPath).then(() => true, () => false))
  ) {
    console.log(`      ↳ ${kind} 已存在，跳过下载`)
    return { ...a, url: `${PUBLIC_BASE}/media/${id}/${kind}.${outExt}` }
  }

  let raw
  try {
    raw = await download(a.url, path.join(tmpDir, `${kind}.src`))
  } catch (e) {
    // 下载失败：保留源站地址，不阻塞整个物种
    console.warn(`      ↳ ${kind} 下载失败，保留源站地址：${e.message}`)
    await fs.rm(tmpDir, { recursive: true, force: true })
    return a
  }
  return persistLocalFile(a, id, kind, raw, a.url, ext)
}

/** 把已下载的本地文件转码/落盘/上传（persistOne 与图片转码回退共用） */
async function persistLocalFile(a, id, kind, raw, srcUrl, ext) {
  const tmpDir = path.join(TMP, id)
  await ensureDir(tmpDir)

  let outExt = extFromUrl(srcUrl) || (kind === 'image' ? 'jpg' : 'mp3')
  let file = raw
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
    await R2CLIENT.put(rel, body, guessContentType(srcUrl, kind, outExt))
    url = `${R2CLIENT.publicBase}/${rel}`
  } else {
    const dir = path.join(PUBLIC_MEDIA, id)
    await ensureDir(dir)
    await fs.copyFile(file, path.join(dir, `${kind}.${outExt}`))
    // stage：本地暂存，但 manifest 指向 R2（之后用 wrangler 把 public/media 上传到桶）
    url = OPT.media === 'stage' ? `${PUBLIC_BASE}/${rel}` : `/media/${id}/${kind}.${outExt}`
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
  const out = { ...a, url }
  delete out.altUrl
  return out
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

async function download(url, dest, tries = 5) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 60000)
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'UNiaoer-build/0.1' } })
      clearTimeout(timer)
      if (!res.ok) {
        const err = new Error('download HTTP ' + res.status)
        // 4xx（除 429）不重试；网络错误/429/5xx 可重试
        err.retryable = res.status === 429 || res.status >= 500
        throw err
      }
      const buf = Buffer.from(await res.arrayBuffer())
      await fs.writeFile(dest, buf)
      return dest
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (e.retryable === false || i >= tries - 1) break
      await sleep(1000 * (i + 1) + Math.random() * 800)
    }
  }
  throw lastErr
}

main().catch((e) => {
  console.error('❌ 构建失败:', e)
  process.exit(1)
})
