/**
 * docs/103 续篇 · 第 2~5 张图质检（多模态逐张判定，级联：flash 主判 → 4.6v 复判 → 4.6v 耗尽则 flash 终判 + 全局降频）
 *
 * 与 `qc-multimodal.mjs`（只审首图 image-1）的区别：
 *   - 对象是各鸟种素材库的**第 2~5 张**（`images[1..4]`，按**数组位置**取，不是硬拼 image-2..5 文件名）
 *   - 判定口径从「展示首图」改为「出题/选项用图」（选项图作答前不显示文字，因此水印/截图边框尤其致命）
 *   - 断点键是 `speciesId#slot`（旧脚本是 speciesId，同一物种有多张图）
 *
 * 用法：
 *   node scripts/qc-multimodal-2345.mjs --dry-run           # 只列计划，不调 API
 *   node scripts/qc-multimodal-2345.mjs --sample 50         # 全库等距抽 50 张（校准跑）
 *   node scripts/qc-multimodal-2345.mjs --limit 100 --rpm 20
 *   node scripts/qc-multimodal-2345.mjs                     # 全量（断点续跑：已有判定的一律跳过）
 *   node scripts/qc-multimodal-2345.mjs --export            # 只把 JSONL 汇总成 manual-index2345.json，不调 API
 *
 * 级联（沿用 2026-11-04 定稿）：
 *   1) 主判 glm-4v-flash（免费）；pass 即收工
 *   2) suspect / reject / 解析失败 → glm-4.6v 复判（结果为终判）
 *   3) 4.6v 连续 3 次 429（额度/限流耗尽）→ 疑点直接采信 flash 判定，全局降频至 QC_RPM_FALLBACK 继续
 *   4) flash 自身连续 3 次 429 → 安全停止（非零退出），断点可续，绝不空转
 *
 * 断点真源：data-cache/qc-2345/multimodal-2345.jsonl（逐张追加，重跑只补缺）。
 * 聚合产物：data-cache/qc-2345/manual-index2345.json（供人工复核页导入）。
 * 凭证全部读 .env（QC_API_BASE / QC_API_KEY），不落钥于任何输出。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const PRIMARY = 'glm-4v-flash' // 免费，主判
const SECONDARY = env.QC_MODEL || 'glm-4.6v' // 疑点复判（额度耗尽则回退 flash 终判）
const RPM = Number(process.env.QC2345_RPM || env.QC2345_RPM || env.QC_RPM || 30)
const RPM_FALLBACK = Number(env.QC2345_RPM_FALLBACK || env.QC_RPM_FALLBACK || 12)
const CONCURRENCY = Number(process.env.QC2345_CONCURRENCY || env.QC2345_CONCURRENCY || env.QC_CONCURRENCY || 3)

// ---------- args ----------
const args = process.argv.slice(2)
const argOf = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (k) => args.includes(k)
const SAMPLE = argOf('--sample') ? Number(argOf('--sample')) : 0
const LIMIT = argOf('--limit') ? Number(argOf('--limit')) : 0
const SLOTS = (argOf('--slots') || '2,3,4,5')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
const ONLY_IDS = argOf('--ids') ? new Set(argOf('--ids').split(',').map((s) => s.trim())) : null
const DRY = has('--dry-run')
const EXPORT_ONLY = has('--export')
const OUT_DIR = 'data-cache/qc-2345'
const OUT = `${OUT_DIR}/multimodal-2345.jsonl`
const OUT_JSON = `${OUT_DIR}/manual-index2345.json`
const OUT_HTML = 'scripts/qc-review-2345.html'

// ---------- 数据：从 assets 分片收集每个物种的第 slot 张 ----------
const MEDIA_PREFIX_RE = /^https?:\/\/[^/]+\/media\//

/** manifest-meta：物种 id → 中/英/学名（11,026 条） */
const META = {}
if (existsSync('public/data/manifest-meta.json')) {
  const mm = JSON.parse(readFileSync('public/data/manifest-meta.json', 'utf8'))
  for (const e of mm.species || []) META[e.id] = { zh: e.nameZh || '', sci: e.nameSci || '', en: e.nameEn || '' }
}

function loadTargets() {
  const dir = 'public/data/assets'
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const out = []
  let noImage = 0
  for (const f of files) {
    const bucket = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    for (const [speciesId, sp] of Object.entries(bucket.species ?? {})) {
      const images = sp.images ?? []
      if (!images.length) {
        noImage++
        continue
      }
      for (const slot of SLOTS) {
        const img = images[slot - 1]
        if (!img) continue // 该物种不足 slot 张
        const meta = META[speciesId] || {}
        out.push({
          speciesId,
          slot, // 1-based，与界面上的「第 N 张」一致
          image: img,
          nameZh: meta.zh || '',
          nameSci: meta.sci || '',
          nameEn: meta.en || '',
          totalImages: images.length,
        })
      }
    }
  }
  return { out, noImage }
}

/** 从已转码文件名派生出可能的变体：image-6.full.webp → image-6.thumb.webp */
function deriveThumb(url) {
  if (!url || !MEDIA_PREFIX_RE.test(url)) return null
  const seg = url.split('/').pop()
  if (!seg) return null
  const m = seg.match(/^(image-\d+)\.(full\.webp|full\.avif|xl\.webp|thumb\.webp|jpe?g|png|webp)$/i)
  if (!m) return null
  const head = url.slice(0, url.length - seg.length)
  return head + m[1] + '.thumb.webp'
}

/** 该图的候选 URL 链：显式缩略 → 派生缩略 → 原图（去重、保序） */
function candidatesOf(img) {
  const list = [img.thumbUrl, deriveThumb(img.url), img.url].filter(Boolean)
  return [...new Set(list)]
}

// ---------- 断点 ----------
mkdirSync(OUT_DIR, { recursive: true })
const done = new Set()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      // 只有「真实判定」才算完成；error（网络/5xx）留待重跑
      if (r.verdict && r.verdict !== 'error') done.add(`${r.speciesId}#${r.slot}`)
    } catch {
      /* 尾部半行忽略 */
    }
  }
}

// ---------- 限量 / 抽样 ----------
const { out: allTargets, noImage } = loadTargets()
let targets = ONLY_IDS ? allTargets.filter((t) => ONLY_IDS.has(t.speciesId)) : allTargets
if (SAMPLE > 0) {
  const stride = Math.max(1, Math.floor(targets.length / SAMPLE))
  targets = targets.filter((_, i) => i % stride === 0)
}
const todo = targets.filter((t) => !done.has(`${t.speciesId}#${t.slot}`)).slice(0, LIMIT || Infinity)

const bySlot = {}
for (const t of allTargets) bySlot[t.slot] = (bySlot[t.slot] || 0) + 1

// ---------- 聚合导出（JSONL → manual-index2345.json） ----------
function exportJsonl() {
  if (!existsSync(OUT)) {
    console.error('缺少', OUT, '—— 先跑一轮判定')
    process.exit(1)
  }
  const rows = readFileSync(OUT, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  // 每 (speciesId, slot) 取最后一条（重跑覆盖）
  const latest = new Map()
  for (const r of rows) latest.set(`${r.speciesId}#${r.slot}`, r)

  const bySpecies = new Map()
  for (const t of allTargets) {
    if (!bySpecies.has(t.speciesId)) {
      bySpecies.set(t.speciesId, { speciesId: t.speciesId, nameZh: t.nameZh, nameSci: t.nameSci, nameEn: t.nameEn, totalImages: t.totalImages, images: [] })
    }
  }
  // 按 (物种, slot) 顺序填图：从 allTargets 回去找原始 image 元数据
  for (const t of allTargets) {
    const rec = bySpecies.get(t.speciesId)
    const r = latest.get(`${t.speciesId}#${t.slot}`)
    const img = t.image
    rec.images.push({
      slot: t.slot,
      url: img.url || '',
      thumbUrl: img.thumbUrl || deriveThumb(img.url) || img.url || '',
      originalUrl: img.originalUrl || '',
      author: img.author || '',
      license: img.license || '',
      source: img.source || '',
      sourceUrl: img.sourceUrl || '',
      verdict: r?.verdict || null,
      reasons: r?.reasons || [],
      note: r?.note || '',
      model: r?.model || '',
      via: r?.via || [],
      checkedAt: r?.checkedAt || null,
    })
  }
  for (const rec of bySpecies.values()) rec.images.sort((a, b) => a.slot - b.slot)

  const verdicts = { pass: 0, suspect: 0, reject: 0, missing: 0, pending: 0 }
  const reasonCount = {}
  let judged = 0
  for (const rec of bySpecies.values()) {
    for (const im of rec.images) {
      if (!im.verdict) {
        verdicts.pending++
        continue
      }
      judged++
      verdicts[im.verdict] = (verdicts[im.verdict] || 0) + 1
      for (const why of im.reasons) reasonCount[why] = (reasonCount[why] || 0) + 1
    }
  }

  const payload = {
    $schema: 'uniaoer/qc-2345@1',
    generatedAt: new Date().toISOString(),
    base: 'https://bird.wewalk.world/media/',
    slots: SLOTS,
    models: { primary: PRIMARY, secondary: SECONDARY },
    stats: {
      species: bySpecies.size,
      images: judged + verdicts.pending,
      judged,
      verdicts,
      reasons: reasonCount,
      speciesWithoutImages: noImage,
    },
    species: [...bySpecies.values()].sort((a, b) => (a.speciesId < b.speciesId ? -1 : 1)),
  }
  writeFileSync(OUT_JSON, JSON.stringify(payload))
  console.log(
    `已导出 ${OUT_JSON}：${payload.stats.species} 种 / ${payload.stats.images} 张（已判 ${judged}）` +
      ` · pass ${verdicts.pass} suspect ${verdicts.suspect} reject ${verdicts.reject} missing ${verdicts.missing} pending ${verdicts.pending}`,
  )
  console.log(`人工复核：直接双击打开 ${OUT_HTML}，导入上面的 JSON`)
}

// ---------- --dry-run / --export ----------
if (DRY) {
  console.log(`候选：${allTargets.length} 张（按 slot 分布 ${JSON.stringify(bySlot)}）· 无图物种 ${noImage}`)
  console.log(`已完成（断点 ${OUT}）：${done.size} 张 · 待跑：${todo.length} 张`)
  console.log(`限速：${RPM}/分钟 · 并发 ${CONCURRENCY} → 预计 ${((todo.length / RPM) * 60) / 3600} 小时`)
  for (const t of todo.slice(0, 10)) {
    console.log(`  ${t.speciesId}#${t.slot} → ${candidatesOf(t.image)[0]}`)
  }
  if (todo.length > 10) console.log(`  … 其余 ${todo.length - 10} 张`)
  process.exit(0)
}
if (EXPORT_ONLY) {
  exportJsonl()
  process.exit(0)
}

if (!KEY) {
  console.error('缺少 QC_API_KEY（.env）')
  process.exit(1)
}

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

// ---------- 下载（魔数校验 + 候选链） ----------
function magicOk(buf) {
  if (buf.length < 12) return false
  if (buf[0] === 0xff && buf[1] === 0xd8) return true // jpeg
  if (buf[0] === 0x89 && buf[1] === 0x50) return true // png
  return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP'
}
async function fetchImage(img) {
  for (const url of candidatesOf(img)) {
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
  const inPath = join(tmpdir(), `qc2345-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
const RUBRIC = (zh, sci, slot) => `你是鸟类图片质检员。判断这张图是否适合作为「${zh || sci}（${sci}）」的**出题/选项用图**（第 ${slot} 张素材）。
只检查图片质量：
- tiny_bird：鸟在画面占比过小，难看清识别特征
- blurry：明显模糊/失焦/严重运动模糊
- crop_bad：鸟主体被画框切掉（头/半身），构图严重不完整
- occluded：鸟被严重遮挡（网、笼、大面积枝叶）
- non_bird：主体不是鸟（纯风景/人/巢/蛋/兽/图画截图）
- watermark：明显水印、文字贴图、截图边框
- wrong_species：仅当你确信主体明显不是 ${sci} 才给；同一物种的不同亚种、羽色、雌雄异型、幼鸟不要给；不确定不要给
判定：无上述问题=pass；轻微问题但不影响辨认=suspect；明显影响辨认/出题=reject。
只输出严格 JSON，无其它文字：{"verdict":"pass|suspect|reject","reasons":["…"],"note":"不超过20字"}`

async function chatVision(model, jpegBuf, zh, sci, slot) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 60_000)
  const t0 = Date.now()
  try {
    // glm-4.5v/4.6v 是思考型模型：必须显式关思考，否则 max_tokens 被 reasoning 吃光、content 为空
    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBuf.toString('base64')}` } },
            { type: 'text', text: RUBRIC(zh, sci, slot) },
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

/** 带退避的调用。429 与 5xx 重试；401/403 属凭证问题，交给调用方立即止损 */
async function callWithBackoff(model, jpegBuf, zh, sci, slot) {
  for (let i = 0; i < 3; i++) {
    await gate()
    const r = await chatVision(model, jpegBuf, zh, sci, slot)
    if (r.status === 429) {
      await sleep(Math.min((r.retryAfter || 10) * 1000, 20_000))
      continue
    }
    if (r.status === 401 || r.status === 403) return r // 凭证/权限问题，重试无意义
    if (r.status >= 500) {
      await sleep(2_000 * (i + 1))
      continue
    }
    return r
  }
  return { status: 429 } // 连续 3 次 429
}

// ---------- 主循环（工作池） ----------
let flashExhausted = false
let secondaryExhausted = false
let authFailed = '' // 401/403：凭证失效，立即止损（重试无意义）
const stats = { done: 0, pass: 0, suspect: 0, reject: 0, missing: 0, error: 0, byModel: {}, secondaryCalls: 0, start: Date.now() }

function progress() {
  const el = Math.round((Date.now() - stats.start) / 1000)
  const eta = stats.done ? Math.round((el / stats.done) * (todo.length - stats.done)) : 0
  console.error(
    `[${stats.done}/${todo.length}] pass=${stats.pass} suspect=${stats.suspect} reject=${stats.reject} missing=${stats.missing} · ${el}s · ETA ${eta}s`,
  )
}

async function judgeOne(t) {
  const img = await fetchImage(t.image)
  const base = {
    speciesId: t.speciesId,
    slot: t.slot,
    nameZh: t.nameZh,
    nameSci: t.nameSci,
    totalImages: t.totalImages,
    license: t.image.license || '',
    author: t.image.author || '',
    source: t.image.source || '',
    sourceUrl: t.image.sourceUrl || '',
  }
  if (!img) {
    return {
      ...base,
      imgUrl: candidatesOf(t.image)[0] || '',
      verdict: 'missing',
      reasons: ['fetch_fail'],
      note: '缩略与原图均不可取',
      model: '-',
      via: [],
      checkedAt: new Date().toISOString(),
    }
  }
  const jpeg = toJpeg512(img.buf)
  const via = []

  let r = await callWithBackoff(PRIMARY, jpeg, t.nameZh, t.nameSci, t.slot)
  if (r.status === 429) {
    flashExhausted = true
    return { aborted: true }
  }
  if (r.status === 401 || r.status === 403) {
    authFailed = `主判 ${PRIMARY} 返回 ${r.status}：${r.error || '认证失败'}`
    return { aborted: true }
  }
  if (r.status !== 200) {
    // 其它错误（网络/超时/5xx）：写一条可续跑的失败行，不当成有效判定
    return {
      ...base,
      imgUrl: img.url,
      verdict: 'error',
      reasons: [`http_${r.status || 'net'}`],
      note: String(r.error || '请求失败').slice(0, 40),
      model: '-',
      via: [],
      checkedAt: new Date().toISOString(),
      retriable: true,
    }
  }
  via.push(PRIMARY)
  if (r.parseError) {
    r = { status: 200, verdict: 'suspect', reasons: ['parse_error'], note: r.text ?? '' }
  }

    let final = { verdict: r.verdict, reasons: r.reasons ?? [], note: r.note ?? '', model: PRIMARY }
  if (final.verdict !== 'pass' && !secondaryExhausted) {
    stats.secondaryCalls++
    const r2 = await callWithBackoff(SECONDARY, jpeg, t.nameZh, t.nameSci, t.slot)
    if (r2.status === 401 || r2.status === 403) {
      authFailed = `复判 ${SECONDARY} 返回 ${r2.status}：${r2.error || '认证失败'}`
      return { aborted: true }
    }
    if (r2.status === 429) {
      secondaryExhausted = true
      curRpm = RPM_FALLBACK
      console.error(`\n⚠️ ${SECONDARY} 额度/限流耗尽 → 非pass 直接采信 ${PRIMARY} 终判，频率降至 ${RPM_FALLBACK}/分钟`)
      final.note = (final.note + ' ·secondary_429_flash终判').slice(0, 40)
    } else if (r2.status === 200 && !r2.parseError) {
      via.push(SECONDARY)
      final = { verdict: r2.verdict, reasons: r2.reasons ?? [], note: r2.note ?? '', model: SECONDARY }
    } else {
      const why = r2.parseError ? 'secondary_parse' : `secondary_${r2.status || r2.error || 'err'}`
      final.note = (final.note + ' ·' + why).slice(0, 40)
    }
  } else if (final.verdict !== 'pass') {
    final.note = (final.note + ' ·secondary_off').slice(0, 40)
  }

  return {
    ...base,
    imgUrl: img.url,
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
    const t = queue.shift()
    if (!t || flashExhausted || authFailed) return
    const row = await judgeOne(t)
    if (row.aborted) {
      if (!authFailed) flashExhausted = true
      return
    }
    appendFileSync(OUT, JSON.stringify(row) + '\n')
    stats.done++
    stats[row.verdict] = (stats[row.verdict] || 0) + 1
    stats.byModel[row.model] = (stats.byModel[row.model] || 0) + 1
    if (stats.done % 20 === 0) progress()
  }
}

const queue = [...todo]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))
progress()

if (authFailed) {
  console.error(`\n🛑 凭证失效，已停止：${authFailed}`)
  console.error('   检查 .env 的 QC_API_KEY / QC_API_BASE（智谱控制台确认 key 是否过期或被轮换）。断点已存，换 key 后重跑同一命令即续。')
  process.exit(3)
}
if (flashExhausted && stats.done < todo.length) {
  console.error(`\n🛑 ${PRIMARY} 限流/额度耗尽，安全停止（不空转）。已完成 ${stats.done}/${todo.length}，断点已存，稍后重跑同一命令即续。`)
  process.exit(2)
}

console.log(
  `\n完成 ${stats.done} 张：pass=${stats.pass} suspect=${stats.suspect} reject=${stats.reject} missing=${stats.missing}` +
    (stats.error ? ` error=${stats.error}（重跑会重试）` : '') +
    ` · 复判调用 ${stats.secondaryCalls} 次 · 判定模型分布 ${JSON.stringify(stats.byModel)} · 结果在 ${OUT}`,
)
exportJsonl()
