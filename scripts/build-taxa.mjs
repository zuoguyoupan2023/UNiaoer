#!/usr/bin/env node
/**
 * M0 鸟种清单构建脚本（详 011 §10）
 *
 * 世界前 N（默认 1000）+ 中国前 M（默认 500）：
 *   - 榜单来源：iNaturalist `observations/species_counts`（按观测数）
 *   - 按 `taxon_id` 去重；写 rankWorld / rankCN / inCN / nameZh / nameEn / family / commonness
 * 全量分布国家（以鸟为核心）：
 *   - 主：IUCN Red List API v4（`taxa/scientific_name` → `assessment/{id}` 的 locations）
 *   - 补：GBIF（`species/match` → `occurrence/search?facet=country`）
 *   - 逐条保留 distributionSource；IUCN 优先，缺失/明显不全用 GBIF 兜底/合并
 *
 * 产物：data/taxa.json、data/distribution.json（M0 先不抓媒体）
 *
 * 用法：
 *   node scripts/build-taxa.mjs [--world 1000] [--cn 500] [--limit N]
 *                               [--concurrency 2] [--max-minutes N] [--force]
 *                               [--skip-distribution] [--gbif-min 1]
 *
 * 低频抓取：并发低、随机延迟、失败退避、data-cache/ 断点续抓。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  parseArgs,
  loadEnv,
  fetchJson,
  cachedJson,
  mapPool,
  sleep,
  ensureDir,
} from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INAT = 'https://api.inaturalist.org/v1'
const IUCN = 'https://api.iucnredlist.org/api/v4'
const GBIF = 'https://api.gbif.org/v1'
const CACHE = path.join(ROOT, 'data-cache')
const DATA = path.join(ROOT, 'data')

const args = parseArgs(process.argv.slice(2))
const OPT = {
  world: args.world ? Number(args.world) : 1000,
  cn: args.cn ? Number(args.cn) : 500,
  limit: args.limit ? Number(args.limit) : Infinity,
  concurrency: args.concurrency ? Number(args.concurrency) : 2,
  maxMinutes: args['max-minutes'] ? Number(args['max-minutes']) : Infinity,
  force: !!args.force,
  skipDistribution: !!args['skip-distribution'],
  retryMisses: !!args['retry-misses'],
  fast: !!args.fast,
  gbifMin: args['gbif-min'] ? Number(args['gbif-min']) : 1,
}

let IUCN_KEY = ''
let IUCN_SYNONYMS = {}
const rand = (min, max) => min + Math.random() * (max - min)
/** 随机延迟；--fast（缓存复用、离线重算）时跳过，便于快速重建产物 */
const pause = (min = 0, max = 0) => (OPT.fast ? Promise.resolve() : sleep(rand(min, max)))

async function main() {
  await loadEnv(path.join(ROOT, '.env'))
  IUCN_KEY = process.env.IUCN_API_KEY || ''
  if (process.env.IUCN_TOKEN && !IUCN_KEY) IUCN_KEY = process.env.IUCN_TOKEN
  IUCN_SYNONYMS = await loadIucnSynonyms()

  const deadline = OPT.maxMinutes === Infinity ? Infinity : Date.now() + OPT.maxMinutes * 60_000
  const worldGoal = Math.min(OPT.world, OPT.limit)
  const cnGoal = Math.min(OPT.cn, OPT.limit)

  console.log('\n🐦 UNiaoer 鸟种清单 M0')
  console.log(`   世界榜目标: ${worldGoal}   中国榜目标: ${cnGoal}   并发: ${OPT.concurrency}`)
  console.log(`   分布数据源: IUCN${IUCN_KEY ? '' : '（未配置 IUCN_API_KEY，仅 GBIF）'} + GBIF`)
  console.log(`   时间预算: ${OPT.maxMinutes === Infinity ? '不限' : OPT.maxMinutes + ' 分钟'}\n`)

  // 1. 中国 place_id（不写死，运行时解析）
  let cnPlaceId = null
  if (cnGoal > 0) {
    cnPlaceId = await resolveCnPlaceId()
    console.log(`   中国 place_id = ${cnPlaceId}`)
  }

  // 2. 两份榜单
  const world = await fetchRanking({ placeId: null, size: worldGoal, label: 'world' })
  const cn = cnPlaceId ? await fetchRanking({ placeId: cnPlaceId, size: cnGoal, label: 'cn' }) : []
  console.log(`   世界榜抓取: ${world.length} 种   中国榜抓取: ${cn.length} 种`)

  // 3. 合并去重 + 名次
  const merged = mergeRanks(world, cn)
  console.log(`   去重后: ${merged.length} 种（其中中国榜 ${merged.filter((s) => s.rankCN).length} 种）`)

  // 4. 名称 / 科（iNat taxa 批量，locale=zh-CN 同时给英文俗名）
  const ids = merged.map((s) => s.taxonId)
  const details = await fetchTaxaDetails(ids)
  const species = merged.map((s) => decorate(s, details.get(s.taxonId)))

  species.sort((a, b) => sortKey(a) - sortKey(b))

  await ensureDir(DATA)
  const taxaOut = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'iNaturalist species_counts',
    worldSize: world.length,
    cnSize: cn.length,
    total: species.length,
    species,
  }
  await fs.writeFile(path.join(DATA, 'taxa.json'), JSON.stringify(taxaOut, null, 2))
  console.log(`\n✅ taxa.json：${species.length} 种`)
  printTaxaSummary(species)

  // 5. 分布国家
  if (!OPT.skipDistribution) {
    console.log('\n🌍 抓取分布国家（IUCN 主 / GBIF 补）…')
    const dist = await buildDistribution(species, deadline)
    await fs.writeFile(path.join(DATA, 'distribution.json'), JSON.stringify(dist, null, 2))
    console.log('\n✅ distribution.json 已写入')
    printDistSummary(dist)
  } else {
    console.log('\n⏭️ 已跳过分布抓取（--skip-distribution）')
  }
}

/** 中国 place_id：places/autocomplete 取 admin_level 0 且名为 China 的条目 */
async function resolveCnPlaceId() {
  const cacheFile = path.join(CACHE, 'taxa', 'cn-place.json')
  const data = await cachedJson(
    cacheFile,
    async () => {
      const d = await fetchJson(`${INAT}/places/autocomplete?q=China&per_page=10`)
      const hit = (d.results || []).find((p) => p.admin_level === 0 && /^china$/i.test(p.name))
      return hit ? { id: hit.id, name: hit.name } : null
    },
    { force: OPT.force },
  )
  if (!data) throw new Error('无法解析中国 place_id')
  return data.id
}

/** 抓一份榜单（分页 100，累计到 size 个 species 级 taxa 为止） */
async function fetchRanking({ placeId, size, label }) {
  const out = []
  for (let page = 1; out.length < size && page <= 40; page++) {
    const cacheFile = path.join(CACHE, 'taxa', `rank-${label}-${page}.json`)
    const data = await cachedJson(
      cacheFile,
      async () => {
        const params = new URLSearchParams({
          iconic_taxa: 'Aves',
          quality_grade: 'research',
          per_page: '100',
          order_by: 'count',
          page: String(page),
        })
        if (placeId) params.set('place_id', String(placeId))
        return await fetchJson(`${INAT}/observations/species_counts?${params}`)
      },
      { force: OPT.force },
    )
    const results = data.results || []
    if (!results.length) break
    for (const r of results) {
      if (out.length >= size) break
      const t = r.taxon || {}
      if (t.rank !== 'species' || t.extinct || !t.id) continue
      out.push({ taxonId: t.id, nameSci: t.name, count: r.count })
    }
    if (results.length < 100) break
    await sleep(rand(400, 1000))
  }
  return out.slice(0, size)
}

/** 合并世界榜与中国榜，写 rankWorld / rankCN / inCN */
function mergeRanks(world, cn) {
  const map = new Map()
  world.forEach((s, i) => map.set(s.taxonId, { ...s, rankWorld: i + 1 }))
  cn.forEach((s, i) => {
    const cur = map.get(s.taxonId)
    if (cur) {
      cur.rankCN = i + 1
      cur.observationsCN = s.count
    } else {
      map.set(s.taxonId, { ...s, rankCN: i + 1, observationsCN: s.count })
    }
  })
  for (const s of map.values()) s.inCN = !!s.rankCN
  return [...map.values()]
}

/** iNat taxa 批量详情（分块 20，避免超长响应截断）；缓存按 chunk 内容哈希 */
async function fetchTaxaDetails(ids) {
  const CHUNK = 20
  const map = new Map()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const key = createHash('sha1').update(chunk.join(',')).digest('hex').slice(0, 16)
    const cacheFile = path.join(CACHE, 'taxa', `batch-${key}.json`)
    const data = await cachedJson(
      cacheFile,
      async () => {
        const url = `${INAT}/taxa/${chunk.join(',')}?locale=zh-CN&per_page=${chunk.length}`
        return await fetchJson(url, { timeout: 60000 })
      },
      { force: OPT.force },
    )
    for (const t of data.results || []) map.set(t.id, t)
    await sleep(rand(300, 800))
  }
  return map
}

function decorate(s, t) {
  const familyAnc = t ? (t.ancestors || []).find((a) => a.rank === 'family') : null
  const family = familyAnc ? familyAnc.preferred_common_name || familyAnc.name : ''
  const nameEn = t ? t.english_common_name || '' : ''
  const nameZh = t ? t.preferred_common_name || nameEn || s.nameSci : s.nameSci
  return {
    id: slugFromName(s.nameSci),
    taxonId: s.taxonId,
    nameZh,
    nameSci: s.nameSci,
    nameEn,
    family,
    rankWorld: s.rankWorld ?? null,
    rankCN: s.rankCN ?? null,
    inCN: !!s.inCN,
    commonness: commonnessOf(s),
    observationsWorld: s.rankWorld ? s.count ?? null : null,
    observationsCN: s.observationsCN ?? null,
  }
}

function slugFromName(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** §5.1：CN 榜为主分三档；CN 之外世界榜靠前补第 3 档；其余第 4 档 */
function commonnessOf({ rankCN, rankWorld }) {
  if (rankCN && rankCN <= 100) return 1
  if (rankCN && rankCN <= 300) return 2
  if (rankCN && rankCN <= 500) return 3
  if (!rankCN && rankWorld && rankWorld <= 300) return 3
  return 4
}

/** 排序：中国榜物种按 CN 名次在前，其余按世界名次 */
function sortKey(s) {
  return s.rankCN != null ? s.rankCN : 100000 + (s.rankWorld || 0)
}

function printTaxaSummary(species) {
  const inCN = species.filter((s) => s.inCN).length
  const byCn = countBy(species, (s) => s.commonness)
  const noZh = species.filter((s) => !s.nameZh || s.nameZh === s.nameSci).length
  const noEn = species.filter((s) => !s.nameEn).length
  const noFam = species.filter((s) => !s.family).length
  console.log(`   中国榜: ${inCN}   世界榜独有: ${species.length - inCN}`)
  console.log(`   commonness: ${[1, 2, 3, 4].map((k) => `${k}=${byCn[k] || 0}`).join('  ')}`)
  console.log(`   缺中文名: ${noZh}   缺英文名: ${noEn}   缺科: ${noFam}`)
}

async function buildDistribution(species, deadline) {
  const results = {}
  let done = 0
  let iucnOk = 0
  let gbifOk = 0
  let none = 0
  let synonymResolved = 0
  const total = species.length

  if (OPT.retryMisses) {
    const removed = await clearFailedIucnCache()
    console.log(`   ↻ --retry-misses：清理 ${removed} 条未命中的 IUCN / 同义词缓存，将重试`)
  }

  await mapPool(species, OPT.concurrency, async (sp) => {
    const key = String(sp.taxonId)
    if (Date.now() > deadline) {
      results[key] = { countries: [], distributionSource: 'skipped' }
      return
    }
    try {
      const iucn = await fetchIucn(sp)
      await pause(700, 1800)
      const gbif = await fetchGbif(sp)

      const ic = iucn && iucn.status === 'ok' ? iucn.countries : []
      const gc = (gbif && gbif.countries) || []
      // IUCN 为主；仅在其缺失时用 GBIF 兜底。不合并——GBIF 是观测点，
      // 会把圈养/逃逸记录计入分布，从而污染特有种（如澳洲特有种只 1 国才是对的）。
      let countries = ic
      let source = ic.length ? 'IUCN' : 'none'
      if (!ic.length && gc.length) {
        countries = gc
        source = 'GBIF'
      }
      if (source === 'IUCN' || source === 'IUCN+GBIF') iucnOk++
      else if (source === 'GBIF') gbifOk++
      else none++
      if (iucn && iucn.resolvedVia === 'synonym') synonymResolved++

      results[key] = {
        countries,
        distributionSource: source,
        iucn: iucn
          ? {
              status: iucn.status,
              countries: ic.length,
              year: iucn.year || null,
              category: iucn.category || null,
              url: iucn.url || null,
              matchedName: iucn.matchedName || null,
              resolvedVia: iucn.resolvedVia || null,
            }
          : null,
        gbif: gbif ? { usageKey: gbif.usageKey || null, countries: gc.length } : null,
      }
    } catch (e) {
      results[key] = { countries: [], distributionSource: 'error', error: e.message }
      none++
    }
    done++
    if (done % 25 === 0 || done === total) {
      console.log(`   [${done}/${total}] IUCN ${iucnOk} · GBIF ${gbifOk} · 无 ${none}`)
    }
    await pause(600, 1500)
  })

  const labelled = Object.entries(results).map(([taxonId, v]) => ({ taxonId: Number(taxonId), ...v }))
  const dist = { IUCN: 0, GBIF: 0, 'IUCN+GBIF': 0, none: 0, skipped: 0, error: 0 }
  for (const v of labelled) {
    if (v.distributionSource in dist) dist[v.distributionSource]++
    else dist.none++
  }
  const buckets = { '0': 0, '1': 0, '2-5': 0, '6-15': 0, '16-40': 0, '41+': 0 }
  for (const v of labelled) {
    const n = v.countries.length
    if (n === 0) buckets['0']++
    else if (n === 1) buckets['1']++
    else if (n <= 5) buckets['2-5']++
    else if (n <= 15) buckets['6-15']++
    else if (n <= 40) buckets['16-40']++
    else buckets['41+']++
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      iucn: 'IUCN Red List API v4 (https://api.iucnredlist.org/)',
      gbif: 'GBIF (https://www.gbif.org/)',
    },
    gbifMin: OPT.gbifMin,
    note: 'countries 为 ISO 3166-1 alpha-2；IUCN 主，GBIF 补/合并；逐条保留 distributionSource',
    total: labelled.length,
    synonymResolved,
    needsReview: labelled.filter((v) => v.distributionSource === 'GBIF').map((v) => v.taxonId),
    bySource: dist,
    countriesBuckets: buckets,
    avgCountries: round1(labelled.reduce((a, v) => a + v.countries.length, 0) / Math.max(1, labelled.length)),
    species: Object.fromEntries(labelled.map((v) => [v.taxonId, v])),
  }
}

/** 清理未命中的 IUCN / 同义词缓存（--retry-misses），返回清理条数 */
async function clearFailedIucnCache() {
  let removed = 0
  for (const [dir, keepOk] of [
    ['iucn', true],
    ['iucn-name', false],
  ]) {
    const d = path.join(CACHE, dir)
    let files = []
    try {
      files = await fs.readdir(d)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const p = path.join(d, f)
      if (keepOk) {
        try {
          const v = JSON.parse(await fs.readFile(p, 'utf8'))
          if (v && v.status === 'ok') continue
        } catch {
          /* 解析失败也清理 */
        }
      }
      await fs.rm(p, { force: true })
      removed++
    }
  }
  return removed
}

/** 读取人工覆盖表 data/iucn-synonyms.json（缺失则空） */
async function loadIucnSynonyms() {
  try {
    const d = JSON.parse(await fs.readFile(path.join(DATA, 'iucn-synonyms.json'), 'utf8'))
    return d.synonyms || {}
  } catch {
    return {}
  }
}

/** IUCN 精确学名两段查询（scientific_name → assessment）；name 为 "Genus species" */
async function iucnLookupByName(name) {
  const [genusName, speciesName] = String(name).trim().split(/\s+/)
  if (!genusName || !speciesName) return { status: 'bad_name', matchedName: null }
  const headers = { Authorization: `Bearer ${IUCN_KEY}` }
  const q = new URLSearchParams({ genus_name: genusName, species_name: speciesName })
  let found
  try {
    found = await fetchJson(`${IUCN}/taxa/scientific_name?${q}`, { headers, retries: 5, timeout: 60000 })
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return { status: 'not_found', matchedName: null }
    if (/HTTP 40[13]/.test(e.message)) throw new Error(`IUCN 凭证/权限问题：${e.message}`)
    throw e
  }
  const assessments = found.assessments || []
  const global =
    assessments.find((a) => a.latest && (a.scopes || []).some((s) => s.code === '1')) ||
    assessments.find((a) => a.latest)
  if (!global) return { status: 'no_assessment', matchedName: name }
  const detail = await fetchJson(`${IUCN}/assessment/${global.assessment_id}`, {
    headers,
    retries: 5,
    timeout: 60000,
  })
  const a = detail.assessments ? detail.assessments[0] : detail
  const locations = a.locations || []
  const countries = [
    ...new Set(
      locations
        .filter((l) => l.presence !== 'Extinct')
        .map((l) => l.code)
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ]
  return {
    status: 'ok',
    matchedName: name,
    assessmentId: global.assessment_id,
    year: global.year_published || null,
    category: global.red_list_category_code || null,
    url: global.url || null,
    countries,
  }
}

/**
 * IUCN 精确名未命中时的同义词候选（缓存）。
 * 顺序：人工覆盖表 → GBIF accepted usage → GBIF synonyms（旧名，IUCN 常仍沿用）→ Wikidata P225。
 * 只取双名（属+种），排除与原名同属者优先旧属。
 */
async function resolveIucnCandidates(sp) {
  const cacheFile = path.join(CACHE, 'iucn-name', `${sp.taxonId}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      const out = []
      const origGenus = String(sp.nameSci).split(/\s+/)[0].toLowerCase()
      const add = (n) => {
        const parts = String(n || '').trim().split(/\s+/)
        if (parts.length < 2) return
        const bin = `${parts[0]} ${parts[1]}`
        if (bin.toLowerCase() === sp.nameSci.toLowerCase()) return
        if (!out.includes(bin)) out.push(bin)
      }

      const ov = IUCN_SYNONYMS[sp.nameSci]
      const ovArr = Array.isArray(ov) ? ov : ov ? [ov] : []
      for (const v of ovArr) add(v)
      if (ovArr.length) return out // 人工覆盖优先，不再联网

      let usageKey = null
      let family = null
      try {
        const m = await fetchJson(`${GBIF}/species/match?name=${encodeURIComponent(sp.nameSci)}`)
        if (m && m.kingdom === 'Animalia') {
          usageKey = m.acceptedUsageKey || m.usageKey || null
          family = m.family || null
          if (m.acceptedUsageKey && m.acceptedUsageKey !== m.usageKey) {
            const acc = await fetchJson(`${GBIF}/species/${m.acceptedUsageKey}`)
            if (acc && acc.canonicalName) add(acc.canonicalName)
          }
        }
      } catch {
        /* skip */
      }
      await sleep(rand(300, 700))

      if (usageKey) {
        try {
          const syn = await fetchJson(`${GBIF}/species/${usageKey}/synonyms?limit=100`)
          const cands = (syn.results || [])
            .map((r) => r.canonicalName || r.scientificName)
            .filter(Boolean)
          const diffGenus = cands.filter((c) => c.split(/\s+/)[0]?.toLowerCase() !== origGenus)
          for (const c of (diffGenus.length ? diffGenus : cands).slice(0, 12)) add(c)
        } catch {
          /* skip */
        }
        await sleep(rand(300, 700))
      }

      for (const n of await wikidataP225(sp.nameSci, family)) add(n)

      return out.slice(0, 20)
    },
    { force: OPT.force },
  )
}

/** Wikidata 的 P225（taxon name）；经 GBIF 确认与原名同科（family）才采纳，避免同名异物 */
async function wikidataP225(sci, family) {
  const WD = 'https://www.wikidata.org/w/api.php'
  const epithet = String(sci).split(/\s+/)[1]
  if (!epithet) return []
  const search = await fetchJson(
    `${WD}?action=wbsearchentities&search=${encodeURIComponent(sci)}&language=en&type=item&limit=5&format=json`,
    { retries: 3, timeout: 20000 },
  ).catch(() => null)
  if (!search) return []
  const names = []
  for (const r of search.search || []) {
    const ent = await fetchJson(
      `${WD}?action=wbgetentities&ids=${r.id}&props=claims&format=json`,
      { retries: 3, timeout: 20000 },
    ).catch(() => null)
    if (!ent || !ent.entities || !ent.entities[r.id]) continue
    const p225 = (ent.entities[r.id].claims.P225 || [])
      .map((c) => c.mainsnak.datavalue && c.mainsnak.datavalue.value)
      .filter(Boolean)
    if (p225.some((n) => n.split(/\s+/)[1] && n.split(/\s+/)[1].toLowerCase() === epithet.toLowerCase())) {
      names.push(...p225)
      break
    }
    await sleep(rand(400, 900))
  }
  const valid = []
  for (const n of names) {
    if (n.toLowerCase() === sci.toLowerCase()) continue
    try {
      const m = await fetchJson(`${GBIF}/species/match?name=${encodeURIComponent(n)}&strict=true`)
      if (m && m.kingdom === 'Animalia' && (!family || !m.family || m.family === family)) valid.push(n)
    } catch {
      /* skip */
    }
    await sleep(rand(300, 700))
  }
  return valid
}

/** IUCN：精确 → 同义词回退 → 结果（缓存） */
async function fetchIucn(sp) {
  if (!IUCN_KEY) return null
  const cacheFile = path.join(CACHE, 'iucn', `${sp.taxonId}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      const res = await iucnLookupByName(sp.nameSci)
      if (res.status === 'ok' || res.status === 'no_assessment') return res

      const candidates = await resolveIucnCandidates(sp)
      for (const c of candidates) {
        await sleep(rand(800, 1600))
        const r = await iucnLookupByName(c)
        if (r.status === 'ok') return { ...r, resolvedVia: 'synonym' }
      }
      return res
    },
    { force: OPT.force },
  )
}

async function fetchGbif(sp) {
  const cacheFile = path.join(CACHE, 'gbif', `${sp.taxonId}.json`)
  return cachedJson(
    cacheFile,
    async () => {
      let match
      try {
        match = await fetchJson(`${GBIF}/species/match?name=${encodeURIComponent(sp.nameSci)}`)
      } catch {
        return { usageKey: null, countries: [] }
      }
      if (!match || match.matchType === 'NONE' || !match.usageKey) {
        return { usageKey: null, countries: [] }
      }
      const facet = await fetchJson(
        `${GBIF}/occurrence/search?taxonKey=${match.usageKey}&facet=country&facetLimit=300&limit=0`,
        { timeout: 60000 },
      )
      const counts = (facet.facets && facet.facets[0] && facet.facets[0].counts) || []
      const countries = counts
        .filter((c) => /^[A-Z]{2}$/.test(c.name) && c.name !== 'ZZ' && c.count >= OPT.gbifMin)
        .map((c) => c.name)
      return { usageKey: match.usageKey, family: match.family || '', countries }
    },
    { force: OPT.force },
  )
}

function printDistSummary(dist) {
  console.log(`   覆盖: IUCN ${dist.bySource.IUCN} · GBIF ${dist.bySource.GBIF} · 合并 ${dist.bySource['IUCN+GBIF']} · 无 ${dist.bySource.none} （错误 ${dist.bySource.error}，跳过 ${dist.bySource.skipped}）`)
  if (dist.synonymResolved) console.log(`   同义词回退命中: ${dist.synonymResolved}`)
  const b = dist.countriesBuckets
  console.log(`   国家数分布: 0=${b['0']} 1=${b['1']} 2-5=${b['2-5']} 6-15=${b['6-15']} 16-40=${b['16-40']} 41+=${b['41+']}   平均 ${dist.avgCountries}`)
}

function countBy(arr, fn) {
  const out = {}
  for (const x of arr) {
    const k = fn(x)
    out[k] = (out[k] || 0) + 1
  }
  return out
}

function round1(n) {
  return Math.round(n * 10) / 10
}

main().catch((e) => {
  console.error('❌ 构建失败:', e)
  process.exit(1)
})
