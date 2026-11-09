/**
 * QC 采集引擎 · 两个批次（首图 / 第 2~5 张）共用的那一套
 *
 * 存在理由：`qc-multimodal.mjs`（504 行）与 `qc-multimodal-2345.mjs`（611 行）里
 * 有 9 个函数逐字重复（fetchImage / toJpeg512 / chatVision / callWithBackoff /
 * magicOk / gate / progress / worker / judgeOne）。判定口径已抽到 `qc-taxonomy.mjs`，
 * 这一层负责**怎么取图、怎么调模型、怎么限速、怎么写断点**——与「判成什么」无关。
 *
 * 分层：
 *   qc-taxonomy.mjs  判定口径（标签 / 分桶 / rubric / 合并规则）
 *   qc-engine.mjs    采集引擎（本文件，无业务判断）
 *   qc.mjs           入口（批次配置 + CLI）
 *
 * 凭证只从 .env 读，不落任何输出。
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rubric as buildRubric,
  resolveBucket,
  bucketOfLegacy,
  finalBucket,
  cleanLabels,
  mergeBuckets,
  reconcileWithNote,
  LABEL_BUCKET,
  BUCKET_LABEL_ZH,
} from './qc-taxonomy.mjs'

// ---------- .env ----------
export function loadEnv() {
  const env = {}
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/)
      if (m) env[m[1]] = m[2].trim()
    }
  }
  return env
}

export function createConfig(env) {
  return {
    base: (env.QC_API_BASE || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    key: env.QC_API_KEY,
    primary: 'glm-4v-flash', // 免费，主判
    secondary: env.QC_MODEL || 'glm-4.6v',
    rpm: Number(process.env.QC_RPM || env.QC_RPM || 30),
    rpmFallback: Number(process.env.QC_RPM_FALLBACK || env.QC_RPM_FALLBACK || 12),
    concurrency: Number(process.env.QC_CONCURRENCY || env.QC_CONCURRENCY || 3),
  }
}

// ---------- 限速（全局令牌间隔，跨模型共享，保守对账号级限额） ----------
export function createGate(getRpm) {
  let lastAt = 0
  return async function gate() {
    const interval = 60_000 / getRpm()
    const wait = lastAt + interval - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastAt = Date.now()
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 下载 ----------
export function magicOk(buf) {
  if (buf.length < 12) return false
  if (buf[0] === 0xff && buf[1] === 0xd8) return true // jpeg
  if (buf[0] === 0x89 && buf[1] === 0x50) return true // png
  return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP'
}

const MEDIA_PREFIX_RE = /^https?:\/\/[^/]+\/media\//

/** 从已转码文件名派生出可能的变体：image-6.full.webp → image-6.thumb.webp */
export function deriveThumb(url) {
  if (!url || !MEDIA_PREFIX_RE.test(url)) return null
  const seg = url.split('/').pop()
  if (!seg) return null
  const m = seg.match(/^(image-\d+)\.(full\.webp|full\.avif|xl\.webp|thumb\.webp|jpe?g|png|webp)$/i)
  if (!m) return null
  const head = url.slice(0, url.length - seg.length)
  return head + m[1] + '.thumb.webp'
}

/** 该图的候选 URL 链：显式缩略 → 派生缩略 → 原图（去重、保序） */
export function candidatesOf(img) {
  const list = [img.thumbUrl, deriveThumb(img.url), img.url].filter(Boolean)
  return [...new Set(list)]
}

/** 按候选链取图；全部失败返回 null。魔数校验防止把 HTML 错误页当图片。 */
export async function fetchImage(candidates) {
  for (const url of candidates) {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 30_000)
      const res = await fetch(url, { signal: ctl.signal })
      clearTimeout(t)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (!magicOk(buf)) continue
      return { url, buf }
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

/** 归一化为 ≤512px JPEG（token 拉平；webp 模型侧兼容性存疑，统一转 jpeg） */
export function toJpeg512(buf) {
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
export function createVision({ base, key, primary, secondary }) {
  /**
   * 单次视觉调用。返回 {status, verdict?, labels?, note?, parseError?, retryAfter?, error?}
   * verdict 一律归一为四态（exclude/human/species/pass），无论模型吐的是新格式还是老三态。
   */
  async function chatVision(model, jpegBuf, text) {
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
              { type: 'text', text },
            ],
          },
        ],
        max_tokens: model === primary ? 150 : 1024,
        temperature: 0,
      }
      if (/^glm-4\.[56]v/.test(model)) body.thinking = { type: 'disabled' }
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      })
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after')) || null
        return { status: 429, retryAfter: ra }
      }
      if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 120) }
      const j = await res.json()
      const raw = j?.choices?.[0]?.message?.content ?? ''
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return { status: 200, parseError: true, text: raw.slice(0, 120) }
      const v = JSON.parse(m[0])
      const rawVerdict = String(v.verdict ?? '').toLowerCase()
      // JSON 合法但没有 verdict 字段 → 不算有效判定（实测 glm-4.6v 会返回
      // {"note":"相机拍摄的活鸟"} 这种只有 note 的残片）。当成 parseError，
      // **不要凭空造一个 human**。
      if (!rawVerdict) return { status: 200, parseError: true, text: raw.slice(0, 120) }
      const labels = Array.isArray(v.labels) ? v.labels.filter((x) => typeof x === 'string').slice(0, 4) : []
      // 模型偶尔沿用旧三态词，或把标签名塞进 verdict 字段 —— 就地换算，不丢结果
      let verdict
      if (rawVerdict === 'pass') verdict = 'pass'
      else if (rawVerdict === 'suspect') verdict = 'human'
      else if (rawVerdict === 'reject') verdict = bucketOfLegacy('reject', labels)
      else if (['exclude', 'human', 'species'].includes(rawVerdict)) verdict = rawVerdict
      else if (Object.hasOwn(LABEL_BUCKET, rawVerdict)) verdict = LABEL_BUCKET[rawVerdict]
      else return { status: 200, parseError: true, text: raw.slice(0, 120) }
      return { status: 200, verdict, labels, note: String(v.note ?? '').slice(0, 30), ms: Date.now() - t0 }
    } catch (e) {
      return { status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e).slice(0, 100) }
    } finally {
      clearTimeout(t)
    }
  }

  /** 带 429/5xx 退避的调用；返回 {status:429|200|err} */
  async function callWithBackoff(model, jpegBuf, text, gate) {
    for (let i = 0; i < 3; i++) {
      await gate()
      const r = await chatVision(model, jpegBuf, text)
      if (r.status === 429) {
        await sleep(Math.min((r.retryAfter || 10) * 1000, 20_000))
        continue
      }
      if (r.status === 401 || r.status === 403) return r // 凭证问题，重试无意义
      if (r.status >= 500) {
        await sleep(2_000 * (i + 1))
        continue
      }
      return r
    }
    return { status: 429 } // 连续 3 次 429
  }

  return { chatVision, callWithBackoff, primary, secondary }
}

// ---------- 单张判定 ----------
/**
 * 判定一张图。target = { speciesId, slot, image, nameZh, nameSci, nameEn, totalImages }
 * purpose = '展示首图' | '出题/选项用图'
 *
 * 级联（2026-11-09 定稿）：
 *   1) glm-4v-flash 主判（免费）；pass 即收工
 *   2) 非 pass → glm-4.6v 复判
 *   3) 合并：**只对 exclude 取严**（flash 偏严、4.6v 偏松；human 也取严会把 80% 推进 human 桶）
 *   4) flash 自身连续 429 → 安全停止（断点可续）；4.6v 耗尽 → 采信 flash + 降频
 *   5) 后置校验：note 说「活鸟/主体清晰」却标了 specimen 之类 → 不信标签，交人判
 */
export function createJudge({ vision, gate, state, purpose }) {
  const { primary, secondary, callWithBackoff } = vision

  return async function judgeOne(target) {
    const { speciesId, slot, image, nameZh, nameSci } = target
    const text = buildRubric({ zh: nameZh, sci: nameSci, slot: purpose === '展示首图' ? 0 : slot, purpose })
    const base = {
      speciesId,
      slot,
      nameZh: nameZh || '',
      nameSci: nameSci || '',
      totalImages: target.totalImages,
      license: image.license || '',
      author: image.author || '',
      source: image.source || '',
      sourceUrl: image.sourceUrl || '',
    }

    const img = await fetchImage(candidatesOf(image))
    if (!img) {
      return {
        ...base,
        imgUrl: candidatesOf(image)[0] || '',
        verdict: 'missing',
        bucket: 'missing',
        labels: ['fetch_fail'],
        reasons: ['fetch_fail'],
        note: '缩略与原图均不可取',
        model: '-',
        via: [],
        checkedAt: new Date().toISOString(),
      }
    }
    const jpeg = toJpeg512(img.buf)
    const via = []

    // —— 主判 ——
    let r = await callWithBackoff(primary, jpeg, text, gate)
    if (r.status === 429) {
      state.flashExhausted = true
      return { aborted: true }
    }
    if (r.status === 401 || r.status === 403) {
      state.authFailed = `主判 ${primary} 返回 ${r.status}：${r.error || '认证失败'}`
      return { aborted: true }
    }
    if (r.status !== 200) {
      // 网络/5xx：写一条可续跑的失败行，不当成有效判定
      return {
        ...base,
        imgUrl: img.url,
        verdict: 'error',
        bucket: 'error',
        labels: [],
        reasons: [`http_${r.status || 'net'}`],
        note: String(r.error || '请求失败').slice(0, 40),
        model: '-',
        via: [],
        checkedAt: new Date().toISOString(),
        retriable: true,
      }
    }
    via.push(primary)
    if (r.parseError) {
      r = { status: 200, verdict: 'human', labels: ['parse_error'], note: r.text ?? '' }
    }

    const pBucket = resolveBucket(r.verdict, r.labels ?? [])
    const pLabels = cleanLabels(r.labels)
    let final = { verdict: pBucket, labels: pLabels, note: r.note ?? '', model: primary }

    // —— 复判（只对非 pass 发起） ——
    if (final.verdict !== 'pass' && !state.secondaryExhausted) {
      state.secondaryCalls++
      const r2 = await callWithBackoff(secondary, jpeg, text, gate)
      if (r2.status === 401 || r2.status === 403) {
        state.authFailed = `复判 ${secondary} 返回 ${r2.status}：${r2.error || '认证失败'}`
        return { aborted: true }
      }
      if (r2.status === 429) {
        state.secondaryExhausted = true
        state.rpm = state.rpmFallback
        console.error(`\n⚠️ ${secondary} 额度/限流耗尽 → 采信 ${primary} 判定，频率降至 ${state.rpmFallback}/分钟`)
        final.note = (final.note + ' ·secondary_429_flash终判').slice(0, 40)
      } else if (r2.status === 200 && !r2.parseError) {
        via.push(secondary)
        const sBucket = resolveBucket(r2.verdict, r2.labels ?? [])
        const merged = mergeBuckets(pBucket, pLabels, sBucket, cleanLabels(r2.labels))
        final = {
          verdict: merged.bucket,
          labels: merged.labels,
          note: [r.note, r2.note].filter(Boolean).join(' / ').slice(0, 40),
          model: `${primary}+${secondary}`,
        }
      } else {
        const why = r2.parseError ? 'secondary_parse' : `secondary_${r2.status || r2.error || 'err'}`
        final.note = (final.note + ' ·' + why).slice(0, 40)
      }
    } else if (final.verdict !== 'pass') {
      final.note = (final.note + ' ·secondary_off').slice(0, 40)
    }

    // —— 后置校验：note 与标签矛盾 → 交人判 ——
    const rec = reconcileWithNote(final.labels, final.note)
    let bucket = final.verdict
    let labels = rec.labels
    if (rec.conflicted) {
      bucket = 'human'
      if (!labels.length) labels = ['low_res']
      final.note = (final.note + ' ·note与标签矛盾').slice(0, 60)
    }

    return {
      ...base,
      imgUrl: img.url,
      verdict: bucket,
      bucket,
      labels,
      reasons: labels, // 兼容旧复核页字段名
      note: final.note,
      model: final.model,
      via,
      checkedAt: new Date().toISOString(),
    }
  }
}

// ---------- 断点 ----------
export function loadCheckpoint(path, keyOf) {
  const done = new Set()
  if (!existsSync(path)) return done
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      // 只有「真实判定」才算完成；error / 解析失败留待重跑
      if (r.verdict && r.verdict !== 'error') done.add(keyOf(r))
    } catch {
      /* 尾部半行忽略 */
    }
  }
  return done
}

export function appendRow(path, row) {
  mkdirSync(join(path, '..'), { recursive: true })
  appendFileSync(path, JSON.stringify(row) + '\n')
}

export function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null // 半行
      }
    })
    .filter(Boolean)
}

// ---------- 工作池 ----------
export async function runPool({ targets, judgeOne, concurrency, outPath, state, onProgress }) {
  const queue = [...targets]
  let done = 0
  async function worker() {
    for (;;) {
      if (state.flashExhausted || state.authFailed) return
      const t = queue.shift()
      if (!t) return
      const row = await judgeOne(t)
      if (row.aborted) {
        if (!state.authFailed) state.flashExhausted = true
        return
      }
      appendRow(outPath, row)
      done++
      state.done++
      state.counts[row.verdict] = (state.counts[row.verdict] || 0) + 1
      state.byModel[row.model] = (state.byModel[row.model] || 0) + 1
      if (onProgress && done % 20 === 0) onProgress(done, state)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length || 1) }, worker))
  return done
}

// ---------- 尺寸探针（HTTP Range 读 WebP 头，不下载整图） ----------
export function webpDims(buf) {
  if (buf.length < 30) return null
  if (buf.slice(0, 4).toString() !== 'RIFF') return null
  const fourcc = buf.slice(12, 16).toString()
  if (fourcc === 'VP8X') {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
    return { w, h, kind: fourcc }
  }
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff), kind: fourcc }
  }
  if (fourcc === 'VP8 ') {
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, kind: fourcc }
  }
  return null
}

/**
 * 对每张图的**原始尺寸**做探测。xl.webp 是原尺寸直出
 * （build-bank.mjs:1160 的 scale 只作用于 full.webp），无 xl（ND 图）退回 full/jpg。
 *
 * target.image 需要给出该 slot 的 url；本函数自行派生 xl/thumb 变体。
 */
export async function probeDims({ targets, outPath, concurrency = 20, onTick }) {
  const done = new Set(readJsonl(outPath).map((r) => r.speciesId + '#' + (r.slot ?? 1)))
  const todo = targets.filter((t) => !done.has(t.speciesId + '#' + (t.slot ?? 1)))
  console.log(`尺寸探针：待测 ${todo.length} 张 · 已完成 ${done.size} 张`)

  let ok = 0
  let fail = 0
  let next = 0
  const t0 = Date.now()

  async function probeOne(t) {
    const seg = (t.image.url || '').split('/').pop() || ''
    const m = seg.match(/^(image-\d+)\./)
    const head = t.image.url ? t.image.url.slice(0, t.image.url.length - seg.length) : ''
    const name = m ? m[1] : 'image-1'
    const cands = [`${head}${name}.xl.webp`, t.image.url, `${head}${name}.jpg`].filter(Boolean)
    for (const u of cands) {
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 15_000)
        const res = await fetch(u, { headers: { range: 'bytes=0-63' }, signal: ctl.signal })
        clearTimeout(timer)
        if (!res.ok) continue
        const buf = Buffer.from(await res.arrayBuffer())
        const d = webpDims(buf)
        if (d) {
          return { speciesId: t.speciesId, slot: t.slot ?? 1, longEdge: Math.max(d.w, d.h), w: d.w, h: d.h, kind: d.kind, url: u }
        }
      } catch {
        /* 下一个候选 */
      }
    }
    return { speciesId: t.speciesId, slot: t.slot ?? 1, longEdge: null, error: 'unreadable' }
  }

  async function worker() {
    for (;;) {
      const i = next++
      if (i >= todo.length) return
      const rec = await probeOne(todo[i])
      appendRow(outPath, rec)
      if (rec.longEdge) ok++
      else fail++
      if (onTick && (ok + fail) % 500 === 0) onTick(ok + fail, todo.length, ok, fail, Date.now() - t0)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length || 1) }, worker))

  const all = readJsonl(outPath)
  const edges = all.map((r) => r.longEdge).filter((n) => Number.isFinite(n))
  const dist = { lt800: 0, '800-1200': 0, ge1200: 0 }
  for (const e of edges) dist[e < 800 ? 'lt800' : e < 1200 ? '800-1200' : 'ge1200']++
  return { ok, fail, total: all.length, dist, min: edges.length ? Math.min(...edges) : null, max: edges.length ? Math.max(...edges) : null }
}

// ---------- 重分桶（0 API 成本） ----------
/**
 * 用当前口径重算已有结果。
 *
 * 两种数据都能处理：
 *   - 新格式：带 labels / bucket（本轮跑的）
 *   - 老格式：只有 verdict(三态) + reasons（2026-11-04 那批）
 *
 * 只做**一处降级修正**：exclude 但只有 occluded（无硬标签）→ human。
 * 不做全量重算，因为 pass 记录按 mergeBuckets 规则会带 human 类标签（供筛选），
 * 用 finalBucket 全量重算会把这些 pass 全部变成 human（2026-11-09 踩过）。
 */
const HARD_EXCLUDE = ['non_bird', 'with_human', 'specimen', 'illustration', 'egg', 'blurry_severe']

/** 旧 rubric 没有的标签，从自然语言理由里兜底捞（不调 API） */
const TEXT_RULES = [
  [/骨骼|骨架|剥制|标本|残骸|头骨|标本架|标本柜/i, 'specimen'],
  [/绘画|插图|图鉴|手绘|水彩|版画|邮票|卡通|插画|绘图|素描/i, 'illustration'],
  [/鸟蛋|巢中蛋|无壳蛋/i, 'egg'],
  [/手持|手抓|人手|环志|戴环|人腿|人身|自拍/i, 'with_human'],
]

export function reclassifyRows(rows, keyOf, { textFallback = true } = {}) {
  const latest = new Map()
  for (const r of rows) latest.set(keyOf(r), r)
  const out = []
  const buckets = {}
  const labelCount = {}
  for (const r of latest.values()) {
    let labels = r.labels
    if (!labels) {
      // 老结果没有 labels：从 reasons 里挑出像标签的（全小写+下划线）
      labels = (r.reasons || []).filter((x) => /^[a-z][a-z_]*$/.test(x))
    }
    let fromText = []
    if (textFallback) {
      const blob = [r.note || '', ...(r.reasons || []), ...(r.labels || [])].join(' ')
      fromText = TEXT_RULES.filter(([re]) => re.test(blob)).map(([, tag]) => tag)
      for (const t of fromText) if (!labels.includes(t)) labels = [...labels, t]
    }

    let bucket
    if (r.verdict === 'missing' || r.bucket === 'missing') bucket = 'missing'
    else if (r.verdict === 'error' || r.bucket === 'error') bucket = 'error'
    else if (r.bucket) {
      bucket = r.bucket
      // 唯一修正：只靠 occluded 排除的 → 降为 human
      if (bucket === 'exclude' && !labels.some((l) => HARD_EXCLUDE.includes(l)) && labels.includes('occluded')) {
        bucket = 'human'
      }
    } else if (labels.length) bucket = finalBucket(labels)
    else bucket = r.verdict === 'pass' ? 'pass' : bucketOfLegacy(r.verdict, r.reasons)

    buckets[bucket] = (buckets[bucket] || 0) + 1
    for (const l of labels) labelCount[l] = (labelCount[l] || 0) + 1
    out.push({ ...r, labels, bucket, verdict: bucket, textDerived: fromText.length ? fromText : undefined })
  }
  return { rows: out, buckets, labelCount }
}

// ---------- 复核索引导出 ----------
/**
 * JSONL → 复核页可导入的聚合 JSON。
 * 每个 target 都会出现在输出里（没判的标 pending），供复核页显示进度。
 */
export function buildReviewIndex({ allTargets, rows, keyOf, slots, models, dims = {}, speciesWithoutImages = 0, batch }) {
  const latest = new Map()
  for (const r of rows) latest.set(keyOf(r), r)

  const bySpecies = new Map()
  for (const t of allTargets) {
    if (!bySpecies.has(t.speciesId)) {
      bySpecies.set(t.speciesId, {
        speciesId: t.speciesId,
        nameZh: t.nameZh || '',
        nameSci: t.nameSci || '',
        nameEn: t.nameEn || '',
        totalImages: t.totalImages,
        images: [],
      })
    }
  }
  for (const t of allTargets) {
    const rec = bySpecies.get(t.speciesId)
    const r = latest.get(keyOf(t))
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
      verdict: r?.bucket || r?.verdict || null,
      bucket: r?.bucket || r?.verdict || null,
      labels: r?.labels || [],
      note: r?.note || '',
      model: r?.model || '',
      via: r?.via || [],
      checkedAt: r?.checkedAt || null,
      longEdge: dims[t.speciesId]?.longEdge ?? null,
    })
  }
  for (const rec of bySpecies.values()) rec.images.sort((a, b) => a.slot - b.slot)

  const verdicts = { exclude: 0, human: 0, species: 0, pass: 0, missing: 0, error: 0, pending: 0 }
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
      for (const why of im.labels) reasonCount[why] = (reasonCount[why] || 0) + 1
    }
  }

  return {
    $schema: 'uniaoer/qc@3',
    batch,
    generatedAt: new Date().toISOString(),
    base: 'https://bird.wewalk.world/media/',
    slots,
    models,
    bucketsZh: BUCKET_LABEL_ZH,
    stats: {
      species: bySpecies.size,
      images: judged + verdicts.pending,
      judged,
      verdicts,
      reasons: reasonCount,
      speciesWithoutImages,
    },
    species: [...bySpecies.values()].sort((a, b) => (a.speciesId < b.speciesId ? -1 : 1)),
  }
}
