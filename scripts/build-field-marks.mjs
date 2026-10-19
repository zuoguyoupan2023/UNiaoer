#!/usr/bin/env node
/**
 * 064 · 叙述文本生成（zh）：「结构化事实 → 只做措辞」
 *
 * 依据：`docs/053-describe §11.6`（形态与三条硬规则）+ `§11.5b`（① 人话默认显示）。
 *
 * 输入（全部是已产出的结构化事实，不联网）：
 *   public/data/traits/*.json        详情层分片（byTaxonKey：habitats/systems/diet/foraging/morph/eco）
 *   public/data/manifest-meta.json   权威层（taxonKey ↔ speciesId、profile.migration/habitatCodes）
 *   public/data/iucn-habitat-codes.json  生境码表（code → zhShort）
 *
 * 输出：`data/field-marks.json`（提交物，仿 `data/iucn-habitats.json` 的定位）
 *   { byTaxonKey: { "<taxonKey>": { zh, basedOn, textSources } } }
 *
 * 三条硬规则（与门禁一一对应）：
 *   1) 数字必须与输入一致 —— 本引擎**所有数字都直接取自输入**（不计算、不四舍五入到别的值）；
 *   2) 只说输入里有的话 —— 没有的字段直接不提（不猜、不补）；
 *   3) 标注非权威 + 纠错入口 —— 每条带 `textSources`。
 *
 * ⚠️ 引擎是**确定性中文合成**（engine: composed-zh-v1），不是自由生成 ——
 *    从构造上不可能编造事实。若将来换大模型，只需替换 compose()，产物形状与门禁不变。
 *
 * 用法：
 *   node scripts/build-field-marks.mjs                 # 全量
 *   node scripts/build-field-marks.mjs --limit 12      # 冒烟（前 12 个有料的种）
 *   node scripts/build-field-marks.mjs --ids pica-serica,calidris-tenuirostris
 *   node scripts/build-field-marks.mjs --print         # 只打印样例，不写文件
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const LIMIT = Number(args.limit || 0)
const IDS = String(args.ids || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const PRINT_ONLY = !!args.print
const OUT = path.resolve(ROOT, args.out || 'data/field-marks.json')

/** 中文标签：与 `src/i18n/locales/zh-CN.ts` 的 `species.traits.*` 保持同词（i18n:check 不覆盖脚本，靠此处人工对齐） */
const DIET_ZH = {
  invert: '无脊椎动物',
  vert: '脊椎动物',
  ectVert: '变温脊椎动物',
  fish: '鱼类',
  unkVert: '未知脊椎动物',
  scav: '腐肉',
  fruit: '果实',
  nect: '花蜜',
  seed: '种子',
  plantOther: '其他植物',
}
const FORAGE_ZH = {
  waterBelowSurface: '水下',
  waterAroundSurface: '水面',
  ground: '地面',
  understory: '下层',
  midHigh: '中层',
  canopy: '冠层',
  aerial: '空中',
}
/** 居留型：profile.migration → 中文（未知值一律**不提**） */
const MIGRATION_ZH = {
  resident: '留鸟',
  breeding: '繁殖季候鸟',
  nonbreeding: '越冬候鸟',
  nonBreeding: '越冬候鸟',
  winter: '越冬候鸟',
  passage: '旅鸟',
  vagrant: '迷鸟',
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** 取前 n 项（值降序）；阈值以下的不提（避免「无脊椎动物 2%」这种噪声） */
function top(list, n, floor) {
  return Object.entries(list || {})
    .filter(([, v]) => isNum(v) && v >= floor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

/** 「A、B与C」式中文并列 */
function joinZh(items) {
  if (items.length <= 1) return items[0] || ''
  if (items.length === 2) return `${items[0]}与${items[1]}`
  return `${items.slice(0, -1).join('、')}与${items[items.length - 1]}`
}

/**
 * 把一只鸟的结构化事实写成 1–2 句中文。
 * 只使用传入的字段；缺就不提（硬规则 2）。
 */
function compose({ codes, traits, profile }) {
  const basedOn = []
  const s1 = []
  const s2 = []

  // ── 句 1：居留型 + 生境 ──
  const migr = MIGRATION_ZH[String(profile?.migration || '')]
  const habNames = (profile?.habitatCodes || [])
    .map((c) => codes?.codes?.[c]?.zhShort)
    .filter(Boolean)
  const uniqHab = [...new Set(habNames)].slice(0, 4)
  if (uniqHab.length) {
    basedOn.push('iucn')
    s1.push(`见于${joinZh(uniqHab)}`)
  }
  // systems（Terrestrial / Freshwater / Marine）只在生境标签缺失时兜底
  if (!uniqHab.length && traits?.systems?.length) {
    const sysZh = { Terrestrial: '陆地', Freshwater: '淡水', Marine: '海洋' }
    const names = traits.systems.map((s) => sysZh[s.en]).filter(Boolean)
    if (names.length) {
      basedOn.push('iucn')
      s1.push(`见于${joinZh(names)}环境`)
    }
  }

  // ── 句 2：食性 + 取食层次 + 体重 ──
  const diet = top(traits?.diet, 4, 10)
  if (diet.length) {
    basedOn.push('elton')
    const vals = diet.map(([, v]) => Math.round(v))
    const names = diet.map(([k]) => DIET_ZH[k]).filter(Boolean)
    if (diet.length >= 3 && vals.every((v) => v === vals[0])) {
      // 并列（如红耳鹎 5 项各 20%）：不写"以…为主"，避免误导
      s2.push(`食性较杂：${joinZh(names)}各占${vals[0]}%`)
    } else if (diet.length === 1) {
      s2.push(`主食${names[0]}（${vals[0]}%）`)
    } else {
      s2.push(`食性以${names[0]}为主（${vals[0]}%），也吃${joinZh(names.slice(1))}`)
    }
  }
  const forage = top(traits?.foraging, 2, 20)
  if (forage.length) {
    basedOn.push('elton')
    s2.push(`多在${joinZh(forage.map(([k]) => FORAGE_ZH[k]).filter(Boolean))}活动`)
  }
  if (traits?.nocturnal === true) {
    basedOn.push('elton')
    s2.push('夜行性')
  }
  const massG = traits?.morph?.massG
  if (isNum(massG)) {
    basedOn.push('avonet')
    // 保留 1 位小数：**不做整数四舍五入**，保证「数字与输入一致」（6.5 g 不写成 7 g）
    s2.push(`体重约${Math.round(massG * 10) / 10} g`)
  }

  const parts = []
  const head = migr ? `${migr}，` : ''
  if (s1.length) parts.push(`${head}${s1.join('，')}。`)
  else if (migr) parts.push(`${migr}。`)
  if (s2.length) parts.push(`${s2.join('，')}。`)

  const zh = parts.join('')
  if (!zh) return null
  return {
    zh,
    basedOn: [...new Set(basedOn)],
  }
}

async function main() {
  const codes = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/iucn-habitat-codes.json'), 'utf8'))
  const meta = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest-meta.json'), 'utf8'))
  const species = meta.species || []

  // 详情层：把 125 个分片按 taxonKey 汇总（只读需要的字段）
  const traitsDir = path.join(ROOT, 'public/data/traits')
  const files = (await fs.readdir(traitsDir)).filter((f) => f.endsWith('.json'))
  const byTaxonKey = new Map()
  for (const f of files) {
    const d = JSON.parse(await fs.readFile(path.join(traitsDir, f), 'utf8'))
    for (const [k, v] of Object.entries(d.byTaxonKey || {})) byTaxonKey.set(k, v)
  }

  const sources = [
    {
      key: 'iucn-redlist-v4',
      name: 'IUCN Red List of Threatened Species (API v4)',
      license: 'IUCN Red List terms of use（非商业使用；须引用）',
      attribution: 'IUCN Red List of Threatened Species',
    },
    {
      key: 'elton-traits-1.0',
      name: 'EltonTraits 1.0',
      license: 'CC BY（学术引用）',
      attribution: 'Wilman et al. 2014, Ecology',
    },
    {
      key: 'avonet-2022',
      name: 'AVONET',
      license: 'CC BY 4.0',
      attribution: 'Tobias et al. 2022, Ecology Letters',
    },
  ]

  const out = {}
  const engine = 'composed-zh-v1'
  let made = 0
  let skippedNoSource = 0
  const samples = []

  for (const sp of species) {
    const tk = sp.taxonKey
    if (!tk) continue
    if (IDS.length && !IDS.includes(sp.id) && !IDS.includes(tk)) continue
    const traits = byTaxonKey.get(tk) || null
    const profile = sp.profile || null
    const hasFacts = !!(profile?.habitatCodes?.length || traits)
    if (!hasFacts) {
      skippedNoSource++
      continue
    }
    const r = compose({ codes, traits, profile })
    if (!r) {
      skippedNoSource++
      continue
    }
    out[tk] = {
      zh: r.zh,
      basedOn: r.basedOn,
      textSources: [
        { field: 'zh', source: 'ai-generated', engine, basedOn: r.basedOn, license: 'project', note: '由公开结构化数据合成，非权威，仅供参考' },
      ],
    }
    made++
    if (samples.length < 12) samples.push({ name: sp.nameZh || sp.nameSci, id: sp.id, zh: r.zh })
    if (LIMIT && made >= LIMIT) break
  }

  if (PRINT_ONLY || LIMIT || IDS.length) {
    console.log(`\n样例（engine=${engine}）：`)
    for (const s of samples) console.log(`\n· ${s.name}  (${s.id})\n  ${s.zh}`)
  }

  if (!PRINT_ONLY) {
    const doc = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      engine,
      note: '叙述文本：由结构化事实（IUCN/EltonTraits/AVONET）合成，只做措辞不做事实；非权威，欢迎纠错。',
      sources,
      count: made,
      byTaxonKey: out,
    }
    await fs.mkdir(path.dirname(OUT), { recursive: true })
    await fs.writeFile(OUT, JSON.stringify(doc))
    console.log(`\n✅ ${path.relative(ROOT, OUT)}：${made} 条（无可用事实跳过 ${skippedNoSource}）`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
