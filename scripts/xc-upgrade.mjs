#!/usr/bin/env node
/**
 * XC 增量升级：把 manifest 里的音频逐个替换为 Xeno-canto（XC 优先、iNat 兜底）。
 *
 * 设计：不重抓图/不重建整库，只在现有 manifest + public/media 上做增量替换；
 *       断点续跑（data-cache/xc-upgraded.json 记录进度）；XC 限流严重，默认并发 1。
 *
 * 用法：
 *   node scripts/xc-upgrade.mjs [--manifest public/data/manifest.json]
 *                               [--concurrency 1] [--limit N] [--max-minutes N]
 *                               [--retry-none] [--dry-run] [--force]
 *
 * 跑完后：npm run r2:push（重传被替换的音频）→ 部署。manifest 已是目标文件。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { parseArgs, loadEnv, fetchJson, cachedJson, mapPool, sleep } from './lib/util.mjs'
import { licenseAllowed, canTranscode, normalizeLicense } from './lib/license.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUB_MEDIA = path.join(ROOT, 'public/media')
const CACHE = path.join(ROOT, 'data-cache')
const TMP = path.join(os.tmpdir(), 'uniaoer-xc')

const args = parseArgs(process.argv.slice(2))
const OPT = {
  manifest: args.manifest || 'public/data/manifest.json',
  policy: args.policy || 'relaxed',
  concurrency: args.concurrency ? Number(args.concurrency) : 1,
  limit: args.limit ? Number(args.limit) : Infinity,
  maxMinutes: args['max-minutes'] ? Number(args['max-minutes']) : Infinity,
  retryNone: !!args['retry-none'],
  dryRun: !!args['dry-run'],
  force: !!args.force,
}

const sleepR = (a, b) => sleep(a + Math.random() * (b - a))
let XC_KEY = ''
let PUBLIC_BASE = ''

async function main() {
  await loadEnv(path.join(ROOT, '.env'))
  XC_KEY = process.env.XC_API_KEY || ''
  PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
  if (PUBLIC_BASE && !/^https?:\/\//i.test(PUBLIC_BASE)) PUBLIC_BASE = 'https://' + PUBLIC_BASE
  if (!XC_KEY) {
    console.error('❌ 缺少 XC_API_KEY（写到 .env）')
    process.exit(1)
  }
  if (!PUBLIC_BASE) {
    console.error('❌ 缺少 R2_PUBLIC_BASE（manifest 音频地址需要）')
    process.exit(1)
  }

  const manifestPath = path.resolve(ROOT, OPT.manifest)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const species = manifest.species || []
  const state = await loadState()
  const deadline = OPT.maxMinutes === Infinity ? Infinity : Date.now() + OPT.maxMinutes * 60_000

  // 只处理：尚未是 XC、且未标记过（none 需 --retry-none 才重试）
  const todo = species.filter((s) => {
    const st = state[s.id]
    if (st && st.status === 'ok') return false
    if (st && st.status === 'none' && !OPT.retryNone) return false
    if (s.audio && s.audio.source === 'Xeno-canto' && !OPT.force) return false
    return true
  })

  console.log('\n🔄 XC 音频增量升级')
  console.log(`   manifest: ${path.relative(ROOT, manifestPath)}  物种 ${species.length}`)
  const totalTodo = Math.min(todo.length, OPT.limit)
  console.log(`   待处理 ${totalTodo}  并发 ${OPT.concurrency}  ${OPT.dryRun ? '[dry-run]' : ''}\n`)

  let done = 0
  let ok = 0
  let none = 0
  let err = 0
  await mapPool(todo.slice(0, OPT.limit), OPT.concurrency, async (sp) => {
    if (Date.now() > deadline) {
      done++
      return
    }
    if (!OPT.dryRun && done > 0 && done % 20 === 0) await saveManifest(manifestPath, manifest)
    try {
      const rec = await fetchXc(sp.nameSci)
      const a = pickXcAudio(rec, OPT.policy)
      if (!a) {
        state[sp.id] = { status: 'none', at: new Date().toISOString(), name: sp.nameSci }
        none++
        if (!OPT.dryRun) await saveState(state)
      } else {
        const asset = OPT.dryRun ? a : await materializeAudio(sp, a)
        sp.audios = [asset, ...(sp.audios || []).slice(1)]
        sp.audio = asset
        if (!OPT.dryRun) {
          state[sp.id] = { status: 'ok', at: new Date().toISOString(), name: sp.nameSci, xc: a.sourceUrl }
          await saveState(state)
        }
        ok++
      }
    } catch (e) {
      err++
      console.warn(`   ⚠️ ${sp.nameZh}: ${e.message}`)
    }
    done++
    if (done % 5 === 0 || done === totalTodo) {
      console.log(`   [${done}/${totalTodo}] XC ${ok} · 无 ${none} · 错 ${err}`)
    }
    await sleepR(1200, 2200) // 尊重 XC 限流
  })

  if (!OPT.dryRun) {
    await saveManifest(manifestPath, manifest)
    await saveState(state)
  }
  console.log(`\n✅ 完成：XC ${ok} · 无录音 ${none} · 失败 ${err}`)
  console.log(`   下一步：npm run r2:push（重传音频）→ 部署`)
}

/** 抓取 XC（缓存） */
async function fetchXc(sci) {
  const cacheFile = path.join(CACHE, 'xc', `${slug(sci)}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      const query = `sp:"${sci}"`
      const url = `https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(query)}&per_page=100&key=${encodeURIComponent(XC_KEY)}`
      return await fetchJson(url, { retries: 5, timeout: 90000 })
    },
    { force: OPT.force },
  )
}

/** 质量 A→E 优先，同质量取短的；许可过滤 */
function pickXcAudio(data, policy) {
  const order = { A: 0, B: 1, C: 2, D: 3, E: 4 }
  const recs = [...((data && data.recordings) || [])].sort(
    (a, b) => (order[a.q] ?? 9) - (order[b.q] ?? 9) || lengthSec(a.length) - lengthSec(b.length),
  )
  for (const r of recs) {
    if (!licenseAllowed(r.lic, policy)) continue
    let file = r.file || ''
    if (file.startsWith('//')) file = 'https:' + file
    if (!file) continue
    return {
      url: file,
      license: normalizeLicense(r.lic),
      licenseRaw: r.lic || '',
      author: (r.rec || '').trim() || '未知作者',
      source: 'Xeno-canto',
      sourceUrl: r.url || '',
      transcode: canTranscode(r.lic),
      quality: r.q || '',
    }
  }
  return null
}

function lengthSec(s) {
  const m = String(s || '').match(/^(\d+):(\d{1,2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 9999
}

/** 下载 →（可转码）→ 写 public/media/<id>/audio.<ext>，返回带 R2 地址的 asset */
async function materializeAudio(sp, a) {
  const dir = path.join(PUB_MEDIA, sp.id)
  await fs.mkdir(dir, { recursive: true })
  const tmpDir = path.join(TMP, sp.id)
  await fs.mkdir(tmpDir, { recursive: true })
  const raw = await download(a.url, path.join(tmpDir, 'audio.src'))

  let ext = 'mp3'
  let file = raw
  if (a.transcode) {
    const out = path.join(tmpDir, 'audio.mp3')
    try {
      await execFileP('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '1', out])
      file = out
      ext = 'mp3'
    } catch {
      ext = extFromUrl(a.url) || 'mp3'
    }
  } else {
    ext = extFromUrl(a.url) || 'mp3'
  }

  // 清掉该目录下其它 audio.*（避免旧扩展名残留）
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (f.startsWith('audio.') && f !== `audio.${ext}`) await fs.rm(path.join(dir, f), { force: true })
  }
  await fs.copyFile(file, path.join(dir, `audio.${ext}`))
  await fs.rm(tmpDir, { recursive: true, force: true })

  return { ...a, url: `${PUBLIC_BASE}/media/${sp.id}/audio.${ext}`, speciesId: sp.id, type: 'audio' }
}

function extFromUrl(url) {
  const m = String(url || '').match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  return m ? m[1].toLowerCase() : ''
}

async function download(url, dest, tries = 5) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 90000)
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'UNiaoer-build/0.1' } })
      clearTimeout(timer)
      if (!res.ok) {
        const e = new Error('download HTTP ' + res.status)
        e.retryable = res.status === 429 || res.status >= 500
        throw e
      }
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()))
      return dest
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (e.retryable === false || i >= tries - 1) break
      await sleep(1500 * (i + 1))
    }
  }
  throw lastErr
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE, 'xc-upgraded.json'), 'utf8'))
  } catch {
    return {}
  }
}
async function saveState(state) {
  await fs.mkdir(CACHE, { recursive: true })
  await fs.writeFile(path.join(CACHE, 'xc-upgraded.json'), JSON.stringify(state, null, 0))
}
async function saveManifest(manifestPath, manifest) {
  if (manifest.stats) {
    manifest.stats.withAudio = manifest.species.filter((s) => s.audio).length
    manifest.stats.audioCount = manifest.species.reduce((n, s) => n + (s.audios ? s.audios.length : 0), 0)
  }
  manifest.audioSource = 'Xeno-canto 优先 / iNaturalist 兜底'
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

main().catch((e) => {
  console.error('❌ 失败:', e)
  process.exit(1)
})
