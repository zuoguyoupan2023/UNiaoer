/**
 * 023 P1-b:GBIF backbone 物种匹配(v2 批量 /species/match)纯函数(不碰网络/文件系统,可单测)。
 *
 * 重要口径(2026-10-03 澄清):manifest/taxa.json 的 `taxonId` 是 **iNaturalist taxon ID**
 * (build-taxa 从 iNat 榜单按 taxon_id 抓取),并非 GBIF backbone 键 —— 早期文档(023 §2)表述有误,
 * P0 曾据此误填骨架 backboneTaxonId。P1-b 起骨架 `backboneTaxonId` 统一取当前 GBIF backbone
 * (v2 match,全体重建),iNat 身份改落正确字段 `inatTaxonId`(仅精确同学名的 bank 概念)。
 *
 * 语义:backboneTaxonId = 该 AviList 概念在 backbone 中的**种级**键:
 *   - usage.rank=SPECIES 且非同异名 → usage.key
 *   - synonym → acceptedUsage.key(接受名)
 *   - usage.rank=SUBSPECIES → acceptedUsage.key(backbone 视其为亚种,归到接受种)
 *   - 其余(HIGHERRANK/GENUS/NONE)→ 不臆造,留空
 */

/** 单条 v2 match 结果 → { key, via } | { key: null, via } */
export function pickBackboneKey(m) {
  const diag = m?.diagnostics || {}
  const u = m?.usage || {}
  const acc = m?.acceptedUsage || {}
  if (diag.matchType === 'NONE' || (!u.key && !acc.key)) return { key: null, via: 'none' }
  if (m.synonym && acc.key) return { key: Number(acc.key), via: 'accepted' }
  if (u.rank === 'SPECIES' && u.key) return { key: Number(u.key), via: 'species' }
  if (u.rank === 'SUBSPECIES' && acc.key) return { key: Number(acc.key), via: 'accepted' }
  return { key: null, via: `unmatched:${diag.matchType || '?'}` }
}

/**
 * 请求名数组 + v2 返回数组(按请求顺序对齐,GBIF 契约)→ { byName, mismatches }。
 * 对齐校验:EXACT 结果的 usage.canonicalName 应与请求名一致(大小写不敏感);
 * 不一致不中断,记入 mismatches 供人工复核(可能为正字法变体)。
 */
export function parseMatchBatch(names, results) {
  if (!Array.isArray(results) || results.length !== names.length) {
    throw new Error(`gbif-match: 批量结果数(${Array.isArray(results) ? results.length : '非数组'})与请求数(${names.length})不对齐`)
  }
  const byName = {}
  const mismatches = []
  names.forEach((name, i) => {
    const r = results[i]
    const pick = pickBackboneKey(r)
    byName[name] = pick
    const canon = r?.usage?.canonicalName
    // 仅对实际取键的条目做正字法交叉(HIGHERRANK 等未取键的属级回退无意义)
    if (pick.key != null && canon && canon.toLowerCase() !== String(name).toLowerCase()) {
      mismatches.push({ name, canonicalName: canon, key: pick.key })
    }
  })
  return { byName, mismatches }
}
