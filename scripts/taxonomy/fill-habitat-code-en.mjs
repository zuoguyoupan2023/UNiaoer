#!/usr/bin/env node
/**
 * 给 `data/iucn-habitat-codes.json` 补英文（`en` 全称 / `enShort` 短标签）。
 *
 * 背景（064 追问）：码表是**中文本地化层**，只有 zh/zhShort；而 IUCN 的英文原版一直都在
 * `data/iucn-habitats.json` 的 `habitats[].en` 里（从未丢弃）。本脚本把英文**派生**回码表，
 * 供：
 *   ① 英文界面显示生境标签（此前 en 会回退成中文）；
 *   ② `064` 的**英文叙述文本**合成。
 *
 * 派生规则（`enShort` 取"更有信息量"的那段）：
 *   "Forest - Subtropical/Tropical Moist Lowland" → 后半段 "Subtropical/Tropical Moist Lowland"
 *   "Wetlands (inland) - Bogs, Marshes, Swamps, Fens, Peatlands"（后半段过长）→ 前半段 "Wetlands (inland)"
 *   无 " - " 分隔 → 整串
 *
 * 幂等：已有 `en`/`enShort` 的 code 不覆盖；`--force` 可强制重算。
 *
 * 用法：node scripts/taxonomy/fill-habitat-code-en.mjs [--force]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '../lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
const FORCE = !!args.force
const CODES = path.join(ROOT, 'data/iucn-habitat-codes.json')
const HABITATS = path.join(ROOT, 'data/iucn-habitats.json')
const SHORT_MAX = 40

function shortOf(en) {
  const parts = String(en).split(' - ')
  if (parts.length < 2) return String(en)
  const before = parts[0]
  const after = parts.slice(1).join(' - ')
  return after.length <= SHORT_MAX ? after : before
}

async function main() {
  const codes = JSON.parse(await fs.readFile(CODES, 'utf8'))
  const habitats = JSON.parse(await fs.readFile(HABITATS, 'utf8'))

  // code → 出现过的英文串（同一 code 的英文串应当唯一；不唯一时取出现次数最多者）
  const seen = new Map()
  for (const entry of Object.values(habitats.byTaxonKey || {})) {
    for (const h of entry?.habitats || []) {
      if (!h?.code || !h?.en) continue
      const m = seen.get(h.code) || new Map()
      m.set(h.en, (m.get(h.en) || 0) + 1)
      seen.set(h.code, m)
    }
  }

  let filled = 0
  let kept = 0
  const missing = []
  for (const [code, v] of Object.entries(codes.codes || {})) {
    const candidates = seen.get(code)
    if (!candidates || !candidates.size) {
      missing.push(code)
      continue
    }
    if (!FORCE && v.en && v.enShort) {
      kept++
      continue
    }
    const best = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (FORCE || !v.en) v.en = best
    if (FORCE || !v.enShort) v.enShort = shortOf(best)
    filled++
  }

  codes.enrichedAt = new Date().toISOString()
  codes.note = String(codes.note || '').includes('英文')
    ? codes.note
    : `${codes.note || ''}\n英文（en 全称 / enShort 短标签）由 scripts/taxonomy/fill-habitat-code-en.mjs 从 data/iucn-habitats.json 派生，勿手改。`

  await fs.writeFile(CODES, JSON.stringify(codes, null, 2) + '\n')
  console.log(`✅ 码表英文：填入 ${filled} 条 · 已有保留 ${kept} 条`)
  if (missing.length) console.warn(`  ⚠️ ${missing.length} 个 code 在 iucn-habitats 里没有英文可派生：${missing.slice(0, 10).join(', ')}`)
  const bad = Object.entries(codes.codes || {}).filter(([, v]) => !v.en || !v.enShort)
  if (bad.length) throw new Error(`仍有 ${bad.length} 条缺英文：${bad.slice(0, 5).map(([c]) => c).join(', ')}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
