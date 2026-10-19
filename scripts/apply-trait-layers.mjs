#!/usr/bin/env node
/**
 * 053-describe §11 ②：把 4 个结构化性状产物合并成「核心层注入表」+「详情层分片」。
 *
 * 输入（都是已生成的产物，本脚本**不联网**）：
 *   data/iucn-habitats.json       IUCN v4 结构化生境   → 产物含 source{license,citation}
 *   data/avonet-traits.json       AVONET 形态/生态      → CC BY 4.0
 *   data/elton-traits.json        EltonTraits 习性
 *   data/plumage-colours.json     Dunning 羽色          → CC0-1.0
 *   data/iucn-habitat-codes.json  code → 中文码表
 *
 * 输出：
 *   data-cache/trait-core.json      **核心层注入表**（派生中间物，供 build-manifest-layers 合进
 *                                    species[].profile；**故意放 data-cache** —— 它可由上面 4 个产物
 *                                    完全重算，进 git 只会多一份要同步的 1.2 MB）
 *     { schemaVersion, generatedAt, tagCap, counts, byTaxonKey: { k: { habitatCodes[], hasTraits{} } } }
 *   public/data/traits/index.json   详情层桶索引（只列实际存在的桶）
 *   public/data/traits/<桶>.json    详情层分片：diet / foraging / nocturnal / morph / eco / plumage / habitats
 *
 * ⚠️ **分片为什么不入库**：`public/data/traits/` 已加 .gitignore，改由
 *   `npm run build` 里的 `traits:layers` 步骤在**构建期生成**（vite 会把 public/ 拷进 dist）。
 *   13 MB 的派生视图与 4 个源产物一一对应，入库等于多一份要同步的大文件；
 *   真正入库的是**源产物**（4 个，各带许可与引用，check:traits 校验）。
 *
 * ⚠️ 为什么核心层走「注入表」而不是直接改 manifest：
 *   `build-manifest-layers.mjs` 是 053 媒体采集同一条链上的文件（061 §6 的串行约束），
 *   本窗口**不碰**它。先产出独立的注入表，等 053 窗口再让构建脚本读它 —— 这样
 *   本脚本现在就能跑、能自检、能反复重算，且不会造成「骨架/名录改了、manifest 没改」的半途状态。
 *
 * 口径（与 docs/053-describe §11.2/§11.5b 一致）：
 *  · 核心层只放**生境 code**（如 ["14_5","14_4"]）+ 有无数据的布尔标记，**不放中文串、不放数值**：
 *    中文由前端查 `public/data/iucn-habitat-codes.json`（99 条 ≈ 10 KB），
 *    这样「译法迭代」不必重建 4 MB 的 manifest-meta，注入表也能压到 ~300 KB（实测中文串版是 1.2 MB）；
 *  · 标签排序：`major=true` 优先 → 物种出现频次高的在前（用 code 在 habitatCodes 里的 species 计数）→ 去重 → 截断到 tagCap（默认 6）；
 *  · 详情层 habitats 只放 code + 季节 + major，**中文由前端查码表**（产物不放译名）；
 *  · 缺就缺（`plumage: null`），**不猜、不补**；
 *  · AVONET 的 `inferred` 必须透传（UI 要区别标注插值性状）。
 *
 * CLI：npm run traits:layers [-- --tag-cap 6] [-- --out-core …] [-- --out-dir …]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const TAG_CAP = args['tag-cap'] ? Number(args['tag-cap']) : 6
const OUT_CORE = path.resolve(ROOT, String(args['out-core'] || 'data-cache/trait-core.json'))
const OUT_DIR = path.resolve(ROOT, String(args['out-dir'] || 'public/data/traits'))
/** 前端查表用：把 data/ 下的码表复制到 public/data（构建期产物，提交物） */
const PUBLIC_CODES = path.join(ROOT, 'public/data/iucn-habitat-codes.json')

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

/** 分片桶：按学名首字符（与 manifest `assets/*` 的分桶思路一致，纯 ASCII 好排错） */
const bucketOf = (nameSci) => {
  const ch = String(nameSci || '').trim().charAt(0).toLowerCase()
  return /[a-z]/.test(ch) ? ch : '0'
}

async function main() {
  const read = async (rel, required) => {
    const p = path.join(ROOT, rel)
    try {
      return await readJson(p)
    } catch (e) {
      if (required) throw new Error(`读不到 ${rel}（先跑对应 npm run taxonomy:* ）：${e.message}`)
      console.warn(`  ⚠️ 跳过 ${rel}（${e.message}）`)
      return null
    }
  }

  const codeTable = await read('data/iucn-habitat-codes.json', true)
  await fs.mkdir(path.dirname(PUBLIC_CODES), { recursive: true })
  await fs.writeFile(PUBLIC_CODES, JSON.stringify(codeTable) + '\n')
  const iucn = await read('data/iucn-habitats.json', false)
  const avonet = await read('data/avonet-traits.json', false)
  const elton = await read('data/elton-traits.json', false)
  const plumage = await read('data/plumage-colours.json', false)

  const sources = []
  for (const [name, data] of [
    ['iucn', iucn],
    ['avonet', avonet],
    ['elton', elton],
    ['plumage', plumage],
  ]) {
    if (data?.source) sources.push({ key: name, ...data.source })
  }
  if (!sources.length) throw new Error('四个产物都没读到，无法合并')

  // code → 中文（构建期取一次，供标签用；产物本身不带译名）
  const codeZh = new Map()
  for (const [code, v] of Object.entries(codeTable.codes || {})) {
    codeZh.set(code, { zh: v.zh, short: v.zhShort || v.zh })
  }
  // code 的物种出现频次（用于标签排序：越常见越靠前）
  const codeFreq = new Map()
  for (const c of iucn?.habitatCodes || []) codeFreq.set(c.code, c.species || 0)

  // 064：叙述文本（确定性合成，`data/field-marks.json`）。可选 —— 缺失时只输出结构化数据。
  let fieldMarks = null
  try {
    fieldMarks = JSON.parse(await fs.readFile(path.join(ROOT, 'data/field-marks.json'), 'utf8'))
  } catch {
    fieldMarks = null
  }
  const textEngine = fieldMarks?.engine || null

  /** 同一 taxonKey 的四源合并 */
  const allKeys = new Set([
    ...Object.keys(iucn?.byTaxonKey || {}),
    ...Object.keys(avonet?.byTaxonKey || {}),
    ...Object.keys(elton?.byTaxonKey || {}),
    ...Object.keys(plumage?.byTaxonKey || {}),
  ])

  const core = {}
  const details = {}
  const stats = {
    total: allKeys.size,
    habitat: 0,
    diet: 0,
    morph: 0,
    plumage: 0,
    droppedTagUnknownCode: 0,
    noCodeTableEntry: 0,
  }

  for (const key of allKeys) {
    const hi = iucn?.byTaxonKey?.[key] || null
    const av = avonet?.byTaxonKey?.[key] || null
    const el = elton?.byTaxonKey?.[key] || null
    const pl = plumage?.byTaxonKey?.[key] || null
    const nameSci = hi?.nameSci || av?.nameSci || el?.nameSci || pl?.nameSci || null
    if (!nameSci) continue

    // ── 核心层：生境 code（major 优先 → 频次高优先 → 去重 → 截断）
    //    放 code 不放中文：译法改动不必重建 manifest（见头注）
    let habitatCodes = []
    if (hi?.habitats?.length) {
      const sorted = [...hi.habitats].sort((a, b) => {
        if (a.major !== b.major) return a.major ? -1 : 1
        return (codeFreq.get(b.code) || 0) - (codeFreq.get(a.code) || 0)
      })
      for (const h of sorted) {
        if (!codeZh.has(h.code)) {
          // 码表查不到 → 门禁应当已报；这里**跳过而不是塞原文**，保证前端永远查得到中文
          stats.droppedTagUnknownCode++
          continue
        }
        if (!habitatCodes.includes(h.code)) habitatCodes.push(h.code)
        if (habitatCodes.length >= TAG_CAP) break
      }
      if (habitatCodes.length) stats.habitat++
    }

    const hasDiet = Boolean(el && (el.diet || el.foraging))
    const hasMorph = Boolean(av && Object.keys(av.morph || {}).length)
    const hasPlumage = Boolean(pl && Object.keys(pl.colours || {}).length)
    if (hasDiet) stats.diet++
    if (hasMorph) stats.morph++
    if (hasPlumage) stats.plumage++

    core[key] = {
      habitatCodes,
      hasTraits: { diet: hasDiet, morph: hasMorph, plumage: hasPlumage },
    }

    // ── 详情层（habitats 只放 code + 季节 + major，中文留给前端查表）
    const detail = {}
    if (hi?.habitats?.length) {
      detail.habitats = hi.habitats.map((h) => ({ code: h.code, major: h.major, seasons: h.seasons }))
      detail.systems = hi.systems || []
      detail.assessmentId = hi.assessmentId
      detail.category = hi.category
    }
    if (hasDiet) {
      detail.diet = el.diet
      detail.dietSum = el.dietSum
      detail.foraging = el.foraging
      detail.nocturnal = el.nocturnal
      detail.dietMatchedBy = el.matchedBy
      detail.dietSpecLevel = el.specLevel
    }
    if (hasMorph) {
      detail.morph = { ...av.morph, inferred: Boolean(av.flags?.inferred) }
      detail.eco = av.eco
      detail.morphAvonetName = av.avonetName
      detail.morphMatchedBy = av.matchedBy
    }
    if (hasPlumage) {
      detail.plumage = {
        colours: pl.colours,
        colourDiversity: pl.colourDiversity,
        dichromatism: pl.dichromatism,
        breeding: pl.breeding,
      }
    }
    if (Object.keys(detail).length === 0) continue
    // 064：叙述文本（「结构化事实 → 只做措辞」；来源与引擎见 textSources）
    const fm = fieldMarks?.byTaxonKey?.[key]
    if (fm?.zh) {
      detail.text = { zh: fm.zh, basedOn: fm.basedOn || [], textSources: fm.textSources || [] }
    }
    detail.nameSci = nameSci
    details[key] = detail
  }

  // ── 详情层分片
  await fs.mkdir(OUT_DIR, { recursive: true })
  // 先清掉旧分片：避免桶方案变化后旧 xxx.json 仍被 Vite 拷进 dist（新旧并存）
  for (const f of await fs.readdir(OUT_DIR).catch(() => [])) {
    if (f.endsWith('.json')) await fs.rm(path.join(OUT_DIR, f), { force: true })
  }
  // 桶 → 条目；单桶超过 SHARD_MAX_BYTES 就按「前两个字母」再切一层（p→pa/pb…）
  const SHARD_MAX_BYTES = 400_000 // 留足余量：目标 < 600 KB 实际文件
  const oneChar = {}
  for (const [key, detail] of Object.entries(details)) {
    ;(oneChar[bucketOf(detail.nameSci)] ||= {})[key] = detail
  }
  const buckets = {}
  for (const [bucket, entries] of Object.entries(oneChar)) {
    const size = Buffer.byteLength(JSON.stringify({ sources, byTaxonKey: entries }))
    if (size <= SHARD_MAX_BYTES) {
      buckets[bucket] = entries
      continue
    }
    // 超阈值 → 按学名前两个字母细分
    const sub = {}
    for (const [key, detail] of Object.entries(entries)) {
      const name = String(detail.nameSci || '').toLowerCase()
      const s = /^([a-z]{2})/.test(name) ? name.slice(0, 2) : `${bucket}0`
      ;(sub[s] ||= {})[key] = detail
    }
    for (const [s, e] of Object.entries(sub)) buckets[s] = e
  }
  const bucketIndex = {}
  let written = 0
  let biggestBytes = 0
  for (const [bucket, entries] of Object.entries(buckets).sort()) {
    const file = path.join(OUT_DIR, `${bucket}.json`)
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sources,
      textEngine,
      note:
        '详情层分片：diet/foraging/nocturnal（EltonTraits）· morph/eco（AVONET，inferred 标记插值）· ' +
        'plumage（Dunning CC0）· habitats（IUCN，仅 code+季节+major，**中文请查 iucn-habitat-codes.json**）。' +
        'morph.massG 单位克，diet 单位百分比。缺字段即无数据，不要猜。' +
        'text.zh 为 064 自动合成的叙述（非权威，仅供参考，欢迎纠错）。',
      counts: { entries: Object.keys(entries).length },
      byTaxonKey: entries,
    }
    const text = JSON.stringify(payload) + '\n'
    await fs.writeFile(file, text)
    bucketIndex[bucket] = Object.keys(entries).length
    written += Object.keys(entries).length
    if (Buffer.byteLength(text) > biggestBytes) biggestBytes = Buffer.byteLength(text)
  }
  await fs.writeFile(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        note: '详情层桶索引：只列实际存在的桶。分片按学名首字符分。',
        sources,
        counts: { buckets: Object.keys(bucketIndex).length, entries: written },
        buckets: bucketIndex,
      },
      null,
      2,
    ) + '\n',
  )

  // ── 核心层注入表
  const corePayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note:
      '核心层注入表（供 build-manifest-layers 合进 species[].profile）：habitatCodes 是生境编码' +
      '（如 14_5 = 城镇；中文由前端查 public/data/iucn-habitat-codes.json），hasTraits 是各详情层的可用性标记。' +
      '**不放中文串、不放数值** —— 那些在 public/data/traits/<桶>.json 里懒加载。',
    tagCap: TAG_CAP,
    sources,
    counts: stats,
    byTaxonKey: core,
  }
  await fs.mkdir(path.dirname(OUT_CORE), { recursive: true })
  await fs.writeFile(OUT_CORE, JSON.stringify(corePayload) + '\n')

  console.log(`✅ 核心层注入表 ${path.relative(ROOT, OUT_CORE)}`)
  console.log(
    `   覆盖 ${stats.total} 种：生境 ${stats.habitat} · 食性 ${stats.diet} · 形态 ${stats.morph} · 羽色 ${stats.plumage}` +
      `（生境 code 上限 ${TAG_CAP}；码表查不到而跳过的 code ${stats.droppedTagUnknownCode} 个）`,
  )
  console.log(`✅ 详情层分片 ${written} 条 / ${Object.keys(bucketIndex).length} 桶 → ${path.relative(ROOT, OUT_DIR)}/<桶>.json`)
  const biggest = Object.entries(bucketIndex).sort((a, b) => b[1] - a[1])[0]
  if (biggest) {
    console.log(`   条目最多的桶 ${biggest[0]}.json：${biggest[1]} 条`)
    console.log(`   单文件最大 ${(biggestBytes / 1024).toFixed(0)} KB（阈值 ${SHARD_MAX_BYTES / 1024} KB）`)
  }
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
