/**
 * 053-describe P0/P1/P3：IUCN Red List API v4 —— 结构化生境 / 系统。
 *
 * 产物：`data/iucn-habitats.json`（taxonKey → { habitats[], systems[] }）
 * 缓存：`data-cache/iucn-name/<slug>.json`（学名 → assessmentId，断点续抓）
 *       `data-cache/iucn-habitats/<assessmentId>.json`（裁剪后的生境，永不重抓）
 *
 * 池：`public/data/species-index.json`（AviList v2025b 骨架，11,131 种，权威学名 + taxonKey）。
 * `--scope core` 时优先复用 `data/distribution.json` 里已有的 IUCN assessmentId（1299 个核心种，免去解析调用）。
 *
 * ⚠️ 三个实测坑（2026-10-17，见 docs/053-describe §10.1）：
 *   1. **必须带浏览器 User-Agent**：默认 UA 会被 Cloudflare 以 `error code: 1010` 拦成 403，
 *      形态上与「凭证失效」一模一样。`scripts/build-taxa.mjs` 的 `IUCN 凭证/权限问题` 分支是误导性假设。
 *   2. 英文名在 **`habitats[].description.en` / `systems[].description.en`**（嵌套一层），不是 `.en`。
 *      `growth_forms` 实测为空数组，不取。
 *   3. 同一 `code` 会因不同 `season` 重复出现（实测重复率约 50%）→ 按 code 归并、season 取并集、
 *      `majorImportance` 取 OR。
 *
 * CLI：
 *   npm run taxonomy:iucn-habitat -- --scope core --concurrency 2
 *   npm run taxonomy:iucn-habitat -- --scope all --concurrency 2 --delay 1200
 *   npm run taxonomy:iucn-habitat -- --build-only      # 只用缓存重算产物，不联网
 *   npm run taxonomy:iucn-habitat -- --limit 20        # 冒烟
 *   npm run taxonomy:iucn-habitat -- --refresh-names   # 重新解析学名（默认命中缓存）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs, sleep } from '../lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const API = 'https://api.iucnredlist.org/api/v4'
/** 浏览器 UA —— 见坑 1，不能用 build 脚本默认 UA */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const DIR_NAME = path.join(ROOT, 'data-cache/iucn-name')
const DIR_HAB = path.join(ROOT, 'data-cache/iucn-habitats')
const OUT = path.join(ROOT, 'data/iucn-habitats.json')

const args = parseArgs(process.argv.slice(2))
const SCOPE = String(args.scope || 'core') // core | all
const LIMIT = args.limit === true ? Infinity : Number(args.limit || Infinity)
const CONCURRENCY = args.concurrency === true ? 2 : Math.max(1, Number(args.concurrency || 2))
const DELAY = Math.max(400, Number(args.delay) || 1200)
const BUILD_ONLY = !!args['build-only']
const REFRESH_NAMES = !!args['refresh-names']

const SOURCE = {
  key: 'iucn-redlist-v4',
  name: 'IUCN Red List of Threatened Species (API v4)',
  url: 'https://www.iucnredlist.org/',
  api: 'https://api.iucnredlist.org/api/v4',
  license: 'IUCN Red List terms of use（非商业使用；须引用）',
  terms: 'https://www.iucnredlist.org/terms/terms-of-use',
  attribution: 'IUCN Red List of Threatened Species',
  citation:
    'IUCN 2026. The IUCN Red List of Threatened Species. Version 2026. https://www.iucnredlist.org/',
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const readJson = async (p) => {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = async (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2) + '\n')

/** 带重试/退避/UA 的 JSON 请求；403 时区分 Cloudflare 1010 与真实鉴权失败 */
let consecutive403 = 0
let TOKEN = ''
async function getJson(url) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(DELAY + Math.random() * 400)
    let res
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (e) {
      console.warn(`  网络异常（${e.message}），第 ${attempt} 次重试`)
      await sleep(3000 * attempt)
      continue
    }
    if (res.ok) {
      consecutive403 = 0
      return await res.json()
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 5000 * attempt
      console.warn(`  429 限流，退避 ${Math.round(wait / 1000)}s`)
      await sleep(wait)
      continue
    }
    if (res.status === 404) return null
    if (res.status === 403) {
      const body = (await res.text()).slice(0, 160).replace(/\s+/g, ' ')
      consecutive403++
      if (body.includes('1010')) {
        throw new Error('Cloudflare 1010（按 UA 拦截）：本脚本已带浏览器 UA，请检查是否被中间层改写')
      }
      if (consecutive403 >= 3) throw new Error(`连续 403，IUCN 凭证可能失效：${body}`)
      console.warn(`  403（${body}），重试`)
      await sleep(3000)
      continue
    }
    console.warn(`  HTTP ${res.status}，第 ${attempt} 次重试`)
    await sleep(3000 * attempt)
  }
  return null
}

/** 学名 → assessmentId（只用学名前两段，亚种/异名种都走种级） */
async function resolveName(nameSci) {
  const [genus, species] = String(nameSci).trim().split(/\s+/)
  if (!genus || !species) return { status: 'bad_name', nameSci }
  const q = new URLSearchParams({ genus_name: genus, species_name: species })
  const found = await getJson(`${API}/taxa/scientific_name?${q}`)
  const list = found?.assessments || []
  const global =
    list.find((a) => a.latest && (a.scopes || []).some((s) => s.code === '1')) || list.find((a) => a.latest)
  if (!global) return { status: 'no_assessment', nameSci, matchedName: `${genus} ${species}` }
  return {
    status: 'ok',
    nameSci,
    matchedName: global.scientific_name || `${genus} ${species}`,
    assessmentId: global.assessment_id,
    year: global.year_published || null,
    category: global.red_list_category_code || null,
    url: global.url || null,
    resolvedVia: 'scientific_name',
    fetchedAt: new Date().toISOString(),
  }
}

/** 裁剪 + 归并（见头注坑 2/3） */
function trimAssessment(a) {
  const byCode = new Map()
  for (const h of a?.habitats || []) {
    const code = h?.code
    const en = h?.description?.en
    if (!code || !en) continue
    const cur = byCode.get(code) || { code, en, major: false, seasons: [] }
    if (h.majorImportance === 'Yes') cur.major = true
    if (h.season && !cur.seasons.includes(h.season)) cur.seasons.push(h.season)
    byCode.set(code, cur)
  }
  const systems = (a?.systems || [])
    .map((s) => ({ code: s?.code ?? null, en: s?.description?.en ?? null }))
    .filter((s) => s.en)
  return {
    assessmentId: a?.assessment_id ?? null,
    sciName: a?.taxon?.scientific_name ?? null,
    category: a?.red_list_category?.code ?? null,
    year: a?.year_published ?? null,
    assessmentUrl: a?.url ?? null,
    habitats: [...byCode.values()],
    systems,
    fetchedAt: new Date().toISOString(),
  }
}

async function main() {
  await loadEnv(path.join(ROOT, '.env'))
  TOKEN = process.env.IUCN_API_KEY || process.env.IUCN_TOKEN || ''
  if (!TOKEN && !BUILD_ONLY) throw new Error('缺少 IUCN_API_KEY（.env）——或用 --build-only 只读缓存')

  const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  let pool = index.species
  if (SCOPE === 'core') {
    // 核心种 = data/taxa.json 的 1,299 个 iNat taxonId 且在 distribution.json 里有 IUCN 分布记录
    const dist = JSON.parse(await fs.readFile(path.join(ROOT, 'data/distribution.json'), 'utf8'))
    const coreTaxonIds = new Set(Object.keys(dist.species || {}).map(Number))
    const coreNames = new Set()
    const taxa = JSON.parse(await fs.readFile(path.join(ROOT, 'data/taxa.json'), 'utf8'))
    for (const s of taxa.species || []) if (coreTaxonIds.has(s.taxonId)) coreNames.add(s.nameSci)
    pool = index.species.filter((s) => coreNames.has(s.nameSci))
  }
  pool = pool.slice(0, LIMIT)
  console.log(`池 ${pool.length} 种（scope=${SCOPE}）· 并发=${CONCURRENCY} · 间隔=${DELAY}ms`)

  // 核心种的 assessmentId 已在 distribution.json 的 iucn.url 里（末段），直接复用免调用
  const seed = new Map()
  try {
    const dist = JSON.parse(await fs.readFile(path.join(ROOT, 'data/distribution.json'), 'utf8'))
    const taxa = JSON.parse(await fs.readFile(path.join(ROOT, 'data/taxa.json'), 'utf8'))
    for (const s of taxa.species || []) {
      const d = dist.species?.[String(s.taxonId)]
      const url = d?.iucn?.url
      if (!url) continue
      const id = Number(String(url).split('/').pop())
      if (Number.isFinite(id)) seed.set(s.nameSci, id)
    }
    console.log(`  复用已有 assessmentId：${seed.size} 条（免去 scientific_name 调用）`)
  } catch {
    /* distribution.json 缺失则全部走解析 */
  }

  await fs.mkdir(DIR_NAME, { recursive: true })
  await fs.mkdir(DIR_HAB, { recursive: true })

  const counters = { ok: 0, cachedName: 0, cachedHab: 0, noAssessment: 0, failed: 0 }
  const queue = [...pool]

  async function worker() {
    while (queue.length) {
      const sp = queue.shift()
      const nameFile = path.join(DIR_NAME, `${slug(sp.nameSci)}.json`)
      let rec = REFRESH_NAMES ? null : await readJson(nameFile)
      if (!rec) {
        rec = seed.has(sp.nameSci)
          ? {
              status: 'ok',
              nameSci: sp.nameSci,
              assessmentId: seed.get(sp.nameSci),
              resolvedVia: 'distribution.json',
              fetchedAt: new Date().toISOString(),
            }
          : await resolveName(sp.nameSci)
        await writeJson(nameFile, rec)
      } else {
        counters.cachedName++
      }
      if (rec.status !== 'ok') {
        counters.noAssessment++
        continue
      }
      counters.ok++
      const habFile = path.join(DIR_HAB, `${rec.assessmentId}.json`)
      if (await readJson(habFile)) {
        counters.cachedHab++
        continue
      }
      const detail = await getJson(`${API}/assessment/${rec.assessmentId}`)
      if (!detail) {
        counters.failed++
        continue
      }
      const a = detail.assessments ? detail.assessments[0] : detail
      await writeJson(habFile, trimAssessment(a))
      if (counters.ok % 25 === 0) {
        console.log(
          `  …已解析 ${counters.ok}（复用名 ${counters.cachedName} / 复用生境 ${counters.cachedHab}）剩余 ${queue.length}`,
        )
      }
    }
  }
  if (!BUILD_ONLY) await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // ---- 汇总产物 ----
  const unmatched = []
  const byTaxonKey = {}
  const codeStats = new Map()
  let withHabitats = 0
  for (const sp of pool) {
    const rec = await readJson(path.join(DIR_NAME, `${slug(sp.nameSci)}.json`))
    if (!rec || rec.status !== 'ok') {
      unmatched.push({ nameSci: sp.nameSci, taxonKey: sp.taxonKey, status: rec?.status || 'missing' })
      continue
    }
    const hab = await readJson(path.join(DIR_HAB, `${rec.assessmentId}.json`))
    if (!hab) {
      unmatched.push({ nameSci: sp.nameSci, taxonKey: sp.taxonKey, status: 'assessment_missing' })
      continue
    }
    if (hab.habitats.length) withHabitats++
    for (const h of hab.habitats) {
      const cur = codeStats.get(h.code) || { code: h.code, en: h.en, species: 0 }
      cur.species++
      codeStats.set(h.code, cur)
    }
    byTaxonKey[sp.taxonKey] = {
      nameSci: sp.nameSci,
      nameZh: sp.nameZh ?? null,
      assessmentId: hab.assessmentId,
      category: hab.category,
      year: hab.year,
      assessmentUrl: hab.assessmentUrl,
      habitats: hab.habitats,
      systems: hab.systems,
    }
  }

  await writeJson(OUT, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    scope: SCOPE,
    note:
      'IUCN 结构化生境（habitats 按 code 归并、season 取并集）与系统（systems）。' +
      '中文名请查 data/iucn-habitat-codes.json（产物只放 code，不放译名）。' +
      'IUCN 的 habitat 是「评估视角」的主要生境，不等于生境描述文本。',
    counts: {
      pool: pool.length,
      matched: Object.keys(byTaxonKey).length,
      withHabitats,
      unmatched: unmatched.length,
      distinctHabitatCodes: codeStats.size,
    },
    habitatCodes: [...codeStats.values()].sort((a, b) => a.code.localeCompare(b.code)),
    byTaxonKey,
    unmatched,
  })

  console.log(
    `\n✅ data/iucn-habitats.json：池 ${pool.length} / 命中 ${Object.keys(byTaxonKey).length} / 有生境 ${withHabitats} / 未匹配 ${unmatched.length} / 不同 habitat code ${codeStats.size}`,
  )
  console.log(`   统计：解析 ${counters.ok}（复用名 ${counters.cachedName} · 复用生境 ${counters.cachedHab}）· 无评估 ${counters.noAssessment} · 失败 ${counters.failed}`)
  console.log('   未匹配清单已落在产物 unmatched 字段（**不猜、不补**，留给人工）')
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
