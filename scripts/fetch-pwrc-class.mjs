#!/usr/bin/env node
/**
 * 051 S2：导入 **USGS PWRC（美国鸟类环志实验室）物种组** → 生活型六分法台账。
 *
 * ## 为什么是它
 * 六分法是习惯分类、没有权威标准，但**确实存在可引用的公开物种组划分**。本项目评估过：
 *
 * | 候选来源 | 可用性 | 结论 |
 * |---|---|---|
 * | **USGS PWRC species groups**（Bird Banding Laboratory） | 公开页面可解析；40 个组（Waterfowl / shorebirds / Raptors / Owls / Woodpeckers / Passerines / Corvids / …）；**美国联邦政府作品 = 公有领域** | ✅ **采用**（物种级，比科级精确） |
 * | IUCN Red List | 有 Freshwater/Marine/Terrestrial 系统与生境，但那是**生境轴**，不是生活型六分法 | ❌ 轴不同，不可用 |
 * | eBird taxonomy | 无生活型字段 | ❌ |
 * | GitHub 上的 third-party 鸟类数据库 | 无出处、许可不明、体量小（3.5k） | ❌ 不可引用 |
 *
 * ## 映射规则（写进每条记录的 source.note，可审计）
 * 只导入**语义无歧义**的组；有歧义的组**整组放弃**（宁可空着）：
 *   放弃 `Game Birds`（环志口径含鸭雁，与水禽冲突）、`Cavity Nesting Species`（含鸮与啄木鸟，跨类）、
 *        `Terns`（海鸟，游/涉存疑）、`Rails, Gallinules, and Coots`（沼泽鸟，游/涉存疑）。
 *
 * 记录键用**拉丁学名**（物种级），比科级精确得多 —— 不会因为"美洲画眉是林鸟"就污染它同科的非洲姊妹种。
 *
 * ## 用法
 *   node scripts/fetch-pwrc-class.mjs            # 抓取并写入 data/class-records.json
 *   node scripts/fetch-pwrc-class.mjs --dry      # 只打印统计，不写文件
 *   node scripts/fetch-pwrc-class.mjs --prune    # 只删掉本脚本此前导入的记录（保留人工记录）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'data/class-records.json')
/** PWRC 物种组页面（注意：JS 里 `%` 是取模不是 sprintf，这里用模板串） */
const base = (id) =>
  `https://www.pwrc.usgs.gov/BBL/Bander_Portal/login/species_groups_pub.php?p_species_gr=${id}`

/** [组 id, 组名, 六分法取值] —— 只列语义无歧义的组 */
const GROUPS = [
  [1, 'Waterfowl - Ducks, Geese and Swans', 'swimmer'],
  [17, 'Ducks', 'swimmer'],
  [18, 'Geese', 'swimmer'],
  [19, 'Swans', 'swimmer'],
  [920, 'Loons and Grebes', 'swimmer'],
  [23, 'All shorebirds', 'wader'],
  [28, 'Herons, Egrets, Ibis, Spoonbills', 'wader'],
  [7, 'All Raptors Except Eagles', 'raptor'],
  [919, 'Diurnal Raptors except Eagles', 'raptor'],
  [24, 'Owls', 'raptor'],
  [912, 'Woodpeckers', 'climber'],
  [908, 'Passerines and Near-passerines', 'woodland'],
  [914, 'Corvids', 'woodland'],
  [29, 'Sparrows', 'woodland'],
  [26, 'Swallows', 'woodland'],
  [910, 'Flycatchers', 'woodland'],
  [20, 'Doves and Pigeons', 'terrestrial'],
]

/** 明确放弃的组（附原因，写进文档与提交信息，避免以后有人"顺手"把它们加回来） */
const SKIPPED = [
  ['Game Birds', '环志口径含鸭雁等水禽，与 swimmer 冲突'],
  ['Cavity Nesting Species', '含鸮（raptor）与啄木鸟（climber），跨类无唯一解'],
  ['Terns', '海鸟，游/涉存疑'],
  ['Rails, Gallinules, and Coots', '沼泽鸟，游/涉存疑'],
  ['Seabirds / Alcids / Gulls', '海鸟类群，六分法无对应（只有三分类里的"水鸟"）'],
  ['Hummingbirds', '专有类群，攀/林存疑'],
  ['M.A.P.S.', '项目自定义混合集合，无生态含义'],
]

const dry = process.argv.includes('--dry')
const prune = process.argv.includes('--prune')

function parseSpecies(html) {
  const tds = [...html.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) =>
    decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim(),
  )
  const out = new Set()
  for (let i = 1; i < tds.length; i++) {
    const v = tds[i]
    // 表结构：Species ID | Alpha Code | Common Name | Scientific Name | Taxon Order
    if (/^[A-Z][a-z]+(?:-[a-z]+)? [a-z][a-z-]+( [a-z][a-z-]+)?$/.test(v)) out.add(v)
  }
  return [...out]
}
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

async function fetchGroup(id) {
  const res = await fetch(base(id), { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseSpecies(await res.text())
}

const doc = JSON.parse(await fs.readFile(FILE, 'utf8'))
const mine = (r) => r.contributor === 'USGS PWRC（脚本导入）'
const kept = (doc.records || []).filter((r) => !mine(r)) // 人工记录保留

if (prune) {
  doc.records = kept
  await fs.writeFile(FILE, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`✓ 已删除本脚本此前导入的记录，保留人工记录 ${kept.length} 条`)
  process.exit(0)
}

const bySpecies = new Map()
for (const [id, name, g6] of GROUPS) {
  let list = []
  try {
    list = await fetchGroup(id)
  } catch (e) {
    console.error(`✗ 抓取失败 ${name}: ${e.message}`)
    continue
  }
  for (const sci of list) {
    const prev = bySpecies.get(sci)
    if (prev) {
      if (!prev.groups.includes(g6)) prev.groups.push(g6) // 同种落入多个组 → 取并集
      prev.sources.push({ group: name, g6 })
      continue
    }
    bySpecies.set(sci, {
      speciesSci: sci,
      groups: [g6],
      source: {
        type: 'dataset',
        ref: `USGS Bird Banding Laboratory 物种组「${name}」`,
        url: base(id),
        note: 'PUBLIC DOMAIN（美国联邦政府作品）；映射规则：本脚本 GROUPS 表，逐组写明',
      },
      contributor: 'USGS PWRC（脚本导入）',
      at: new Date().toISOString().slice(0, 10),
      status: 'ok',
      sources: [{ group: name, g6 }],
    })
  }
  console.log(`· ${name} → ${g6}：${list.length} 种`)
  await new Promise((r) => setTimeout(r, 400)) // 礼貌限速
}

const records = [...kept, ...bySpecies.values()].sort((a, b) =>
  String(a.speciesSci || a.familySci || '').localeCompare(String(b.speciesSci || b.familySci || '')),
)

// 与权威层对齐：只保留项目里真实存在的物种（其余不入库，避免台账里出现项目外的名字）
let matched = 0
const idx = new Set(
  JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8')).species.map(
    (s) => s.nameSci,
  ),
)
const finalRecords = records.filter((r) => {
  if (!r.speciesSci) return true
  if (idx.has(r.speciesSci)) return true
  matched++
  return false
})
console.log(`· 抓到 ${bySpecies.size} 种，其中 ${matched} 种不在本项目名录（已剔除）`)

doc.records = finalRecords
doc.skippedGroups = SKIPPED.map(([name, why]) => ({ name, why }))
doc.sources = [
  {
    name: 'USGS Bird Banding Laboratory（PWRC）species groups',
    url: 'https://www.pwrc.usgs.gov/BBL/Bander_Portal/species_groups.html',
    license: 'PUBLIC DOMAIN（美国联邦政府作品）',
    usage: '生活型六分法的第一批有出处记录（物种级）',
    coverage: '以北美物种为主；对本项目 10,844 种的覆盖有限，其余留空',
  },
]

if (dry) {
  console.log(`\n[dry] 将写入 ${finalRecords.length} 条记录，跳过组：${SKIPPED.map((s) => s[0]).join(', ')}`)
} else {
  await fs.writeFile(FILE, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(
    `\n✓ 已写入 ${finalRecords.length} 条记录到 data/class-records.json（其中本脚本导入 ${bySpecies.size} 条）`,
  )
  console.log(`  放弃的组：${SKIPPED.map((s) => `${s[0]}（${s[1]}）`).join('；')}`)
}