/**
 * 023 P0:构建「全球物种骨架」public/data/species-index.json(AviList v2025b,~11k 种,不进 manifest),
 * 并给 manifest.species 增补稳定键 —— 只增不改:
 *   - species[].taxonKey = AvibaseID(AviList 官方稳定概念 ID,独立于命名)
 *   - species[].playable = true(现有 1299 全部可玩;未来媒体分层再细化)
 *   - id / 媒体路径 / 其余字段一律不动;骨架文件与 1299 可玩链路解耦。
 * 交叉映射:eBird code 直接取 AviList 的 Species_code_Cornell_Lab 列;
 *   backboneTaxonId 现有 1299 沿用 data/taxa.json 口径(manifest.taxonId),其余留待 P1 GBIF 匹配。
 *
 * 用法:
 *   npm run species-index                     # 读缓存 xlsx(data-cache/taxonomy/,先跑 npm run taxonomy:avilist)
 *   npm run species-index -- --refresh        # 先重下载再构建
 *   npm run species-index -- --mock --out /tmp/idx.json   # 夹具全离线(mock 必须显式 --out,防污染真产物)
 *   npm run species-index -- --no-manifest    # 只产骨架,不动 manifest
 *   npm run species-index -- --allow-misses   # 有未匹配学名也照常落盘(默认 fail-first)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { AVILIST_CACHE, AVILIST_VERSION } from './fetch-avilist.mjs'
import { parseAvilistXlsx, taxaFromRows, buildNameIndex, matchSpecies, normalizeSciName } from './avilist-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MANIFEST_PATH = path.join(ROOT, 'public/data/manifest.json')
const MOCK_FIXTURE = path.join(ROOT, 'tests/fixtures/taxonomy/avilist-sample.json')
const WIKIDATA_CACHE = path.join(ROOT, 'data-cache/taxonomy/wikidata-zh')
const GBIF_MATCH_CACHE = path.join(ROOT, 'data-cache/taxonomy/gbif-match')

const CITATION = `AviList Core Team. 2026. AviList: The Global Avian Checklist, ${AVILIST_VERSION}. https://doi.org/10.2173/avilist.${AVILIST_VERSION}`
const SOURCES = [
  {
    key: 'avilist',
    name: `AviList: The Global Avian Checklist, ${AVILIST_VERSION}`,
    url: 'https://www.avilist.org/',
    license: 'CC BY 4.0',
    attribution: 'AviList Core Team',
    citation: CITATION,
  },
]

const args = parseArgs(process.argv.slice(2))
const outPath = path.resolve(ROOT, args.out || 'public/data/species-index.json')

try {
  let rows
  if (args.mock) {
    if (!args.out) throw new Error('--mock 必须显式指定 --out(防止夹具数据污染真产物)')
    rows = JSON.parse(await fs.readFile(MOCK_FIXTURE, 'utf8')).rows
    console.log(`--mock:读夹具 ${path.relative(ROOT, MOCK_FIXTURE)}(${rows.length} 行)`)
  } else {
    if (args.refresh) {
      const { execFileSync } = await import('node:child_process')
      execFileSync('node', [path.join(ROOT, 'scripts/taxonomy/fetch-avilist.mjs'), '--refresh'], { stdio: 'inherit' })
    }
    const buf = await fs.readFile(AVILIST_CACHE).catch(() => {
      throw new Error(`缓存不存在:${AVILIST_CACHE}(先跑 npm run taxonomy:avilist)`)
    })
    rows = parseAvilistXlsx(buf)
    console.log(`解析 ${path.relative(ROOT, AVILIST_CACHE)}:${rows.length} 行`)
  }

  const taxa = taxaFromRows(rows)
  console.log(
    `AviList ${AVILIST_VERSION}:目 ${taxa.orders.length} · 科 ${taxa.families.length} · 属 ${taxa.genera.length} · 种 ${taxa.species.length} · 亚种 ${taxa.subspecies.length}`,
  )
  if (!args.mock && taxa.species.length < 10_000) {
    throw new Error(`species 行数异常(${taxa.species.length}),疑似解析不全,拒绝产出`)
  }

  // manifest 映射(只增字段;misses 默认 fail-first,不落任何盘)
  let matches = []
  let manifestPatched = false
  let manifestSpecies = []
  if (!args.mock && !args['no-manifest']) {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'))
    manifestSpecies = manifest.species
    const { matches: m, misses } = matchSpecies(manifest.species, buildNameIndex(taxa))
    matches = m
    if (misses.length && !args['allow-misses']) {
      console.error(`✗ ${misses.length} 个现有物种未能在 AviList 中匹配到学名(未写入任何文件):`)
      for (const x of misses) console.error(`   - ${x.id} (${x.nameSci})`)
      console.error('   逐个人工核对学名/概念后重跑,或确认无误用 --allow-misses 落盘。')
      process.exit(1)
    }
    if (misses.length) {
      console.warn(`⚠ --allow-misses:${misses.length} 个物种无 taxonKey(仍写 playable=true)`)
      for (const x of misses) console.warn(`   - ${x.id} (${x.nameSci})`)
    }
    const byId = new Map(matches.map((x) => [x.id, x]))
    for (const s of manifest.species) {
      const hit = byId.get(s.id)
      if (hit) s.taxonKey = hit.taxonKey
      // D-023-3(拆维度方案):构建期静态基线;许可过滤仍由前端 licenseGuard 运行时处理
      s.playableImage = (s.images ? s.images.length : 0) >= 1
      s.playableAudio = (s.audios ? s.audios.length : 0) >= 1
      s.playable = true // bank 1299 均有素材(≥1 图),playable=图或音可用 → 全 true
    }
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
    manifestPatched = true
    console.log(`manifest 只增字段完成:taxonKey ${matches.length}/${manifest.species.length} · playable 全 true`)
  }

  // 023 P1-b:backboneTaxonId 统一来自 GBIF v2 批量 match(当前 backbone 键位,全体重建、只认种级/接受名);
  // iNat 身份 = manifest 的 taxonId(它是 iNaturalist taxon ID,非 GBIF 键)→ 仅精确同学名概念携带 `inatTaxonId`。
  let backboneStats = null
  let inatCount = 0
  const matchByName = new Map()
  if (!args.mock) {
    try {
      const files = (await fs.readdir(GBIF_MATCH_CACHE)).filter((f) => /^batch-.*\.json$/.test(f)).sort()
      for (const f of files) {
        const j = JSON.parse(await fs.readFile(path.join(GBIF_MATCH_CACHE, f), 'utf8'))
        j.names.forEach((n, i) => matchByName.set(normalizeSciName(n), j.results[i]))
      }
      console.log(`gbif-match 缓存:${matchByName.size} 名`)
    } catch {
      console.log('gbif-match 缓存缺失/不可读,跳过 backbone 填充(npm run taxonomy:gbif-match)')
    }
  }
  const manifestById = new Map(manifestSpecies.map((s) => [s.id, s]))
  const inatByName = new Map()
  for (const m of matches) {
    if (m.via !== 'species') continue
    const s = manifestById.get(m.id)
    if (s && s.taxonId != null) inatByName.set(normalizeSciName(s.nameSci), s.taxonId)
  }

  const species = taxa.species.map((t) => {
    const e = { taxonKey: t.avibaseId, nameSci: t.nameSci, order: t.order, family: t.family }
    if (t.nameEn) e.nameEn = t.nameEn
    if (t.ebirdCode) e.ebirdCode = t.ebirdCode
    if (t.extinct) e.extinct = true
    const k = normalizeSciName(t.nameSci)
    const hit = matchByName.get(k)
    if (hit && hit.key != null) e.backboneTaxonId = hit.key
    const inatId = inatByName.get(k)
    if (inatId != null) {
      e.inatTaxonId = inatId
      inatCount++
    }
    return e
  })
  if (!args.mock && matchByName.size) {
    let matched = 0
    const via = {}
    for (const e of species) {
      if (e.backboneTaxonId != null) {
        matched++
        via[matchByName.get(normalizeSciName(e.nameSci)).via] = (via[matchByName.get(normalizeSciName(e.nameSci)).via] || 0) + 1
      }
    }
    backboneStats = { matched, via }
    console.log(`backbone:${matched}/${species.length}(${JSON.stringify(via)})· inatTaxonId ${inatCount}`)
  }

  // 023 P1-a:中文名 —— curated(manifest,精确同学名才可用)优先,其余走 Wikidata(CC0)缓存。
  // 概念合并物种(bankMappingNotes)的中文名属于旧概念,不得蹭给 AviList 概念 —— 只认 exact-name。
  let nameZhStats = null
  if (!args.mock) {
    const curatedByName = new Map()
    for (const s of manifestSpecies) {
      if (!s.nameZh || !s.nameZh.trim()) continue
      const k = normalizeSciName(s.nameSci)
      const prev = curatedByName.get(k)
      if (prev && prev !== s.nameZh.trim()) console.warn(`⚠ curated 中文名冲突 ${s.nameSci}:${prev} vs ${s.nameZh}(取先者)`)
      else curatedByName.set(k, s.nameZh.trim())
    }
    const wikiByName = new Map()
    try {
      const files = (await fs.readdir(WIKIDATA_CACHE)).filter((f) => /^batch-.*\.json$/.test(f)).sort()
      for (const f of files) {
        const j = JSON.parse(await fs.readFile(path.join(WIKIDATA_CACHE, f), 'utf8'))
        for (const [sci, pick] of Object.entries(j.labels || {})) wikiByName.set(normalizeSciName(sci), pick)
      }
    } catch {
      console.log('wikidata-zh 缓存缺失/不可读,跳过中文名填充(npm run taxonomy:wikidata-zh 抓取)')
    }
    let curatedCount = 0
    let wikiCount = 0
    const wikiLang = {}
    for (const e of species) {
      const k = normalizeSciName(e.nameSci)
      const curated = curatedByName.get(k)
      if (curated) {
        e.nameZh = curated
        curatedCount++
        continue
      }
      const wiki = wikiByName.get(k)
      if (wiki && wiki.zh) {
        e.nameZh = wiki.zh
        wikiCount++
        wikiLang[wiki.lang] = (wikiLang[wiki.lang] || 0) + 1
      }
    }
    if (curatedCount || wikiCount) {
      nameZhStats = { curated: curatedCount, wikidata: wikiCount }
      console.log(`中文名:curated ${curatedCount} + wikidata ${wikiCount} = ${curatedCount + wikiCount}/${species.length}` + (Object.keys(wikiLang).length ? `(语言分布 ${JSON.stringify(wikiLang)})` : ''))
    }
  }

  // 概念合并出处(审计用):现有学名 ≠ AviList 概念学名(别名/亚种归并)的映射记录。
  // manifest 保留旧学名与 id(媒体路径不动),taxonKey 指向 AviList 概念;check:index 按此注记放行学名不一致。
  const nameByKey = new Map(taxa.species.map((t) => [t.avibaseId, t.nameSci]))
  const bankMappingNotes = matches
    .filter((m) => m.via !== 'species')
    .map((m) => ({ id: m.id, nameSci: m.nameSci, via: m.via, taxonKey: m.taxonKey, resolvedTo: nameByKey.get(m.taxonKey) || null }))

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    checklistVersion: AVILIST_VERSION,
    citation: CITATION,
    sources: SOURCES,
    counts: {
      orders: taxa.orders.length,
      families: taxa.families.length,
      genera: taxa.genera.length,
      species: species.length,
      subspecies: taxa.subspecies.length,
      mappedToBank: matches.length,
      mappedToBackbone: backboneStats ? backboneStats.matched : 0,
    },
    species,
  }
  if (bankMappingNotes.length) index.bankMappingNotes = bankMappingNotes
  if (nameZhStats) index.nameZh = nameZhStats
  if (backboneStats) index.backbone = backboneStats
  // 产物为生成物,紧凑写盘(无缩进)。>2MB 时提醒:本文件是注册表(前端不整载),
  // 真正接入 UI 时再按目/科分片(021 §2.3 的预算针对前端按需加载文件)。
  await fs.writeFile(outPath, JSON.stringify(index))
  const bytes = Buffer.byteLength(JSON.stringify(index))
  const mb = (bytes / 1e6).toFixed(2)
  if (bytes > 2_000_000) {
    console.warn(`⚠ 产物 ${mb}MB 超出 2MB 参考线(P3 接入 UI 时分片;注册表类产物暂容忍)`)
  }
  console.log(`✓ 骨架已产出:${path.relative(ROOT, outPath)}(species ${species.length},${mb}MB${manifestPatched ? ',manifest 已增 taxonKey/playable' : ''})`)
} catch (e) {
  console.error(`✗ build-species-index:${e.message}`)
  process.exit(1)
}
