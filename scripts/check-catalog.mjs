#!/usr/bin/env node
/**
 * 041 A1：/catalog 名录产物（public/data/catalog.json）校验（纯本地，不联网）。
 *
 * 为什么需要它：catalog.json 已是**用户可见产物**（1.5MB 懒加载，/catalog 页直接渲染），
 * 由 `npm run layers`（writeManifestLayers）从 manifest-core + manifest-global + species-index 派生；
 * 一旦派生逻辑或上游产物漂移（少种、图标错、排序键失效、分类错位），页面会静默出错。
 * 本脚本把「结构 / 计数 / 与 manifest 一致 / 与骨架一致 / 排序键可复算 / 体积」全部钉死。
 *
 * 校验链：
 *   catalog.json
 *     ├─ 结构：目→科→种 层级、字段类型、id 唯一、科内/目内排序确定性
 *     ├─ counts 自洽（total/withImage/withAudio/orders/families）
 *     ├─ 与 manifest-core + manifest-global.min 一致：id 集合、图/音标记、学名/中英文名
 *     ├─ 与 species-index 一致：目/科归属、extinct、常见度（overrides 豁免）、目序为骨架序子序列
 *     └─ 拼音键：pinyinKey(zh) 可复算（含空键=脏数据 zh 的显式放行）
 * 用法：npm run check:catalog [-- --data public/data]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'
import { pinyinKey } from './lib/pinyin-key.mjs'
import { normalizeSciName } from './taxonomy/avilist-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const DATA = path.resolve(ROOT, args.data || 'public/data')

/** 体积红线：懒加载的可见产物，超线说明该压缩/分片（当前 1.52MB，见 docs/031 §3.1） */
const MAX_BYTES = 2 * 1024 * 1024

const problems = []
const fail = (msg) => problems.push(msg)
const notes = []
const note = (msg) => notes.push(msg)

/** 读 JSON；不存在返回 null（依赖缺失不等于产物错误，按各自规则处理） */
const readJson = (p) => fs.readFile(p, 'utf8').then(JSON.parse).catch(() => null)

const bool = (v) => v === true || v === false

try {
  const raw = await fs.readFile(path.join(DATA, 'catalog.json'), 'utf8').catch(() => null)
  if (raw === null) {
    console.error(`✗ check:catalog：未找到 ${path.relative(ROOT, path.join(DATA, 'catalog.json'))}（先跑 npm run layers）`)
    process.exit(1)
  }
  const catalog = JSON.parse(raw)

  // ---- A. 结构 ----
  if (catalog.schemaVersion !== 1) fail(`schemaVersion=${catalog.schemaVersion}，期望 1`)
  if (typeof catalog.generatedAt !== 'string' || !catalog.generatedAt) fail('generatedAt 缺失')
  if (!Array.isArray(catalog.orders) || !catalog.orders.length) fail('orders 为空（名录未产出）')

  const orderNames = new Set()
  const familyNames = new Set() // 全局科名唯一性只在同目内成立（不同目同科名属异常，仍记录）
  const all = []
  const seenId = new Map()
  for (const [oi, order] of (catalog.orders || []).entries()) {
    const oat = `orders[${oi}]`
    if (typeof order?.sci !== 'string' || !order.sci) fail(`${oat}: 缺 sci`)
    else if (orderNames.has(order.sci)) fail(`${oat}: 目重复 ${order.sci}`)
    else orderNames.add(order.sci)
    if (order.zh !== undefined && (typeof order.zh !== 'string' || !order.zh.trim())) fail(`${oat}: zh 非空字符串`)
    if (!Array.isArray(order?.families) || !order.families.length) {
      fail(`${oat}: families 为空`)
      continue
    }
    let prevFamily = ''
    for (const [fi, family] of order.families.entries()) {
      const fat = `${oat}.families[${fi}]`
      if (typeof family?.sci !== 'string' || !family.sci) fail(`${fat}: 缺 sci`)
      else {
        if (prevFamily && family.sci.localeCompare(prevFamily) < 0) fail(`${fat}: 科未按学名升序（${prevFamily} → ${family.sci}）`)
        prevFamily = family.sci
        if (familyNames.has(family.sci)) note(`科名 ${family.sci} 出现在多个目（分类学上少见，人工复核）`)
        familyNames.add(family.sci)
      }
      if (!Array.isArray(family?.species) || !family.species.length) {
        fail(`${fat}: species 为空`)
        continue
      }
      let prevSci = ''
      for (const [si, sp] of family.species.entries()) {
        const at = `${fat}.species[${si}]`
        if (typeof sp?.id !== 'string' || !sp.id) fail(`${at}: 缺 id`)
        else if (seenId.has(sp.id)) fail(`${at}: id 重复 ${sp.id}（与 ${seenId.get(sp.id)}）`)
        else seenId.set(sp.id, at)
        if (typeof sp?.sci !== 'string' || !sp.sci) fail(`${at}: 缺 sci`)
        else {
          if (prevSci && sp.sci.localeCompare(prevSci) < 0) fail(`${at}: 科内学名未升序（${prevSci} → ${sp.sci}）`)
          prevSci = sp.sci
        }
        if (!bool(sp?.image)) fail(`${at}: image 必须是布尔（${sp?.image}）`)
        if (!bool(sp?.audio)) fail(`${at}: audio 必须是布尔（${sp?.audio}）`)
        for (const k of ['en', 'zh']) {
          if (sp?.[k] !== undefined && (typeof sp[k] !== 'string' || !sp[k].trim())) fail(`${at}: ${k} 非空字符串`)
        }
        if (sp?.py !== undefined) {
          if (typeof sp.py !== 'string' || !/^[a-z]+$/.test(sp.py)) fail(`${at}: py 必须为纯小写 a-z（${sp.py}）`)
          if (!sp.zh) fail(`${at}: 有 py 但无 zh（拼音键只能由中文名派生）`)
        }
        if (sp?.cm !== undefined && (!Number.isInteger(sp.cm) || sp.cm < 1 || sp.cm > 5)) {
          fail(`${at}: cm 非法（${sp.cm}，期望 1..5 整数）`)
        }
        if (sp?.extinct !== undefined && sp.extinct !== true) fail(`${at}: extinct 只能是 true 或省略（${sp.extinct}）`)
        all.push(sp)
      }
    }
  }

  // ---- B. counts 自洽 ----
  const counts = catalog.counts || {}
  const ordersArr = (catalog.orders || []).filter((o) => o && Array.isArray(o.families))
  const fact = {
    total: all.length,
    withImage: all.filter((s) => s.image).length,
    withAudio: all.filter((s) => s.audio).length,
    orders: (catalog.orders || []).length,
    families: ordersArr.reduce((n, o) => n + o.families.length, 0),
  }
  for (const k of ['total', 'withImage', 'withAudio', 'orders', 'families']) {
    if (counts[k] !== fact[k]) fail(`counts.${k}=${counts[k]} ≠ 实际 ${fact[k]}`)
  }

  // ---- C. 与 manifest（core + global）一致 ----
  const core = await readJson(path.join(DATA, 'manifest-core.json'))
  const global = await readJson(path.join(DATA, 'manifest-global.min.json'))
  if (!core) fail('缺 manifest-core.json（先跑 npm run layers）')
  if (!global) fail('缺 manifest-global.min.json（全球池未纳入时也应产出；缺失说明 layers 未跑全）')
  const poolById = new Map() // 供 D 段（科归属性比对）取池条目的 family 兜底
  if (core && global) {
    const expect = new Map()
    for (const sp of core.species || []) expect.set(sp.id, { sp, layer: 'core' })
    let overlap = 0
    for (const sp of global.species || []) {
      if (expect.has(sp.id)) overlap++
      expect.set(sp.id, { sp, layer: 'global' })
    }
    for (const [id, e] of expect) poolById.set(id, e.sp)
    if (overlap) fail(`manifest-core 与 manifest-global 有 ${overlap} 个 id 重叠（层级应互斥）`)
    if (counts.total !== expect.size) fail(`counts.total=${counts.total} ≠ core+global 物种数 ${expect.size}`)

    let missing = 0
    let extra = 0
    let mismatch = 0
    for (const sp of all) {
      const e = expect.get(sp.id)
      if (!e) {
        extra++
        if (extra <= 5) fail(`catalog 多出物种 ${sp.id}（不在 core/global）`)
        continue
      }
      const m = e.sp
      const expZh = m.nameZh ? m.nameZh : undefined
      const expEn = m.nameEn ? m.nameEn : undefined
      const bad =
        sp.sci !== m.nameSci ||
        sp.image !== !!m.image ||
        sp.audio !== !!m.audio ||
        sp.zh !== expZh ||
        sp.en !== expEn
      if (bad) {
        mismatch++
        if (mismatch <= 5) {
          fail(
            `catalog 与 manifest(${e.layer}) 不一致 ${sp.id}：` +
              `sci=${sp.sci}/${m.nameSci} image=${sp.image}/${!!m.image} audio=${sp.audio}/${!!m.audio} ` +
              `zh=${sp.zh}/${expZh} en=${sp.en}/${expEn}`,
          )
        }
      }
    }
    for (const id of expect.keys()) {
      if (!seenId.has(id)) {
        missing++
        if (missing <= 5) fail(`catalog 缺物种 ${id}（在 core/global 中）`)
      }
    }
    if (mismatch > 5) fail(`…共 ${mismatch} 处 catalog↔manifest 字段不一致`)
    if (extra > 5) fail(`…共 ${extra} 个 catalog 多出物种`)
    if (missing > 5) fail(`…共 ${missing} 个 catalog 缺失物种`)
    if (!mismatch && !extra && !missing) note(`与 manifest 一致：${all.length} 种（core ${core.species?.length ?? 0} + global ${global.species?.length ?? 0}）`)

    // core 内联 universe 汇总（首页/答疑页数字）与名录口径交叉
    const u = core.universe
    if (u) {
      if (u.total !== expect.size) fail(`core.universe.total=${u.total} ≠ core+global ${expect.size}`)
      if (u.withImage !== fact.withImage) fail(`core.universe.withImage=${u.withImage} ≠ catalog 实际 ${fact.withImage}`)
      if (u.withAudio !== fact.withAudio) fail(`core.universe.withAudio=${u.withAudio} ≠ catalog 实际 ${fact.withAudio}`)
    }
  }

  // ---- D. 与物种骨架一致 ----
  const index = await readJson(path.join(DATA, 'species-index.json'))
  if (!index) {
    fail('缺 species-index.json（catalog 的目/科归属来自骨架，无法交叉校验；先跑 npm run species-index）')
  } else {
    const byName = new Map()
    for (const e of index.species || []) byName.set(normalizeSciName(e.nameSci), e)
    const orderSeq = []
    const orderRank = new Map()
    for (const e of index.species || []) {
      if (!orderRank.has(e.order)) {
        orderRank.set(e.order, orderSeq.length)
        orderSeq.push(e.order)
      }
    }
    // 概念合并豁免：manifest 保留旧学名（AviList 并入父种），species-index.bankMappingNotes 有注记
    // （与 check:index 同一豁免口径；这里额外要求 resolvedTo 必须真实存在于骨架 —— 指向空处是真漂移）。
    const notes = Array.isArray(index.bankMappingNotes) ? index.bankMappingNotes : []
    const noteByKeyId = new Map(notes.map((n) => [`${n.id}|${n.taxonKey}`, n]))
    const viaNote = new Map() // manifest id → 骨架条目（经注记解析）
    let aliasMerges = 0
    for (const sp of all) {
      if (byName.has(normalizeSciName(sp.sci))) continue
      const m = poolById.get(sp.id)
      const n = m ? noteByKeyId.get(`${sp.id}|${m.taxonKey}`) : null
      if (!n) continue
      const resolved = byName.get(normalizeSciName(n.resolvedTo || ''))
      if (!resolved) {
        fail(`catalog ${sp.id} 的概念合并注记指向骨架中不存在的 ${n.resolvedTo}`)
        continue
      }
      viaNote.set(sp.id, resolved)
      aliasMerges++
    }
    let noIndex = 0
    let extinctBad = 0
    let cmBad = 0
    let prevRank = -1
    const skeletonOf = (sp) => byName.get(normalizeSciName(sp.sci)) || viaNote.get(sp.id)
    for (const sp of all) {
      const e = skeletonOf(sp)
      if (!e) {
        noIndex++
        if (noIndex <= 5) fail(`catalog ${sp.id}（${sp.sci}）不在物种骨架中，也无合法概念合并注记`)
        continue
      }
      // 目序必须是骨架序的子序列（buildCatalog 按骨架遍历）
      const rank = orderRank.get(e.order) ?? -1
      if (rank < prevRank) fail(`catalog 目序回退（${sp.id}：${e.order}），应按骨架目序排列`)
      prevRank = rank
      const extinctWant = e.extinct === true ? true : undefined
      if (sp.extinct !== extinctWant) {
        extinctBad++
        if (extinctBad <= 5) fail(`catalog ${sp.id} extinct=${sp.extinct}，骨架为 ${e.extinct === true}`)
      }
      // cm 的真源是 manifest 池条目（buildCatalog 直接读它；全球池的 commonness 在 layers 阶段已被骨架值覆盖）。
      // 概念合并的别名种在骨架里只有父种，两者的常见度互不隶属 —— 这里与 manifest 比对即可。
      const m = poolById.get(sp.id)
      if (m?.commonness !== undefined && sp.cm !== m.commonness) {
        cmBad++
        if (cmBad <= 5) fail(`catalog ${sp.id} cm=${sp.cm} ≠ manifest 常见度 ${m.commonness}`)
      }
    }
    if (noIndex > 5) fail(`…共 ${noIndex} 个 catalog 物种不在骨架中`)
    if (extinctBad > 5) fail(`…共 ${extinctBad} 个 extinct 标记与骨架不符`)
    if (cmBad > 5) fail(`…共 ${cmBad} 个常见度与骨架不符`)

    // 目/科归属逐条比对（骨架的 order/family 是 catalog 分类框架的真源）
    let familyBad = 0
    for (const order of catalog.orders || []) {
      for (const family of order.families || []) {
        if (!family || !Array.isArray(family.species)) continue // A 段已记录结构问题
        for (const sp of family.species || []) {
          const e = skeletonOf(sp)
          if (!e) continue
          const wantOrder = e.order || 'Incertae sedis'
          const wantFamily = e.family || poolById.get(sp.id)?.family || '—'
          if (order.sci !== wantOrder || family.sci !== wantFamily) {
            familyBad++
            if (familyBad <= 5) fail(`catalog ${sp.id} 归入 ${order.sci}/${family.sci}，骨架为 ${wantOrder}/${wantFamily}`)
          }
        }
      }
    }
    if (familyBad > 5) fail(`…共 ${familyBad} 个物种的目/科归属与骨架不符`)

    // ---- E. 拼音键可复算（构建期预计算 → 必须与算法输出逐条相等） ----
    const unknown = new Map()
    let pyBad = 0
    let missingPy = 0
    let emptyPy = 0
    for (const sp of all) {
      if (!sp.zh) continue
      const key = pinyinKey(sp.zh, (chars) => chars.forEach((ch) => unknown.set(ch, (unknown.get(ch) || 0) + 1)))
      if (!key) {
        emptyPy++ // 上游脏数据（zh 字段填了拉丁名，如 prinia-superciliaris），前端回退 en/sci
        if (sp.py) {
          pyBad++
          if (pyBad <= 5) fail(`catalog ${sp.id} 有 py=${sp.py} 但中文名无法读音（${sp.zh}）`)
        }
        continue
      }
      if (!sp.py) {
        missingPy++
        if (missingPy <= 5) fail(`catalog ${sp.id} 缺 py（中文名 ${sp.zh} 可复算为 ${key}）`)
        continue
      }
      if (sp.py !== key) {
        pyBad++
        if (pyBad <= 5) fail(`catalog ${sp.id} py=${sp.py} ≠ 复算 ${key}（zh=${sp.zh}）`)
      }
    }
    if (pyBad > 5) fail(`…共 ${pyBad} 个拼音键与复算不符`)
    if (missingPy > 5) fail(`…共 ${missingPy} 个可复算物种缺 py`)
    // 未收录字不拦截产物（构建期只告警：跳过该字后键仍可用，排序不崩），但要显式暴露给维护者
    if (unknown.size) note(`拼音库未收录字「${[...unknown.keys()].join('')}」（如需完整键补 scripts/lib/pinyin-key.mjs CHAR_OVERRIDES）`)
    const withZh = all.filter((s) => s.zh).length
    if (emptyPy) note(`中文名无法读音 ${emptyPy} 条（上游脏数据，无 py，前端回退 en/sci）`)
    if (aliasMerges) note(`概念合并豁免 ${aliasMerges} 条（bankMappingNotes 注记，按骨架父种校验目/科）`)
    const ordersNoZh = (catalog.orders || []).filter((o) => o && !o.zh).map((o) => o.sci)
    if (ordersNoZh.length) note(`无中文名的目 ${ordersNoZh.length} 个（页面回退拉丁名）：${ordersNoZh.slice(0, 8).join(', ')}`)
    note(`拼音键复算一致：${withZh - emptyPy - missingPy}/${withZh} 个中文名`)
  }

  // ---- F. 体积 ----
  const bytes = Buffer.byteLength(raw)
  if (bytes > MAX_BYTES) fail(`catalog.json ${(bytes / 1e6).toFixed(2)}MB 超 ${MAX_BYTES / 1e6}MB 红线（需压缩字段或分片）`)

  console.log(
    `· 名录：${fact.total} 种 · ${fact.orders} 目 / ${fact.families} 科 · 图 ${fact.withImage} / 音 ${fact.withAudio} · ` +
      `中文名 ${all.filter((s) => s.zh).length} · 灭绝 ${all.filter((s) => s.extinct).length} · ${(bytes / 1e6).toFixed(2)}MB`,
  )
  for (const n of notes) console.log(`  · ${n}`)
  if (problems.length) {
    console.error(`\n✗ check:catalog 失败（${problems.length} 项）：`)
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('\n✓ check:catalog：结构/计数/manifest/骨架/拼音键一致')
} catch (e) {
  console.error(`✗ check:catalog：${e.message}`)
  process.exit(1)
}
