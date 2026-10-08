#!/usr/bin/env node
/**
 * 036 D-036-7=B：生成**人工审阅清单**（推荐规模：每国 top 20）。
 *
 * 用途：算法只能保证"相对频率"，但 GBIF 有已知系统性偏差（观测努力不均、专项调查、
 * 以及"常见鸟不一定被单独记录"）。本脚本把**最可疑的档位**挑出来，供人工确认是否
 * 写进 `data/region-commonness-overrides.json`（覆盖优先级最高）。
 *
 * 挑出三类：
 *   A. **该省最常见却不在 1 档**（前 10 名里档位 ≥3）——通常是守卫误伤或数据薄；
 *   B. **被守卫剔除**（dominance/spike）的（种,省）——确认是"真的异常"还是"真的常见"；
 *   C. **国内知名常见鸟但档位偏低**（内置 16 种中国常见鸟清单，逐省比对档位 ≥3）——
 *      这一类最接近用户原始诉求（喜鹊/夜鹭/麻雀…被低估）。
 *
 * 输出：控制台表格 + `--out` 指定文件（默认 data-cache/region/out/review.md），
 * 便于人工勾选后手写覆盖项。
 *
 * CLI：
 *   npm run region:review-commonness                 # 全部三类
 *   npm run region:review-commonness -- --kind A     # 只 A 类
 *   npm run region:review-commonness -- --top 30
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const args = parseArgs(process.argv.slice(2))
const TOP = Math.max(5, Number(args.top) || 20)
/**
 * 记录数门槛：低于此值的低档位**通常是正确的**（分布边缘/迷鸟），不算"可疑"。
 * 例：西藏只有 1 条白头鹎记录 → 档位 5 是对的（那是迷鸟）；把它提升为 1 反而错。
 * 只审"记录数足够多却档位偏低"的，才是真正值得人工判断的（默认 100）。
 */
const MIN_RECORDS = Math.max(0, Number(args['min-records']) || 100)
const KIND = String(args.kind || 'ABC').toUpperCase()
const OUT = args.out
  ? path.resolve(ROOT, args.out)
  : path.join(ROOT, 'data-cache/region/out/review-commonness.md')

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'))

/** 中国常见鸟（用户点名 + 同类"人人见"）：档位偏低即高度可疑（C 类） */
const CN_COMMON_BIRDS = [
  '喜鹊', '夜鹭', '麻雀', '白头鹎', '珠颈斑鸠', '乌鸫', '绿头鸭',
  '灰喜鹊', '大山雀', '白鹡鸰', '家燕', '白鹭', '苍鹭', '小䴙䴘', '黑水鸡', '八哥',
]

// ── 载入 ─────────────────────────────────────────────────────────────
const INDEX_FILE = args.product
  ? path.resolve(ROOT, args.product)
  : path.join(ROOT, 'public/data/province-commonness.json')
const product = await readJson(INDEX_FILE)

/**
 * tiers 现在在**分片**里（索引只留元数据，见 docs/036 §8.2）：
 *   <dir>/<CC>.json → tiersByCode[省码][物种] = 档位
 * 这里把分片合并回 { 物种: { 省码: 档位 } } 供审阅使用（与旧版 product.tiers 同形）。
 */
const shardDir = path.join(path.dirname(INDEX_FILE), product.sharding?.dir ?? 'province-commonness')
const tiers = {}
for (const f of product.sharding?.files ?? []) {
  if (!f.endsWith('.json') || f.endsWith('.country.json')) continue
  const shard = await readJson(path.join(shardDir, f)).catch(() => null)
  if (!shard?.tiersByCode) continue
  for (const [code, bySpecies] of Object.entries(shard.tiersByCode)) {
    for (const [spId, tier] of Object.entries(bySpecies)) {
      ;(tiers[spId] ??= {})[code] = tier
    }
  }
}
/** 省级档位表（合并后）——与旧版 product.tiers 同形，供下方各处直接使用 */
const TIERS = tiers
const core = await readJson(path.join(ROOT, 'public/data/manifest-core.json'))
const globalPool = await readJson(path.join(ROOT, 'public/data/manifest-global.min.json'))
const subsRaw = await readJson(path.join(ROOT, 'data-cache/region/iso3166-2/subs.json'))

/** manifest id → 展示名/学名（核心库优先，全球池兜底） */
const nameOf = new Map()
for (const s of core.species || []) nameOf.set(s.id, { zh: s.nameZh, sci: s.nameSci, en: s.nameEn })
for (const s of globalPool.species || []) if (!nameOf.has(s.id)) nameOf.set(s.id, { zh: s.nameZh, sci: s.nameSci, en: s.nameEn })
/** 中文名 → id（C 类用） */
const idByZh = new Map()
for (const [id, n] of nameOf) if (n.zh) idByZh.set(n.zh, id)

const label = (id) => {
  const n = nameOf.get(id)
  return n ? `${n.zh || n.en || n.sci}` : id
}
/** 省码 → 展示名 */
const provinceName = new Map()
for (const divs of Object.values(subsRaw.subdivisions || {})) {
  for (const [code, name] of Object.entries(divs || {})) provinceName.set(code, String(name).split(/[\n!]/)[0].trim())
}
const provLabel = (code) => {
  const raw = provinceName.get(code) ?? code
  try {
    return code.startsWith('CN-') ? raw : raw
  } catch {
    return raw
  }
}

// ── 原始记录（用于 A 类排序与 B 类复核） ─────────────────────────────
const provincesData = await readJson(path.join(ROOT, 'public/data/region-provinces.json'))
/** `${cc}|${code}` → [{ id, n }] 降序 */
const topByProvince = new Map()
const totals = new Map()
for (const [id, byCc] of Object.entries(provincesData.bySpecies || {})) {
  for (const [cc, byCode] of Object.entries(byCc || {})) {
    for (const [code, n] of Object.entries(byCode || {})) {
      const key = `${cc}|${code}`
      totals.set(key, (totals.get(key) || 0) + Number(n))
      if (!topByProvince.has(key)) topByProvince.set(key, [])
      topByProvince.get(key).push({ id, n: Number(n) })
    }
  }
}
for (const list of topByProvince.values()) list.sort((a, b) => b.n - a.n)

const lines = []
const push = (s = '') => lines.push(s)

push('# 省级常见度 · 人工审阅清单')
push('')
push(`> 生成：${new Date().toISOString()} · 每省取前 ${TOP} 名 · 记录数门槛 ≥ ${MIN_RECORDS} · 数据源 region-provinces.json`)
push('>')
push('> **门槛的意义**：记录数很少时低档位通常是**正确的**（分布边缘/迷鸟）。只审"记录数足够却档位偏低"的。')
push('> 用途：勾选需要人工覆盖的（种,省）→ 写入 `data/region-commonness-overrides.json` → 重跑 `npm run region:province-commonness`')
push('')

// ── A 类：该省最常见却不在 1 档（档位 ≥3） ───────────────────────────
if (KIND.includes('A')) {
  push('## A. 该省最常见却档位偏低（前 N 名里档位 ≥3）')
  push('')
  push('| 省 | 物种 | 记录数 | 当前档位 | 建议 |')
  push('|---|---|---|---|---|')
  let count = 0
  for (const [key, list] of [...topByProvince.entries()].sort()) {
    const code = key.split('|')[1]
    const total = totals.get(key) || 0
    if (total < 1000) continue
    for (const { id, n } of list.slice(0, TOP)) {
      if (n < MIN_RECORDS) continue // 记录太少 → 档位噪声大，不入清单
      const tier = TIERS[id]?.[code]
      if (tier == null) continue // 被守卫剔除的走 B 类
      if (tier >= 3) {
        const share = ((n / total) * 100).toFixed(1)
        push(
          `| ${provLabel(code)} | ${label(id)} | ${n.toLocaleString()}（${share}%） | ${tier} | ${tier >= 4 ? '建议提升为 1–2' : '可提升为 1'} |`,
        )
        count++
      }
    }
  }
  push('')
  push(`共 ${count} 条。`)
  push('')
}

// ── B 类：被守卫剔除的（复核"真的异常"还是"真的常见"） ──────────────
if (KIND.includes('B')) {
  push('## B. 被守卫剔除（dominance / spike）——需人工判断')
  push('')
  push('| 省 | 物种 | 记录数 | 该省占比 | 守卫 | 说明 |')
  push('|---|---|---|---|---|---|')
  let count = 0
  for (const rep of product.report?.provinces || []) {
    if (!rep.guardsHit || (rep.guardsHit.dominance === 0 && rep.guardsHit.spike === 0)) continue
    const [, code] = String(rep.key).split('|')
    const list = topByProvince.get(rep.key) || []
    const total = totals.get(rep.key) || 1
    for (const { id, n } of list.slice(0, 3)) {
      const share = n / total
      if (share <= 0.15) break
      // 该种是否被剔除（无档位）
      if (TIERS[id]?.[code] != null) continue
      push(
        `| ${provLabel(code)} | ${label(id)} | ${n.toLocaleString()}（${(share * 100).toFixed(1)}%） | ${(share * 100).toFixed(1)}% | dominance=${rep.guardsHit.dominance},spike=${rep.guardsHit.spike} | ${share > 0.4 ? '疑似单一数据集主导' : '疑似季节尖峰'} |`,
      )
      count++
    }
  }
  push('')
  push(`共 ${count} 条。`)
  push('')
}

// ── C 类：中国常见鸟档位偏低（最接近用户原始诉求） ──────────────────
if (KIND.includes('C')) {
  push('## C. 中国常见鸟的档位核对（应为 1 档）')
  push('')
  push('| 物种 | 省份 | 记录数 | 当前档位 | 备注（含该国排名，用于判断是否真需覆盖） |')
  push('|---|---|---|---|---|')
  const CN_CODES = Object.keys(subsRaw.subdivisions?.CN || {})
  let count = 0
  for (const zh of CN_COMMON_BIRDS) {
    const id = idByZh.get(zh)
    if (!id) continue
    const tiers = TIERS[id] || {}
    for (const code of CN_CODES) {
      const tier = tiers[code]
      const rec = (provincesData.bySpecies?.[id]?.CN?.[code]) ?? 0
      if (rec < MIN_RECORDS) continue // 记录太少 → 低档位本就正确，不入清单
      if (tier == null) {
        if (rec > 0) {
          push(`| ${zh} | ${provLabel(code)} | ${rec.toLocaleString()} | —（被剔除/未分档） | 需人工确认 |`)
          count++
        }
        continue
      }
      if (tier >= 3) {
        // 二次过滤：若该种在本省属于**该国排名中下游**，低档位其实是算法正确输出
        // （例：青海/新疆的灰喜鹊本就罕见），不应误报为"需要提升"。
        const provs = provincesData.bySpecies?.[id]?.CN || {}
        const ranked = Object.entries(provs).sort((a, b) => b[1] - a[1])
        const rank = ranked.findIndex(([c]) => c === code) + 1
        const pct = ranked.length ? rank / ranked.length : 1
        if (pct > 0.6) continue // 中下游 → 低档位合理，不入清单
        push(
          `| ${zh} | ${provLabel(code)} | ${rec.toLocaleString()} | ${tier} | 该国排名 ${rank}/${ranked.length}（偏前）→ 建议提升 |`,
        )
        count++
      }
    }
  }
  push('')
  push(`共 ${count} 条。`)
  push('')
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, lines.join('\n'))
console.log(`✓ 审阅清单 → ${path.relative(ROOT, OUT)}（${lines.length} 行）`)
console.log(lines.filter((l) => l.startsWith('共 ')).join('　'))
