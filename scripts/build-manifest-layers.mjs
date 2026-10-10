#!/usr/bin/env node
/**
 * 029 M1:manifest 分层产物构建(独立命令)——由完整 manifest 派生三层产物:
 *   public/data/manifest-core.json        启动层(名录 + 首图首音;前端 loadBank 只取这份)
 *   public/data/assets/<bucket>.json      详情层分片(完整素材 + notes/profile;按 id 前两位,大桶自动拆)
 *   public/data/manifest-global.min.json  全球池(核心同构,懒加载)
 *
 * 完整层 public/data/manifest.json 仍是构建真源(不修改);本脚本可反复运行(幂等)。
 * 采集收尾(build-bank)也会调用同一实现,保证产物始终与 manifest 同步。
 *
 * 用法:
 *   npm run layers                 # 由 public/data/manifest.json 产三层
 *   npm run check:layers           # 校验三层与完整层一致(见 scripts/check-manifest-layers.mjs)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCore, toAssetBuckets, toGlobalPool, toMeta, splitLargeBuckets } from './lib/manifest-layers.mjs'
import { loadGbifUsageKeys } from './lib/gbif-keys.mjs'
import { buildClassTable } from './lib/class-taxonomy.mjs'
import { pinyinKey } from './lib/pinyin-key.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 原子写(tmp + rename):防中断产生半截 JSON(与 build-bank 同规)。 */
async function writeJsonAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, file)
}

/**
 * 46 目的中文名（AviList 目级名，用于 /catalog 目录显示；无条目时回退只显示拉丁名）。
 */
const ORDER_ZH = {
  Struthioniformes: '鸵鸟目',
  Casuariiformes: '鹤鸵目',
  Apterygiformes: '无翼鸟目',
  Rheiformes: '美洲鸵目',
  Tinamiformes: '䳍形目',
  Anseriformes: '雁形目',
  Galliformes: '鸡形目',
  Phoenicopteriformes: '红鹳目',
  Podicipediformes: '䴙䴘目',
  Musophagiformes: '蕉鹃目',
  Otidiformes: '鸨形目',
  Cuculiformes: '鹃形目',
  Mesitornithiformes: '拟鹑目',
  Pterocliformes: '沙鸡目',
  Columbiformes: '鸽形目',
  Opisthocomiformes: '麝雉目',
  Gruiformes: '鹤形目',
  Charadriiformes: '鸻形目',
  Eurypygiformes: '日鳽目',
  Phaethontiformes: '鹲形目',
  Gaviiformes: '潜鸟目',
  Sphenisciformes: '企鹅目',
  Procellariiformes: '鹱形目',
  Ciconiiformes: '鹳形目',
  Suliformes: '鲣鸟目',
  Pelecaniformes: '鹈形目',
  Caprimulgiformes: '夜鹰目',
  Steatornithiformes: '油鸱目',
  Nyctibiiformes: '林鸱目',
  Podargiformes: '蟆口鸱目',
  Aegotheliformes: '裸鼻鸱目',
  Apodiformes: '雨燕目',
  Strigiformes: '鸮形目',
  Cathartiformes: '美洲鹫目',
  Accipitriformes: '鹰形目',
  Coliiformes: '鼠鸟目',
  Leptosomiformes: '鹃鴗目',
  Trogoniformes: '咬鹃目',
  Bucerotiformes: '犀鸟目',
  Coraciiformes: '佛法僧目',
  Galbuliformes: '鹟䴕目',
  Piciformes: '䴕形目',
  Cariamiformes: '叫鹤目',
  Falconiformes: '隼形目',
  Psittaciformes: '鹦形目',
  Passeriformes: '雀形目',
}

/**
 * 029 数据透明度:构建全量目录（/catalog 页懒加载）。
 * 按 AviList 目顺序 → 科（拉丁名，字母序）→ 种（学名字母序）；
 * 物种条目带学名/英文名/中文名（有则给）与图/音标记（extinct 仅标记为 true）。
 *
 * 031 D-031-2:另带两个**构建期预计算**的排序键,前端排序零运行时成本:
 *   cm 常见度档位(1 最常见 … 5 稀有;无值时省略,前端排末位)
 *   py 中文名拼音键(纯 a-z;无中文名/读音时省略,前端回退英文名再学名)
 * 由 unknownPy 回调统计拼音库未收录的字,供构建日志发现新增脏数据。
 */
function buildCatalog(poolEntries, idx) {
  const unknownPy = new Map()
  const onUnknown = (chars) => chars.forEach((ch) => unknownPy.set(ch, (unknownPy.get(ch) || 0) + 1))
  /** 无值返回 undefined(JSON 中省略键),避免 catalog 里塞满 null */
  const optInt = (v) => (Number.isInteger(v) ? v : undefined)
  const byKey = new Map()
  for (const sp of poolEntries) {
    if (!sp.taxonKey) continue
    if (!byKey.has(sp.taxonKey)) byKey.set(sp.taxonKey, [])
    byKey.get(sp.taxonKey).push(sp)
  }
  const orders = []
  const orderMap = new Map()
  const seen = new Set()
  function addEntry(sp, e) {
    const orderSci = e?.order || 'Incertae sedis'
    const familySci = e?.family || sp.family || '—'
    let o = orderMap.get(orderSci)
    if (!o) {
      o = { sci: orderSci, zh: ORDER_ZH[orderSci], families: [], _fm: new Map() }
      orderMap.set(orderSci, o)
      orders.push(o)
    }
    let f = o._fm.get(familySci)
    if (!f) {
      f = { sci: familySci, species: [] }
      o._fm.set(familySci, f)
      o.families.push(f)
    }
    const rec = { id: sp.id, sci: sp.nameSci, image: !!sp.image, audio: !!sp.audio }
    if (sp.nameEn) rec.en = sp.nameEn
    if (sp.nameZh) {
      rec.zh = sp.nameZh
      const py = pinyinKey(sp.nameZh, onUnknown)
      if (py) rec.py = py
    }
    const cm = optInt(sp.commonness)
    if (cm) rec.cm = cm
    if (e?.extinct) rec.extinct = true
    f.species.push(rec)
  }
  // 按骨架顺序遍历（目序 = AviList 顺序）；同概念多条目（概念合并别名）保持并列
  for (const e of idx.species) {
    for (const sp of byKey.get(e.taxonKey) ?? []) {
      addEntry(sp, e)
      seen.add(sp.id)
    }
  }
  for (const sp of poolEntries) {
    if (!seen.has(sp.id)) addEntry(sp, null) // 兜底：骨架未命中的池条目
  }
  let familyCount = 0
  for (const o of orders) {
    delete o._fm
    o.families.sort((a, b) => a.sci.localeCompare(b.sci))
    for (const f of o.families) {
      f.species.sort((a, b) => a.sci.localeCompare(b.sci))
      familyCount++
    }
  }
  const withImage = poolEntries.filter((s) => s.image).length
  const withAudio = poolEntries.filter((s) => s.audio).length
  const pinyin = {
    keys: orders.reduce(
      (n, o) => n + o.families.reduce((m, f) => m + f.species.filter((s) => s.py).length, 0),
      0,
    ),
    zh: poolEntries.filter((s) => s.nameZh).length,
    unknownChars: [...unknownPy.keys()].join(''),
  }
  return {
    catalog: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      counts: {
        total: poolEntries.length,
        withImage,
        withAudio,
        orders: orders.length,
        families: familyCount,
      },
      orders,
    },
    pinyin,
  }
}

/**
 * 写三层产物。返回统计(供 build-bank / CLI 打印)。
 * @param {{dataDir?:string, globalLedger?:string, quiet?:boolean}} opts
 */
export async function writeManifestLayers(manifest, opts = {}) {
  const dataDir = opts.dataDir || path.join(ROOT, 'public/data')
  // 050 R1：台账已移入 data-cache/（不入库）；缺失时全球池保持现状不报错
  const globalLedger = opts.globalLedger || path.join(ROOT, 'data-cache/manifest-global.json')
  const quiet = !!opts.quiet
  /** 附注统计(commonness 合并数等),随 stats 返回 */
  const stats_note = {}

  const core = toCore(manifest)
  // 全球采集台账（raw，含 1+1 素材）；S6 起 assets 分片要覆盖**全量可玩种**。
  let rawLedger = null
  try {
    rawLedger = JSON.parse(await fs.readFile(globalLedger, 'utf8'))
  } catch {
    rawLedger = null // 无台账：分片仅覆盖 core（旧行为，不报错）
  }
  // S6：assets 覆盖 core（5+5）+ 全球台账（1+1）的并集 →
  // 前端只需 meta（名单）+ assets（媒体）即可出题，不再 core+global 拼接。
  const assetSource = { species: [...(manifest.species || []), ...(rawLedger?.species || [])] }
  const buckets = splitLargeBuckets(toAssetBuckets(assetSource))
  const bucketNames = Object.keys(buckets).sort()
  core.buckets = bucketNames // 以实际分片为准(大桶拆分后桶名可能与首字母不同)
  const coreText = JSON.stringify(core)
  await writeJsonAtomic(path.join(dataDir, 'manifest-core.json'), coreText)

  const assetsDir = path.join(dataDir, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })
  // 清理过期分片(桶名随拆分策略变化,旧文件留着会被误读)
  const existing = (await fs.readdir(assetsDir).catch(() => [])).filter((f) => f.endsWith('.json'))
  const keep = new Set(bucketNames.map((n) => `${n}.json`))
  for (const f of existing) {
    if (!keep.has(f)) await fs.rm(path.join(assetsDir, f), { force: true })
  }
  let bucketBytes = 0
  let maxBucket = { name: '', bytes: 0 }
  for (const name of bucketNames) {
    const text = JSON.stringify({ layer: 'assets', bucket: name, species: buckets[name] })
    await writeJsonAtomic(path.join(assetsDir, `${name}.json`), text)
    bucketBytes += Buffer.byteLength(text)
    if (text.length > maxBucket.bytes) maxBucket = { name, bytes: text.length }
  }

  let global = null
  try {
    if (!rawLedger) throw new Error('无台账')
    global = toGlobalPool(rawLedger)
    // 029 M2:全球池的 commonness 用骨架合成值覆盖台账占位值(台账采集期统一填 2)。
    // 按 nameSci 精确联表(骨架 11,131 种全覆盖,含台账全部物种)。
    try {
      const idx = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
      const byName = new Map(idx.species.map((s) => [s.nameSci, s]))
      let merged = 0
      for (const sp of global.species) {
        const e = byName.get(sp.nameSci)
        if (e && Number.isInteger(e.commonness)) {
          sp.commonness = e.commonness
          merged++
        }
      }
      stats_note.commonness = merged
    } catch {
      stats_note.commonness = 0
    }
    await writeJsonAtomic(path.join(dataDir, 'manifest-global.min.json'), JSON.stringify(global))
  } catch {
    global = null // 无台账:跳过(不报错)
  }

  // 050 P1：权威名录层（10,844 种 × 全字段，不含媒体）。
  // 台账缺失时用 core + 现有 global.min 兜底，保证 meta 永远是「当前可玩全集」。
  let metaBytes = 0
  let metaTotal = 0
  try {
    const idx = JSON.parse(await fs.readFile(path.join(dataDir, 'species-index.json'), 'utf8'))
    const orderOfBySci = new Map(idx.species.map((e) => [e.nameSci, e.order]))
    const orderOfByKey = new Map(idx.species.map((e) => [e.taxonKey, e.order]).filter(([k]) => k))
    const orderOf = { get: (k) => orderOfByKey.get(k) || orderOfBySci.get(k) }
    let ledger = global ? JSON.parse(JSON.stringify(global)) : { species: [] }
    if (rawLedger) ledger = rawLedger
    // 050 P3：GBIF usageKey 缓存（离线；缺失时只是不填 taxonId，不报错）
    const usageKeys = await loadGbifUsageKeys()
    // 051 S2：生活型台账（data/class-records.json；缺失/为空 → 全部物种不挂 group6，UI 不显示）
    let classTable = null
    try {
      const doc = JSON.parse(
        await fs.readFile(path.join(ROOT, 'data/class-records.json'), 'utf8'),
      )
      classTable = buildClassTable(doc.records || [])
    } catch {
      classTable = null
    }
    const meta = toMeta(manifest, ledger, orderOf, usageKeys, classTable)
    // S6：把 assets 最终分片清单挂到 meta —— 前端只用 meta（名单 + 分片索引）
    // + assets（媒体）即可解析全量物种的媒体，无需 core/global 的 buckets。
    meta.buckets = bucketNames
    // S6：全量可玩口径（不再区分 core/global；FAQ / 首页统计用）
    const withImg = meta.species.filter((s) => s.playableImage === true).length
    const withAud = meta.species.filter((s) => s.playableAudio === true).length
    const uniqueConcepts = new Set(meta.species.map((s) => s.taxonKey).filter(Boolean)).size
    meta.universe = {
      total: meta.total,
      withImage: withImg,
      withAudio: withAud,
      imageOnly: meta.species.filter((s) => s.playableImage === true && s.playableAudio !== true).length,
      audioOnly: meta.species.filter((s) => s.playableAudio === true && s.playableImage !== true).length,
      withNameZh: meta.species.filter((s) => s.nameZh).length,
      notCovered: Math.max(0, idx.species.length - uniqueConcepts),
    }
    metaBytes = Buffer.byteLength(JSON.stringify(meta))
    metaTotal = meta.total
    stats_note.meta = meta.stats
    await writeJsonAtomic(path.join(dataDir, 'manifest-meta.json'), JSON.stringify(meta))
  } catch (e) {
    if (!quiet) console.warn(`⚠ 权威名录层 meta 跳过：${e.message}`)
  }

  // 统计与全量目录：依赖 species-index（order/family/extinct）；缺失则跳过(不阻塞分层产物)。
  // 统计烘焙进 core（首页/答疑页展示),避免前端为显示数字多拉 10MB 全球池。
  let catalogBytes = 0
  let catalogTotal = 0
  try {
    const idx = JSON.parse(await fs.readFile(path.join(dataDir, 'species-index.json'), 'utf8'))
    const poolEntries = [...core.species, ...(global ? global.species : [])]
    const uniqueConcepts = new Set(poolEntries.map((s) => s.taxonKey).filter(Boolean)).size
    core.universe = {
      coreTotal: core.species.length,
      globalTotal: global ? global.species.length : 0,
      total: poolEntries.length,
      withImage: poolEntries.filter((s) => s.image).length,
      withAudio: poolEntries.filter((s) => s.audio).length,
      imageOnly: poolEntries.filter((s) => s.image && !s.audio).length,
      audioOnly: poolEntries.filter((s) => !s.image && s.audio).length,
      withNameZh: poolEntries.filter((s) => s.nameZh).length,
      notCovered: Math.max(0, idx.species.length - uniqueConcepts),
    }
    await writeJsonAtomic(path.join(dataDir, 'manifest-core.json'), JSON.stringify(core))

    const { catalog, pinyin } = buildCatalog(poolEntries, idx)
    const text = JSON.stringify(catalog)
    await writeJsonAtomic(path.join(dataDir, 'catalog.json'), text)
    catalogBytes = Buffer.byteLength(text)
    catalogTotal = catalog.counts.total
    stats_note.catalog = catalogTotal
    stats_note.pinyin = pinyin
  } catch (e) {
    if (!quiet) console.warn(`⚠ 目录/统计产物跳过：${e.message}`)
  }

  const stats = {
    coreBytes: Buffer.byteLength(JSON.stringify(core)),
    coreTotal: core.total,
    buckets: bucketNames.length,
    bucketBytes,
    maxBucket,
    globalBytes: global ? Buffer.byteLength(JSON.stringify(global)) : 0,
    globalTotal: global ? global.total : 0,
    globalCommonnessMerged: stats_note.commonness || 0,
    catalogBytes,
    catalogTotal,
    metaBytes,
    metaTotal,
  }
  if (!quiet) {
    const MB = (b) => `${(b / 1e6).toFixed(2)}MB`
    console.log(
      `分层产物:core ${MB(stats.coreBytes)}(${stats.coreTotal} 种,${stats.buckets} 桶) · assets ${MB(stats.bucketBytes)}(最大桶 ${stats.maxBucket.name} ${(stats.maxBucket.bytes / 1024).toFixed(0)}KB)` +
        (global
          ? ` · global.min ${MB(stats.globalBytes)}(${stats.globalTotal} 种,commonness 联表 ${stats.globalCommonnessMerged})`
          : ' · 无全球台账,global.min 跳过') +
        (stats.catalogTotal ? ` · catalog ${MB(stats.catalogBytes)}(${stats.catalogTotal} 种)` : '') +
        (stats.metaTotal ? ` · meta ${MB(stats.metaBytes)}(${stats.metaTotal} 种)` : ''),
    )
    if (stats_note.meta) {
      const m = stats_note.meta
      console.log(
        `  权威层:来自核心库 ${m.fromCore} 种 · 补齐 ${m.enriched} 种 · 有中文名 ${m.withNameZh} · 有 profile ${m.withProfile}` +
          ` · 有 taxonId ${m.withTaxonId}（本次回填 ${m.taxonFilled}）` +
          ` · 类群 水鸟 ${m.groups.waterbird}/猛禽 ${m.groups.raptor}/林鸟 ${m.groups.landbird}（留空 ${m.groupBlank}，无依据不填）` +
          ` · 生活型六分 ${m.classCovered} 种（出处记录 ${m.classRecords} 条）` +
          (m.skippedNoMedia ? ` · 无媒体未入层 ${m.skippedNoMedia}` : ''),
      )
    }
    const py = stats_note.pinyin
    if (py) {
      console.log(
        `  名录拼音键:${py.keys}/${py.zh} 个中文名已转写` +
          (py.unknownChars ? ` · ⚠ 未收录字:「${py.unknownChars}」(见 scripts/lib/pinyin-key.mjs CHAR_OVERRIDES)` : ''),
      )
    }
  }
  return stats
}

/** CLI 入口(直接运行时) */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const manifestPath = path.join(ROOT, 'public/data/manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    console.log(`读 ${path.relative(ROOT, manifestPath)}(${manifest.species?.length || 0} 种)`)
    const stats = await writeManifestLayers(manifest)
    if (stats.maxBucket.bytes > 400_000) {
      console.warn(`⚠ 最大桶 ${stats.maxBucket.name} 超 400KB DoD 线(检查拆分策略)`)
    }
  } catch (e) {
    console.error(`✗ build-manifest-layers:${e.message}`)
    process.exit(1)
  }
}
