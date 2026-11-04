/**
 * docs/103 首图质检 · 多模态逐张判定（级联：flash 主判 → 4.6v 复判 → 4.6v 耗尽则 flash 终判 + 全局降频）
 *
 * 用法：
 *   node scripts/qc-multimodal.mjs --sample 200     # 全库等距抽 200 张（校准跑）
 *   node scripts/qc-multimodal.mjs                  # 全量（断点续跑：已有判定的一律跳过）
 *   node scripts/qc-multimodal.mjs --limit 50 --rpm 20 --concurrency 2
 *
 * 级联（2026-11-04 用户二次定稿；免费模型只有 glm-4v-flash，glm-4v 是付费老款不参与）：
 *   1) 主判 glm-4v-flash（免费）；pass 即收工
 *   2) suspect / reject / 解析失败 → glm-4.6v 复判（结果为终判）
 *   3) 4.6v 连续 3 次 429（额度/限流耗尽）→ **疑点直接采信 flash 判定**，全局降频至 QC_RPM_FALLBACK 继续
 *   4) flash 自身连续 3 次 429 → 安全停止（非零退出），断点可续，绝不空转
 *
 * 断点真源：data-cache/media-qc/multimodal.jsonl（逐张追加，重跑只补缺）。
 * 凭证全部读 .env（QC_API_BASE / QC_API_KEY），不落钥于任何输出。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// ---------- .env ----------
const env = {}
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/)
    if (m) env[m[1]] = m[2]
  }
}
const BASE = (env.QC_API_BASE || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')
const KEY = env.QC_API_KEY
if (!KEY) {
  console.error('缺少 QC_API_KEY（.env）')
  process.exit(1)
}
const PRIMARY = 'glm-4v-flash' // 免费，主判
const SECONDARY = env.QC_MODEL || 'glm-4.6v' // 疑点复判（额度耗尽则回退 flash 终判）
const RPM = Number(process.env.QC_RPM || env.QC_RPM || 30)
const RPM_FALLBACK = Number(env.QC_RPM_FALLBACK || 12)
const CONCURRENCY = Number(process.env.QC_CONCURRENCY || env.QC_CONCURRENCY || 3)

// ---------- args ----------
const args = process.argv.slice(2)
const argOf = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const SAMPLE = argOf('--sample') ? Number(argOf('--sample')) : 0
const LIMIT = argOf('--limit') ? Number(argOf('--limit')) : 0
const OUT = 'data-cache/media-qc/multimodal.jsonl'

// ---------- 数据 ----------
const thumbs = JSON.parse(readFileSync('public/data/thumbs.json', 'utf8'))
const BASEURL = thumbs.base // https://bird.wewalk.world/media/
const thumbMap = thumbs.thumb // speciesId -> 文件名（image-1.thumb.webp | image-1.jpg）
const idx = JSON.parse(readFileSync('public/data/species-index.json', 'utf8')).species
const NAME = {}
for (const e of idx) NAME[e.nameSci.toLowerCase().replace(/\s+/g, '-')] = { zh: e.nameZh || '', sci: e.nameSci }

// ---------- 断点 ----------
mkdirSync('data-cache/media-qc', { recursive: true })
const done = new Set()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      done.add(JSON.parse(line).speciesId)
    } catch {
      /* 尾部半行忽略 */
    }
  }
}

let ids = Object.keys(thumbMap).sort()
if (SAMPLE > 0) {
  const stride = Math.max(1, Math.floor(ids.length / SAMPLE))
  ids = ids.filter((_, i) => i % stride === 0)
}
const todo = ids.filter((id) => !done.has(id)).slice(0, LIMIT || Infinity)

// ---------- 限速（全局令牌间隔，跨模型共享，保守对账号级限额） ----------
let curRpm = RPM
let lastAt = 0
async function gate() {
  const interval = 60_000 / curRpm
  const wait = lastAt + interval - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 下载（魔数校验 + 备选文件名） ----------
function magicOk(buf) {
  if (buf.length < 12) return false
  if (buf[0] === 0xff && buf[1] === 0xd8) return true // jpeg
  if (buf[0] === 0x89 && buf[1] === 0x50) return true // png
  return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP'
}
async function fetchImage(id) {
  const primary = thumbMap[id]
  const cands = [...new Set([primary, 'image-1.jpg', 'image-1.webp', 'image-1.jpeg'].filter(Boolean))]
  for (const f of cands) {
    const url = BASEURL + id + '/' + f
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 30_000)
      const res = await fetch(url, { signal: ctl.signal })
      clearTimeout(t)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (!magicOk(buf)) continue // HTML 错误页等
      return { url, buf }
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

/** 归一化为 ≤512px JPEG（token 拉平；webp 模型侧兼容性存疑，统一转 jpeg） */
function toJpeg512(buf) {
  const inPath = join(tmpdir(), `qc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const outPath = inPath + '.jpg'
  writeFileSync(inPath, buf)
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '75', '-Z', '512', inPath, '--out', outPath], { stdio: 'pipe' })
    return readFileSync(outPath)
  } finally {
    try {
      execFileSync('rm', ['-f', inPath, outPath])
    } catch {
      /* ignore */
    }
  }
}

// ---------- 模型调用 ----------
const RUBRIC = (zh, sci) => `你是鸟类图片质检员。判断这张图是否适合作为「${zh || sci}（${sci}）」的展示首图。
只检查图片质量：
- tiny_bird：鸟在画面占比过小，难看清识别特征
- blurry：明显模糊/失焦/严重运动模糊
- crop_bad：鸟主体被画框切掉（头/半身），构图严重不完整
- occluded：鸟被严重遮挡（网、笼、大面积枝叶）
- non_bird：主体不是鸟（纯风景/人/巢/蛋/兽/图画截图）
- watermark：明显水印、文字贴图、截图边框
- wrong_species：仅当你确信主体明显不是 ${sci} 才给；不确定不要给
判定：无上述问题=pass；轻微问题但不影响辨认=suspect；明显影响辨认/展示=reject。
只输出严格 JSON，无其它文字：{"verdict":"pass|suspect|reject","reasons":["…"],"note":"不超过20字"}`

async function chatVision(model, jpegBuf, zh, sci) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 60_000)
  const t0 = Date.now()
  try {
    // glm-4.5v/4.6v 是思考型模型：必须显式关思考，否则 max_tokens 被 reasoning 吃光、content 为空
    // （2026-11-04 实测：max8 时 content=""、全部进 reasoning_content，导致复判"永远不可用"）
    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBuf.toString('base64')}` } },
            { type: 'text', text: RUBRIC(zh, sci) },
          ],
        },
      ],
      max_tokens: model === PRIMARY ? 150 : 1024,
      temperature: 0,
    }
    if (/^glm-4\.[56]v/.test(model)) body.thinking = { type: 'disabled' }
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    })
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after')) || null
      return { status: 429, retryAfter: ra }
    }
    if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 120) }
    const j = await res.json()
    const text = j?.choices?.[0]?.message?.content ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { status: 200, parseError: true, text: text.slice(0, 120) }
    const v = JSON.parse(m[0])
    const verdict = ['pass', 'suspect', 'reject'].includes(v.verdict) ? v.verdict : 'suspect'
    const reasons = Array.isArray(v.reasons) ? v.reasons.filter((x) => typeof x === 'string').slice(0, 3) : []
    return { status: 200, verdict, reasons, note: String(v.note ?? '').slice(0, 30), ms: Date.now() - t0 }
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e).slice(0, 100) }
  } finally {
    clearTimeout(t)
  }
}

/** 带连续 429 退避的调用；返回 {status:429|200|err, ...}；consecutive 由调用方累计 */
async function callWithBackoff(model, jpegBuf, zh, sci) {
  for (let i = 0; i < 3; i++) {
    await gate()
    const r = await chatVision(model, jpegBuf, zh, sci)
    if (r.status === 429) {
      await sleep(Math.min((r.retryAfter || 10) * 1000, 20_000))
      continue
    }
    return r
  }
  return { status: 429 } // 连续 3 次 429
}

// ---------- 主循环（工作池） ----------
let flashExhausted = false // flash 自身连续 429 → 全停（没有其它免费模型可兜底）
let secondaryExhausted = false // 4.6v 连续 429 → 非 pass 直接采信 flash 终判 + 全局降频
const stats = { done: 0, pass: 0, suspect: 0, reject: 0, missing: 0, byModel: {}, secondaryCalls: 0, start: Date.now() }

function progress() {
  const el = Math.round((Date.now() - stats.start) / 1000)
  const eta = stats.done ? Math.round((el / stats.done) * (todo.length - stats.done)) : 0
  console.error(
    `[${stats.done}/${todo.length}] pass=${stats.pass} suspect=${stats.suspect} reject=${stats.reject} missing=${stats.missing} · ${el}s · ETA ${eta}s`,
  )
}

async function judgeOne(id) {
  const meta = NAME[id] || { zh: '', sci: id }
  const img = await fetchImage(id)
  if (!img) {
    return { speciesId: id, thumbUrl: BASEURL + id + '/' + (thumbMap[id] || ''), verdict: 'missing', reasons: ['fetch_fail'], note: '缩略与原图均不可取', model: '-', via: [], checkedAt: new Date().toISOString() }
  }
  const jpeg = toJpeg512(img.buf)
  const via = []

  // —— 主判（flash；自身额度/限流耗尽 → 安全停，没有其它免费模型可兜底） ——
  let r = await callWithBackoff(PRIMARY, jpeg, meta.zh, meta.sci)
  if (r.status === 429) {
    flashExhausted = true
    return { aborted: true }
  }
  via.push(PRIMARY)
  if (r.parseError) {
    // 主判没吐合法 JSON：按疑点送复判
    r = { status: 200, verdict: 'suspect', reasons: ['parse_error'], note: r.text ?? '' }
  }

  // —— 疑点升级复判（4.6v 终判；额度耗尽则直接采信 flash 判定 + 全局降频） ——
  let final = { verdict: r.verdict, reasons: r.reasons ?? [], note: r.note ?? '', model: PRIMARY }
  if (final.verdict !== 'pass' && !secondaryExhausted) {
    stats.secondaryCalls++
    const r2 = await callWithBackoff(SECONDARY, jpeg, meta.zh, meta.sci)
    if (r2.status === 429) {
      secondaryExhausted = true
      curRpm = RPM_FALLBACK
      console.error(`\n⚠️ ${SECONDARY} 额度/限流耗尽 → 非pass 直接采信 ${PRIMARY} 终判，频率降至 ${RPM_FALLBACK}/分钟`)
      final.note = (final.note + ' ·secondary_429_flash终判').slice(0, 40)
    } else if (r2.status === 200 && !r2.parseError) {
      via.push(SECONDARY)
      final = { verdict: r2.verdict, reasons: r2.reasons ?? [], note: r2.note ?? '', model: SECONDARY }
    } else {
      // 失败原因记进 note（解析失败/其它错误），便于事后核对
      const why = r2.parseError ? 'secondary_parse' : `secondary_${r2.status || r2.error || 'err'}`
      final.note = (final.note + ' ·' + why).slice(0, 40)
    }
  } else if (final.verdict !== 'pass') {
    final.note = (final.note + ' ·secondary_off').slice(0, 40)
  }
  return {
    speciesId: id,
    thumbUrl: img.url,
    verdict: final.verdict,
    reasons: final.reasons,
    note: final.note,
    model: final.model,
    via,
    checkedAt: new Date().toISOString(),
  }
}

async function worker(queue) {
  for (;;) {
    const id = queue.shift()
    if (!id || flashExhausted) return
    const row = await judgeOne(id)
    if (row.aborted) {
      flashExhausted = true
      return
    }
    appendFileSync(OUT, JSON.stringify(row) + '\n')
    stats.done++
    stats[row.verdict === 'missing' ? 'missing' : row.verdict] = (stats[row.verdict === 'missing' ? 'missing' : row.verdict] || 0) + 1
    stats.byModel[row.model] = (stats.byModel[row.model] || 0) + 1
    if (stats.done % 20 === 0) progress()
  }
}

const queue = [...todo]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))
progress()

if (flashExhausted && stats.done < todo.length) {
  console.error(`\n🛑 ${PRIMARY} 限流/额度耗尽，安全停止（不空转）。已完成 ${stats.done}/${todo.length}，断点已存，稍后重跑同一命令即续。`)
  process.exit(2)
}
console.log(
  `\n完成 ${stats.done} 张：pass=${stats.pass} suspect=${stats.suspect} reject=${stats.reject} missing=${stats.missing} · 复判调用 ${stats.secondaryCalls} 次 · 判定模型分布 ${JSON.stringify(stats.byModel)} · 结果在 ${OUT}`,
)
