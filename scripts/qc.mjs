/**
 * QC 统一入口 · 图片质检（只标记、不处置）
 *
 * 判定口径：`scripts/lib/qc-taxonomy.mjs`（四态 + 标签，对应 SOP §S3.1 / §S3.1a / §S3.1c）
 * 采集引擎：`scripts/lib/qc-engine.mjs`
 * 本文件只负责：批次定义、目标收集、CLI 分发。
 *
 * 批次：
 *   first      各物种首图（image-1，展示首图用途）      ≈10,883 张
 *   slots2345  各物种第 2~5 张（出题/选项用图用途）      ≈40,837 张
 *   all        上面两批合并                              ≈51,725 张
 *
 * 用法：
 *   node scripts/qc.mjs --batch first                      # 全量（断点续跑）
 *   node scripts/qc.mjs --batch first --sample 2000        # 等距抽样（校准跑）
 *   node scripts/qc.mjs --batch slots2345 --dry-run        # 只列计划
 *   node scripts/qc.mjs --batch first --rejudge <ids>      # 定点重判（忽略断点）
 *   node scripts/qc.mjs --batch first --reclassify         # 只读重分桶（0 API 成本）
 *   node scripts/qc.mjs --batch first --export             # 只读导出复核索引
 *   node scripts/qc.mjs --batch first --probe-dims         # 只读尺寸探针
 *
 * 产物（统一到 data-cache/qc/<batch>/）：
 *   latest.jsonl          断点真源（逐张追加，重跑只补缺）
 *   buckets.jsonl         重分桶结果（不动 latest）
 *   review.json           复核页可导入的聚合 JSON
 *   dims.jsonl            长边像素
 *
 * 凭证读 .env（QC_API_BASE / QC_API_KEY），不落任何输出。
 * 云端写操作：无（本脚本只读 R2 公开媒体、只写 data-cache）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadEnv,
  createConfig,
  createGate,
  createVision,
  createJudge,
  loadCheckpoint,
  readJsonl,
  runPool,
  probeDims,
  reclassifyRows,
  buildReviewIndex,
  candidatesOf,
} from './lib/qc-engine.mjs'

// ---------- 批次定义 ----------
const BATCHES = {
  first: {
    label: '首图（image-1）',
    slots: [1],
    purpose: '展示首图',
    dir: 'data-cache/qc/first',
    // 建立在 docs/103 的旧路径上，迁移期兼容读取
    legacyPaths: ['data-cache/media-qc/multimodal.jsonl'],
  },
  slots2345: {
    label: '第 2~5 张',
    slots: [2, 3, 4, 5],
    purpose: '出题/选项用图',
    dir: 'data-cache/qc/slots2345',
    legacyPaths: ['data-cache/qc-2345/multimodal-2345.jsonl'],
  },
}

// ---------- args ----------
const args = process.argv.slice(2)
const argOf = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (k) => args.includes(k)

const BATCH_ARG = argOf('--batch') || (has('--batch') ? '' : 'first')
if (!['first', 'slots2345', 'all'].includes(BATCH_ARG)) {
  console.error(`--batch 必须是 first / slots2345 / all（收到 "${BATCH_ARG}"）`)
  process.exit(1)
}
const SAMPLES = argOf('--sample') ? Number(argOf('--sample')) : 0
const LIMIT = argOf('--limit') ? Number(argOf('--limit')) : 0
const ONLY_IDS = argOf('--ids') ? new Set(argOf('--ids').split(',').map((s) => s.trim())) : null
const REJUDGE = argOf('--rejudge') ? new Set(argOf('--rejudge').split(',').map((s) => s.trim())) : null
const DRY = has('--dry-run')
const RECLASSIFY = has('--reclassify')
const EXPORT_ONLY = has('--export')
const PROBE = has('--probe-dims')
const FORCE_SLOTS = argOf('--slots')
  ? new Set(
      argOf('--slots')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    )
  : null

const BATCH_KEYS = BATCH_ARG === 'all' ? ['first', 'slots2345'] : [BATCH_ARG]

// ---------- 数据源 ----------
/** manifest-meta：物种 id → 中/英/学名（11,026 条） */
const META = {}
if (existsSync('public/data/manifest-meta.json')) {
  const mm = JSON.parse(readFileSync('public/data/manifest-meta.json', 'utf8'))
  for (const e of mm.species || []) META[e.id] = { zh: e.nameZh || '', sci: e.nameSci || '', en: e.nameEn || '' }
}

/**
 * 从 assets 分片收集目标。
 * 注意：slot 按**数组位置**取（images[slot-1]），不是硬拼 image-N 文件名——
 * 某些物种的键编号因重建/overrides 与位置不一致（见 SOP §S4.3）。
 */
function loadTargets(slots) {
  const dir = 'public/data/assets'
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
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
      for (const slot of slots) {
        const img = images[slot - 1]
        if (!img) continue // 该物种不足 slot 张
        const meta = META[speciesId] || {}
        out.push({
          speciesId,
          slot,
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

const keyOf = (t) => `${t.speciesId}#${t.slot ?? 1}`

// ---------- 单批次执行 ----------
async function runBatch(batchKey, shared) {
  const cfg = BATCHES[batchKey]
  const slots = FORCE_SLOTS ? [...FORCE_SLOTS] : cfg.slots
  const dir = cfg.dir
  mkdirSync(dir, { recursive: true })
  const paths = {
    latest: `${dir}/latest.jsonl`,
    buckets: `${dir}/buckets.jsonl`,
    review: `${dir}/review.json`,
    dims: `${dir}/dims.jsonl`,
  }

  const { out: allTargets, noImage } = loadTargets(slots)
  const bySlot = {}
  for (const t of allTargets) bySlot[t.slot] = (bySlot[t.slot] || 0) + 1

  // —— 只读：尺寸探针 ——
  if (PROBE) {
    const r = await probeDims({
      targets: allTargets,
      outPath: paths.dims,
      concurrency: Number(process.env.QC_PROBE_CONCURRENCY || 20),
      onTick: (n, total, ok, fail, ms) => console.error(`  ${n}/${total} · 成功 ${ok} 失败 ${fail} · ${Math.round(ms / 1000)}s`),
    })
    console.log(`尺寸探针完成：成功 ${r.ok} 失败 ${r.fail} → ${paths.dims}`)
    console.log(`长边分布 ${JSON.stringify(r.dist)} · 最小 ${r.min} 最大 ${r.max}`)
    return
  }

  // —— 只读：重分桶 ——
  if (RECLASSIFY) {
    const rows = readJsonl(paths.latest)
    if (!rows.length) {
      console.error('缺少', paths.latest, '—— 先跑一轮判定')
      process.exitCode = 1
      return
    }
    const r = reclassifyRows(rows, keyOf)
    writeFileSync(paths.buckets, r.rows.map((x) => JSON.stringify(x)).join('\n') + '\n')
    console.log(`[${batchKey}] 已重分桶 ${r.rows.length} 条 → ${paths.buckets}`)
    console.log('桶分布：', r.buckets)
    console.log('标签分布：', Object.entries(r.labelCount).sort((a, b) => b[1] - a[1]))
    return
  }

  // —— 只读：导出复核索引（自动先重分桶，保证口径一致） ——
  if (EXPORT_ONLY) {
    const raw = readJsonl(paths.latest)
    if (!raw.length) {
      console.error('缺少', paths.latest, '—— 先跑一轮判定')
      process.exitCode = 1
      return
    }
    const r = reclassifyRows(raw, keyOf)
    writeFileSync(paths.buckets, r.rows.map((x) => JSON.stringify(x)).join('\n') + '\n')
    const dims = {}
    for (const d of readJsonl(paths.dims)) dims[d.speciesId] = d
    const payload = buildReviewIndex({
      allTargets,
      rows: r.rows,
      keyOf,
      slots,
      models: shared ? { primary: shared.cfg.primary, secondary: shared.cfg.secondary } : { primary: 'glm-4v-flash', secondary: 'glm-4.6v' },
      dims,
      speciesWithoutImages: noImage,
      batch: batchKey,
    })
    writeFileSync(paths.review, JSON.stringify(payload))
    const v = payload.stats.verdicts
    console.log(
      `[${batchKey}] 已导出 ${paths.review}：${payload.stats.species} 种 / ${payload.stats.images} 张（已判 ${payload.stats.judged}）` +
        ` · exclude ${v.exclude} human ${v.human} species ${v.species} pass ${v.pass} missing ${v.missing} pending ${v.pending}`,
    )
    console.log(`人工复核：打开 scripts/qc-review.html，导入上面的 JSON（长边数据已内嵌）`)
    return
  }

  // —— 组装任务队列 ——
  const done = REJUDGE ? new Set() : loadCheckpoint(paths.latest, (r) => `${r.speciesId}#${r.slot ?? 1}`)
  let targets = ONLY_IDS ? allTargets.filter((t) => ONLY_IDS.has(t.speciesId)) : allTargets
  if (SAMPLES > 0) {
    const stride = Math.max(1, Math.floor(targets.length / SAMPLES))
    targets = targets.filter((_, i) => i % stride === 0)
  }
  if (REJUDGE) targets = targets.filter((t) => REJUDGE.has(t.speciesId))
  const todo = targets.filter((t) => !done.has(keyOf(t))).slice(0, LIMIT || Infinity)

  if (DRY) {
    const hours = (todo.length / (shared?.cfg.rpm || 30) / 60).toFixed(1)
    console.log(`[${batchKey}] ${cfg.label}`)
    console.log(`  候选 ${allTargets.length} 张 · slot 分布 ${JSON.stringify(bySlot)} · 无图物种 ${noImage}`)
    console.log(`  已完成 ${done.size} 张 · 待跑 ${todo.length} 张`)
    console.log(`  限速 ${shared?.cfg.rpm || 30}/分钟 → 预计 ${hours} 小时`)
    for (const t of todo.slice(0, 6)) console.log(`  ${keyOf(t)} → ${candidatesOf(t.image)[0]}`)
    if (todo.length > 6) console.log(`  … 其余 ${todo.length - 6} 张`)
    return
  }

  if (!todo.length) {
    console.log(`[${batchKey}] 没有待跑任务（已完成 ${done.size} 张）`)
    return
  }

  // —— 真跑 ——
  const { judgeOne, state } = shared
  state.rpm = state.rpm ?? cfg.rpm
  console.log(`[${batchKey}] ${cfg.label} · 待跑 ${todo.length} / 候选 ${allTargets.length} 张`)
  const t0 = Date.now()
  const n = await runPool({
    targets: todo,
    judgeOne,
    concurrency: shared.cfg.concurrency,
    outPath: paths.latest,
    state,
    onProgress: (done_, st) => {
      const el = Math.round((Date.now() - t0) / 1000)
      const eta = done_ ? Math.round((el / done_) * (todo.length - done_)) : 0
      const c = st.counts
      console.error(
        `[${done_}/${todo.length}] exclude=${c.exclude || 0} human=${c.human || 0} species=${c.species || 0} pass=${c.pass || 0} missing=${c.missing || 0} · ${el}s · ETA ${eta}s`,
      )
    },
  })

  const c = state.counts
  console.log(
    `\n[${batchKey}] 完成 ${n} 张：exclude=${c.exclude || 0} human=${c.human || 0} species=${c.species || 0} pass=${c.pass || 0} missing=${c.missing || 0}` +
      ` · 复判调用 ${state.secondaryCalls} 次 · 模型分布 ${JSON.stringify(state.byModel)} → ${paths.latest}`,
  )

  if (state.authFailed) {
    console.error(`\n🛑 凭证失效，已停止：${state.authFailed}`)
    console.error('   检查 .env 的 QC_API_KEY（智谱控制台确认 key）。断点已存，换 key 后重跑同一命令即续。')
    process.exitCode = 3
    return
  }
  if (state.flashExhausted && n < todo.length) {
    console.error(`\n🛑 主判模型限流/额度耗尽，安全停止。已完成 ${n}/${todo.length}，断点已存，稍后重跑即续。`)
    process.exitCode = 2
    return
  }

  // 跑完自动导出，省一步
  const r = reclassifyRows(readJsonl(paths.latest), keyOf)
  writeFileSync(paths.buckets, r.rows.map((x) => JSON.stringify(x)).join('\n') + '\n')
  console.log(`已自动重分桶 → ${paths.buckets} · ${JSON.stringify(r.buckets)}`)
  console.log(`下一步：node scripts/qc.mjs --batch ${batchKey} --export`)
}

// ---------- 主流程 ----------
const onlyRead = RECLASSIFY || EXPORT_ONLY || PROBE || DRY

// 只读模式不需要 key；真跑才建引擎
let shared = null
if (!onlyRead) {
  const env = loadEnv()
  const cfg = createConfig(env)
  if (!cfg.key) {
    console.error('缺少 QC_API_KEY（.env）')
    process.exit(1)
  }
  const state = {
    flashExhausted: false,
    secondaryExhausted: false,
    authFailed: '',
    secondaryCalls: 0,
    byModel: {},
    counts: {},
    done: 0,
    rpm: cfg.rpm,
    rpmFallback: cfg.rpmFallback,
  }
  const gate = createGate(() => state.rpm)
  const vision = createVision(cfg)
  // 两个批次的 purpose 不同，各自建一个 judge
  const judges = {}
  shared = {
    cfg,
    gate,
    state,
    judgeFor: (batchKey) => {
      if (!judges[batchKey]) judges[batchKey] = createJudge({ vision, gate, state, purpose: BATCHES[batchKey].purpose })
      return judges[batchKey]
    },
  }
}

// 每个批次的 judgeOne 依赖 purpose，所以逐批跑时再挂
for (const batchKey of BATCH_KEYS) {
  const s = shared
    ? { ...shared, judgeOne: shared.judgeFor(batchKey) }
    : createDryShared(batchKey)
  await runBatch(batchKey, s)
}

function createDryShared(batchKey) {
  // 只读模式下 runBatch 用不到 judge；给个够用的 cfg 供 --dry-run 估算
  const env = existsSync('.env') ? loadEnv() : {}
  const cfg = createConfig(env)
  return {
    cfg,
    gate: async () => {},
    judgeOne: async () => ({ aborted: true }),
    state: { flashExhausted: false, secondaryExhausted: false, authFailed: '', secondaryCalls: 0, byModel: {}, counts: {}, done: 0, rpm: cfg.rpm },
    judgeFor: () => async () => ({ aborted: true }),
    batchKey,
  }
}
