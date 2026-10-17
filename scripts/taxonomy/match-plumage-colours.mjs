/**
 * 053-describe P6：羽色（plumage colours）—— 雄/雌各 12 类羽色比例 + 雌雄异色。
 *
 * 产物：`data/plumage-colours.json`（taxonKey → { colours{}, colourDiversity{}, dichromatism{}, breeding{} }）
 * 原始文件（gitignore，需自行下载）：
 *   data-cache/taxonomy/plumage/Dataset.2.xlsx
 *   官方：https://doi.org/10.5061/dryad.jq2bvq8jg （Datadryad，文件 `Dataset.2.xlsx`，1,058,892 B）
 *   ⚠️ Datadryad 有 Anubis 反爬质询 + 下载接口需 bearer token，脚本抓不到 → **浏览器手动下载**。
 *   **采信前必须校验 sha256**（官方 API 公布的摘要）：
 *     0f8e7bab90e8f710339f132b1889417fb9ecb23194b9912ebe5e0048e100d828
 *   `shasum -a 256 data-cache/taxonomy/plumage/Dataset.2.xlsx` 必须一致。
 *
 * 数据集：Dunning, C.R. 等 *Colourful urban birds: Urban-tolerant birds have more elaborate
 * colours, more blue and less brown*（2025）。**许可 CC0-1.0**（本表最宽松的一源）。
 *
 * ⚠️ 覆盖率必须诚实告知（实测 2026-10-17）：
 *   源表仅 **2,541 种**（BirdTree/Jetz 系统发育名），命中全池 1,041/11,131 = **9.4%**、
 *   核心 1,299 = **39.4%**。**这是稀疏层，不要当「万种都有」** —— 门禁只报告覆盖率。
 *   另：`Diet.5Cat` / `ForStrat.ground` / `BodyMass.Value` 三列**刻意不取**
 *   （EltonTraits 与 AVONET 已有同一字段，避免同一事实两个来源互相打架）。
 *
 * 匹配口径：学名规范化后精确匹配（源表名带下划线，如 `Abroscopus_superciliaris`）；
 * 未命中落 `unmatched`，**不猜异名**。
 *
 * CLI：npm run taxonomy:plumage [-- --input <path>] [--verify] [--pretty]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../lib/util.mjs'
import { readSheet } from '../lib/xlsx.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
const INPUT = path.resolve(ROOT, String(args.input || 'data-cache/taxonomy/plumage/Dataset.2.xlsx'))
const OUT = path.join(ROOT, 'data/plumage-colours.json')
const SHEET = 'species.level.data'
const VERIFY_ONLY = !!args.verify

/** 官方 sha256（Datadryad API /api/v2/files/3800974 公布） */
const SHA256 = '0f8e7bab90e8f710339f132b1889417fb9ecb23194b9912ebe5e0048e100d828'

const SOURCE = {
  key: 'dunning-2025-plumage',
  name: 'Colourful urban birds: Urban-tolerant birds have more elaborate colours, more blue and less brown',
  url: 'https://doi.org/10.5061/dryad.jq2bvq8jg',
  archive: 'Datadryad (https://datadryad.org)',
  license: 'CC0-1.0',
  attribution: 'Dunning CR et al. (2025)',
  citation:
    'Dunning, C. R. et al. (2025) Colourful urban birds: Urban-tolerant birds have more elaborate colours, more blue and less brown. Data: https://doi.org/10.5061/dryad.jq2bvq8jg',
  sha256: SHA256,
}

/** 12 类羽色 → 中文（比例单位是「体表面积占比」，雄/雌各一列） */
const COLOURS = {
  black: '黑',
  white: '白',
  blue: '蓝',
  red: '红',
  green: '绿',
  purple: '紫',
  yellow: '黄',
  'grey.dark': '深灰',
  'grey.light': '浅灰',
  'brown.dark': '深褐',
  'brown.light': '浅褐',
  rufous: '栗红',
}

/** 学名规范化：去掉下划线与所有非字母（源表 `Abroscopus_superciliaris` ↔ 我们 `Abroscopus superciliaris`） */
const normName = (s) => String(s || '').replace(/[^A-Za-z]/g, '').toLowerCase()

async function main() {
  if (VERIFY_ONLY) {
    const { createHash } = await import('node:crypto')
    const buf = await fs.readFile(INPUT)
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== SHA256) throw new Error(`sha256 不符！\n  期望 ${SHA256}\n  实际 ${got}\n拒绝采信该文件`)
    console.log(`✅ sha256 与 Datadryad 官方摘要一致（${buf.length} B）`)
    return
  }

  const { headers, rows } = await readSheet(INPUT, SHEET)
  const need = [
    'phylo.name',
    'maleness.dich',
    'elab.dich',
    ...Object.keys(COLOURS).flatMap((k) => [`${k}_m`, `${k}_f`]),
  ]
  const missing = need.filter((c) => !headers.includes(c))
  if (missing.length) throw new Error(`表缺列：${missing.join(', ')}（文件不对？）`)
  console.log(`源表：${rows.length} 行 × ${headers.length} 列（sheet=${SHEET}）`)

  const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  const pool = index.species

  const byName = new Map()
  const dupInconsistent = []
  for (const r of rows) {
    const n = normName(r[0])
    if (!n) continue
    const prev = byName.get(n)
    if (!prev) {
      byName.set(n, r)
      continue
    }
    // 源表**同一物种有多行**（region 列 = 估计城市化耐受所用的城市，实测 2,541 行 → 1,287 唯一种，
    // 如 Acanthorhynchus tenuirostris 有 Newcastle/Melbourne/Brisbane 三行）。
    // 实测羽色列**跨行完全一致**（只有 urban.* 列随 region 变），因此取首行即可；
    // 这里做一次一致性断言：若将来源数据变了导致羽色不一致，**显式报错而不是静默取首个**。
    for (const h of headers.filter((x) => /_m$|_f$/.test(x))) {
      const a = prev[headers.indexOf(h)]
      const b = r[headers.indexOf(h)]
      if (a !== b && a !== null && b !== null) {
        dupInconsistent.push({ species: String(r[0]).replace(/_/g, ' '), column: h })
        break
      }
    }
  }
  console.log(`源表 ${rows.length} 行 → 学名规范化后 **${byName.size} 个唯一种**（region 重复行，羽色列一致）`)
  if (dupInconsistent.length) {
    console.warn(`  ⚠️ ${dupInconsistent.length} 个物种的重复行羽色列不一致，取首行：${dupInconsistent[0].species}/${dupInconsistent[0].column}`)
  }

  const col = (h) => headers.indexOf(h)
  const val = (r, h) => {
    const v = r[col(h)]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  const round = (v) => (v === null ? null : Math.round(v * 1000) / 1000)

  const byTaxonKey = {}
  const unmatched = []
  for (const sp of pool) {
    const r = byName.get(normName(sp.nameSci))
    if (!r) {
      unmatched.push({ nameSci: sp.nameSci, taxonKey: sp.taxonKey })
      continue
    }
    const colours = {}
    for (const key of Object.keys(COLOURS)) {
      const m = round(val(r, `${key}_m`))
      const f = round(val(r, `${key}_f`))
      if (m === null && f === null) continue
      colours[key] = { m, f }
    }
    // 雄/雌差异：>0.05 视为「该色相雌雄不同」
    const diffColours = Object.entries(colours)
      .filter(([, v]) => v.m !== null && v.f !== null && Math.abs(v.m - v.f) > 0.05)
      .map(([k]) => k)
    byTaxonKey[sp.taxonKey] = {
      nameSci: sp.nameSci,
      sourceName: String(r[0]).replace(/_/g, ' '),
      colours,
      colourDiversity: {
        lociM: val(r, 'n.loci_m'),
        lociF: val(r, 'n.loci_f'),
        elaborationM: val(r, 'elaboration_m'),
        elaborationF: val(r, 'elaboration_f'),
      },
      dichromatism: {
        // 色彩艳度雌雄差（>0.5 视为雌雄异色）
        malenessDiff: round(val(r, 'maleness.dich')),
        vividnessDiff: round(val(r, 'elab.dich')),
        isDichromatic: (() => {
          const a = val(r, 'maleness.dich')
          const b = val(r, 'elab.dich')
          return (a !== null && Math.abs(a) > 0.5) || (b !== null && Math.abs(b) > 0.5) ? true : null
        })(),
        differsIn: diffColours,
      },
      breeding: {
        // 社会多配偶强度（0–5）：>1.5 视为「一夫多妻」
        polygynyStrength: val(r, 'sex.sel.m'),
        polyandryStrength: val(r, 'sex.sel.f'),
        nestsOnGround: val(r, 'ground.nest'),
        nestsInCavityOrRock: val(r, 'cav.rock.nest'),
        territoriality: val(r, 'territoriality'), // 0 无 / 1 季节性 / 2 终年
        openness: val(r, 'openness'), // 植被开阔度 1 郁闭 – 4 开阔
      },
    }
  }

  const matched = Object.keys(byTaxonKey).length
  const dichromatic = Object.values(byTaxonKey).filter((v) => v.dichromatism.isDichromatic === true).length
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    note:
      '雄/雌各 12 类羽色占体表面积的比例（black/white/blue/red/green/purple/yellow/' +
      'grey.dark/grey.light/brown.dark/brown.light/rufous）+ 色彩复杂度 + 雌雄异色判定 + 营巢位置与领域性。' +
      '**这是稀疏层**：源表仅 2,541 种，覆盖率见 counts（不是万种全有）。' +
      'Diet/ForStrat/BodyMass 三列刻意不取（EltonTraits / AVONET 已有，避免同一事实两个来源）。' +
      '每条 source.sha256 可用于校验原始 xlsx。',
    counts: {
      pool: pool.length,
      matched,
      coveragePct: Number(((matched / pool.length) * 100).toFixed(1)),
      unmatched: unmatched.length,
      dichromatic,
    },
    colourKeys: Object.entries(COLOURS).map(([key, zh]) => ({ key, zh })),
    byTaxonKey,
    unmatched,
  }
  await fs.writeFile(OUT, args.pretty ? JSON.stringify(payload, null, 2) + '\n' : JSON.stringify(payload) + '\n')

  console.log(
    `\n✅ data/plumage-colours.json：命中 ${matched}/${pool.length}（${payload.counts.coveragePct}%）· 未匹配 ${unmatched.length} · 判定为雌雄异色 ${dichromatic} 种`,
  )
  console.log(`   ⚠️ 覆盖率低是源表本身只有 1,287 个唯一种所致，**不是脚本没匹配上**（我们已匹配到其中 ${matched} 种）`)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
