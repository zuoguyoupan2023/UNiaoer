#!/usr/bin/env node
/**
 * 全量地区池核算（只读，离线）：把每个国家/地区的 L1 / L2-L3 / L4-L5 / L6+ 出题池
 * 与「档位覆盖比例」逐个算出来，用于推送前的事实核验与事后回归对比。
 *
 * 目的（2026-11-05 用户要求）：推 R2 之前，必须先把**所有国家/地区**的各档数据核实，
 * 而不是只验上海/中国。任何地区出现「L1 池 == L6+ 池」（= 档位没生效）或
 * 「比例反序」（L1 > L2 > L4）都必须先暴露。
 *
 * 口径与前端出题链路完全一致（`src/stores/quiz.ts` regionScopeInfo）：
 *   ① 区系（species-distribution，含 CN→港澳台并集语义）
 *   ∩ ⑥ 档位表（province-commonness，精确到省）
 *   ∩ manifest playableImage && !quizExcluded
 *   ∩ 当前语言有名字（默认 zh）
 *   ∩ TIERS[tier].commonness
 *
 * 用法：
 *   node scripts/report-tier-pools.mjs                    # 摘要 + 异常清单
 *   node scripts/report-tier-pools.mjs --country CN,US,JP # 只算指定国家
 *   node scripts/report-tier-pools.mjs --all --json       # 全量 JSON（供比对）
 *   node scripts/report-tier-pools.mjs --locale en        # 英文卷口径
 *
 * 只读本地产物，不联网、不写文件（除 --json 打印到 stdout）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const LOCALE = String(args.locale || 'zh').toLowerCase()
const ONLY = String(args.country || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const AS_JSON = !!args.json

/** 与 src/core/difficulty.ts TIERS 对齐（改那边必须改这里） */
const TIER_BANDS = [
  { key: 'L1', max: 7 },
  { key: 'L2L3', max: 8 },
  { key: 'L4L5', max: 9 },
  { key: 'L6', max: 10 },
]

const readJson = async (p) => {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    return null
  }
}

const dataDir = path.join(ROOT, 'public/data')
const meta = await readJson(path.join(dataDir, 'manifest-meta.json'))
const dist = await readJson(path.join(dataDir, 'species-distribution.json'))
const tierIndex = await readJson(path.join(dataDir, 'province-commonness.json'))
if (!meta || !dist || !tierIndex) {
  console.error('❌ 缺少 manifest-meta / species-distribution / province-commonness 索引')
  process.exit(1)
}

/** 物种 id → 短码（带 avibase- 前缀剥离） */
const codeOf = new Map()
const byId = new Map()
for (const s of meta.species) {
  byId.set(s.id, s)
  if (s.taxonKey) codeOf.set(s.id, String(s.taxonKey).replace(/^avibase-/, ''))
}

/** 命名体系过滤（与 questionEngine.usableInNameMode 一致） */
function hasName(s) {
  if (LOCALE === 'sci') return !!s.nameSci
  if (LOCALE === 'en') return !!s.nameEn
  return !!s.nameZh
}

/** 可玩 + 未降级 + 有名字 */
const eligible = new Set()
for (const s of meta.species) {
  if (!s.playableImage) continue
  if (s.quizExcluded) continue
  if (!hasName(s)) continue
  eligible.add(s.id)
}

/** CN 的港澳台并集语义（与 globalPool.floraCountriesOf 一致） */
const CN_SUB = ['TW', 'HK', 'MO']
const floraCache = new Map()
function floraFor(cc) {
  if (floraCache.has(cc)) return floraCache.get(cc)
  const codes = new Set(dist.byCountry?.[cc] ?? [])
  if (cc === 'CN') for (const sub of CN_SUB) for (const c of dist.byCountry?.[sub] ?? []) codes.add(c)
  floraCache.set(cc, codes)
  return codes
}

/** 国家码列表（⑥ 索引里实际存在的国家） */
const tierFiles = tierIndex.sharding?.files ?? []
const countries = [
  ...new Set(
    tierFiles.map((f) => (f.endsWith('.country.json') ? f.slice(0, -13) : f.slice(0, -5))),
  ),
].sort()

const targets = ONLY.length ? countries.filter((c) => ONLY.includes(c)) : countries

const rows = []
const problems = []

for (const cc of targets) {
  const provinceShard = await readJson(path.join(dataDir, 'province-commonness', `${cc}.json`))
  const countryShard = await readJson(path.join(dataDir, 'province-commonness', `${cc}.country.json`))
  if (!provinceShard && !countryShard) continue

  const flora = floraFor(cc)

  // ── 国家级口径 ──
  const countryTiers = countryShard?.tiers ?? null
  const buildRow = (label, tierMap, scopedIds) => {
    if (!tierMap) return null
    const pools = {}
    for (const band of TIER_BANDS) {
      let n = 0
      for (const id of scopedIds) {
        const t = tierMap[id]
        if (t != null && t <= band.max) n++
      }
      pools[band.key] = n
    }
    const base = pools.L6
    return {
      level: label,
      base,
      pools,
      /** 实测覆盖率（相对该档位表内可玩种数，不是配置值） */
      pct: Object.fromEntries(
        TIER_BANDS.map((b) => [b.key, base ? Math.round((pools[b.key] / base) * 100) : 0]),
      ),
    }
  }

  const scopeCountry = countryTiers ? Object.keys(countryTiers) : [].filter((id) => {
    if (!eligible.has(id)) return false
    const code = codeOf.get(id)
    return code ? flora.has(code) : false
  })
  const countryRow = countryTiers ? buildRow('country', countryTiers, scopeCountry) : null

  rows.push({
    cc,
    hasProvince: !!provinceShard,
    hasCountry: !!countryShard,
    provinceCount: provinceShard ? Object.keys(provinceShard.tiersByCode ?? {}).length : 0,
    country: countryRow,
  })

  // ── 异常检测 ──
  if (provinceShard) {
    const codes = Object.keys(provinceShard.tiersByCode ?? {})
    for (const code of codes) {
      const map = provinceShard.tiersByCode[code]
      const bands = new Set(Object.values(map))
      if (bands.size !== 10) {
        problems.push(`${cc} ${code}: 档位数 ${bands.size} ≠ 10`)
      }
    }
    if (!codes.length) problems.push(`${cc}: province 分片无省码`)
  }
  if (countryRow) {
    const { pools } = countryRow
    if (pools.L1 === pools.L6 && pools.L6 > 10) {
      problems.push(`${cc}: L1 池 == L6 池 (${pools.L6}) → 档位未生效`)
    }
    if (!(pools.L1 <= pools.L2L3 && pools.L2L3 <= pools.L4L5 && pools.L4L5 <= pools.L6)) {
      problems.push(
        `${cc}: 档位池非单调 L1=${pools.L1} L23=${pools.L2L3} L45=${pools.L4L5} L6=${pools.L6}`,
      )
    }
  }
  if (!countryRow && !provinceShard) problems.push(`${cc}: 两个分片都读不到`)
}

if (AS_JSON) {
  console.log(JSON.stringify({ locale: LOCALE, generatedAt: new Date().toISOString(), rows, problems }, null, 2))
  process.exit(problems.length ? 1 : 0)
}

// ── 文本报告 ──
const withCountry = rows.filter((r) => r.country)
console.log(
  `口径：${LOCALE} · 有国级档位表 ${withCountry.length} 国 · 有省级分片 ${rows.filter((r) => r.hasProvince).length} 国`,
)
console.log('\n国家/地区      L6+基数   L1(≤7)   L2/3(≤8)  L4/5(≤9)   实测%')
console.log('-'.repeat(78))
for (const r of withCountry.slice(0, 40)) {
  const c = r.country
  console.log(
    `${r.cc.padEnd(4)}${r.hasProvince ? ' (省)' : '     '}`.padEnd(14) +
      String(c.base).padStart(7) +
      `${c.pools.L1} (${c.pct.L1}%)`.padStart(12) +
      `${c.pools.L2L3} (${c.pct.L2L3}%)`.padStart(13) +
      `${c.pools.L4L5} (${c.pct.L4L5}%)`.padStart(13) +
      `  ${c.pct.L6}%`.padStart(8),
  )
}
if (withCountry.length > 40) console.log(`… 其余 ${withCountry.length - 40} 国`)

// 百分比分布（判断"如实写"的合理范围）
const dist1 = new Map()
for (const r of withCountry) {
  const p = r.country.pct.L1
  dist1.set(p, (dist1.get(p) ?? 0) + 1)
}
console.log('\nL1 实测百分比分布：', [...dist1.entries()].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${p}%×${n}`).join('  '))

console.log(`\n异常：${problems.length} 条`)
for (const p of problems.slice(0, 40)) console.log('  ✗', p)
if (problems.length > 40) console.log(`  … 其余 ${problems.length - 40} 条`)

process.exit(problems.length ? 1 : 0)
