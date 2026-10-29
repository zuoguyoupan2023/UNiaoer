/**
 * 036：地区（省级）常见度 —— 纯函数库。
 *
 * 目标：把「GBIF 省级观测记录数」变成**可信的省内相对频率档位**（1 最常见 … 5 稀有），
 * 供 L1–L3 按地区出题时替代全局 commonness（docs/036 §2）。
 *
 * 三步（缺一不可，见 docs/036 §1.3 实测）：
 *   ① 份额归一：share(s,P) = n(s,P) / P 的**全部**记录数（含未匹配到骨架的物种）
 *      —— 消掉各省"观测努力"差异（北京 157 万条 vs 某县 800 条不能直接比）。
 *   ② 异常守卫：GBIF 记录受单一数据集主导时不是丰度信号（实测：蒙古沙鸻占香港 94.7%、
 *      占北京 51.3%；358 省中 107 省 top1 份额 > 40%）。两类守卫：
 *      · dominance：单省单种份额 > 40% → 该(种,省)不可信（回退上级粒度）
 *      · spike    ：份额 > 15% 且该种全球出现月数 ≤ 3 → 疑似专项调查/季节尖峰
 *      · 省总量过小（< minProvinceRecords）→ 整省不可信
 *   ③ 分位分档：可信物种按份额排序 **10 等分**（097，2026-10-30；原 5 等分）——档位是
 *      "按份额排名的切分点"，前端用档位区间实现 70/80/90/100% 的单调覆盖；
 *
 * 全部为纯函数（不碰网络/文件系统），便于单测与离线重跑。
 */

/** 守卫与分档默认参数（产物会内嵌一份，便于追溯用哪套参数生成） */
export const DEFAULT_GUARDS = {
  /** 单省单种份额上限（超过视为单一数据集主导） */
  dominanceShare: 0.4,
  /** 「季节尖峰」判定的份额下限（配合 spikeMaxMonths 使用） */
  spikeShare: 0.15,
  /** 全球出现月数 ≤ 此值才算"尖峰"候选 */
  spikeMaxMonths: 3,
  /** 省份总记录数下限（低于则整省不可信） */
  minProvinceRecords: 1000,
  /**
   * 每档最少物种数（不足则从稀有端向常见端合并）。
   * 097（2026-10-30 用户定）：档位从 5 等分改为 **10 等分**——档位的用途收窄为
   * "按份额排名的切分点"（前端用 `TIERS.commonness` 的档位区间实现 70/80/90/100%
   * 覆盖），不再承担"每档有统计意义"的职责，故 minBandSize 30 → 1：
   * 只要 trusted ≥ 10 就能切出恰好 10 档（每档 ≈ 该省鸟种的 10%）。
   */
  minBandSize: 1,
  /** 分档后可信物种下限（低于则整省不可信） */
  minProvinceSpecies: 20,
  /**
   * 孤证地板：某物种在该地区记录数 < 此值 → 不进该地区档位表（docs/036 §10）。
   * 依据：n=1 的多为迷鸟/笼养逃逸/误认（实测噪声：长尾鹦鹉、美洲鸵鸟等），
   * 分位分档会把它放进 1–3 档（US-NY 实测 12 条 1 档孤证），进而混入出题池。
   */
  minSpeciesRecords: 2,
}

/**
 * 等分档位尺寸 + 「每档最少 N 种」合并。
 * 从**稀有端向常见端**合并：末尾某档不足 minBandSize 时并入其前档（档数随之减少）。
 * @param {number} n 物种数
 * @param {number} bands 目标档数（默认 5）
 * @param {number} minSize 每档最少物种数
 * @returns {number[]} 各档物种数（长度 ≤ bands，和为 n）
 */
export function bandSlices(n, bands = 5, minSize = 1) {
  if (!Number.isFinite(n) || n <= 0) return []
  const maxBands = Math.max(1, Math.trunc(bands))
  const min = Math.max(1, Math.trunc(minSize))
  // 档数 = min(目标档数, floor(n / 每档下限))，至少 1 档。
  // 这样**天然保证**每档 ≥ minSize（n ≥ minSize 时），且物种少时自动退化为更少档，
  // 不需要"合并已分好的档"那种容易出错的后处理。
  const size = Math.min(maxBands, Math.max(1, Math.floor(n / min)))
  const base = Math.floor(n / size)
  const extra = n % size
  const slices = []
  for (let k = 0; k < size; k++) slices.push(base + (k < extra ? 1 : 0))
  return slices
}

/**
 * 单省分档：可信物种按份额降序 → 档位 1..k（1 = 最常见）。
 * @param {{ speciesId: string, n: number }[]} entries 该省已匹配到骨架的物种记录数
 * @param {number} total 该省**全部**记录数（含未匹配物种；用于份额归一）
 * @param {Map<string, number>|null} monthsCount 物种 id → 全球出现月数（守卫用；null = 跳过尖峰守卫）
 * @param {object} guards
 * @returns {{ tiers: Record<string, number>, trusted: number, guardsHit: { dominance: number, spike: number }, bandSizes: number[] }}
 */
export function bandProvince(entries, total, monthsCount, guards = DEFAULT_GUARDS) {
  const empty = { tiers: {}, trusted: 0, guardsHit: { dominance: 0, spike: 0, lowRecords: 0 }, bandSizes: [] }
  if (!Number.isFinite(total) || total < guards.minProvinceRecords) return empty
  if (!entries.length) return empty

  let dominance = 0
  let spike = 0
  let lowRecords = 0
  const trusted = []
  for (const e of entries) {
    // 孤证地板（docs/036 §10）：记录数过低的"物种"不参与分档，避免噪声占据 1–3 档
    if (Number.isFinite(guards.minSpeciesRecords) && e.n < guards.minSpeciesRecords) {
      lowRecords++
      continue
    }
    const share = e.n / total
    if (share > guards.dominanceShare) {
      dominance++
      continue
    }
    if (share > guards.spikeShare && monthsCount) {
      const m = monthsCount.get(e.speciesId)
      if (m != null && m <= guards.spikeMaxMonths) {
        spike++
        continue
      }
    }
    trusted.push({ ...e, share })
  }
  if (trusted.length < guards.minProvinceSpecies) {
    return { ...empty, guardsHit: { dominance, spike, lowRecords } }
  }

  trusted.sort((a, b) => b.share - a.share || a.speciesId.localeCompare(b.speciesId))
  // 097（2026-10-30 用户定）：10 等分（每档 ≈ 该省鸟种 10%）——前端用档位区间实现
  // L1=70% / L2,L3=80% / L4,L5=90% / L6,L7,L8=100% 的单调覆盖。
  const slices = bandSlices(trusted.length, 10, guards.minBandSize)
  const tiers = {}
  let i = 0
  for (let k = 0; k < slices.length; k++) {
    for (let j = 0; j < slices[k]; j++) tiers[trusted[i++].speciesId] = k + 1
  }
  return { tiers, trusted: trusted.length, guardsHit: { dominance, spike, lowRecords }, bandSizes: slices }
}

/**
 * 全量分档：按省逐个处理，再按国家聚合（聚合口径同省级：份额归一 + 守卫 + 分档）。
 *
 * @param {{ speciesId: string, cc: string, code: string, n: number }[]} rows 已匹配物种的（省,记录数）
 * @param {Map<string, number>} provinceTotals `${cc}|${code}` → 该省全部记录数（含未匹配）
 * @param {Map<string, number>} countryTotals `cc` → 该国全部记录数
 * @param {Map<string, number>|null} monthsCount 物种 → 全球出现月数
 * @param {object} guards
 * @param {{ provinces?: boolean, countries?: boolean }} [scope]
 */
export function buildRegionTiers(rows, provinceTotals, countryTotals, monthsCount, guards = DEFAULT_GUARDS, scope = {}) {
  const wantProvinces = scope.provinces !== false
  const wantCountries = scope.countries !== false

  // 按省/按国聚合物种记录数
  const byProvince = new Map() // `${cc}|${code}` → Map<speciesId, n>
  const byCountry = new Map() // cc → Map<speciesId, n>
  for (const r of rows) {
    const pKey = `${r.cc}|${r.code}`
    let p = byProvince.get(pKey)
    if (!p) byProvince.set(pKey, (p = new Map()))
    p.set(r.speciesId, (p.get(r.speciesId) || 0) + r.n)
    let c = byCountry.get(r.cc)
    if (!c) byCountry.set(r.cc, (c = new Map()))
    c.set(r.speciesId, (c.get(r.speciesId) || 0) + r.n)
  }

  /** @type {Record<string, Record<string, number>>} speciesId → code → tier */
  const tiers = {}
  const countryTiers = {}
  const stats = {
    provinces: { total: 0, trusted: 0, skippedSmall: 0, skippedFew: 0, guardsHit: { dominance: 0, spike: 0, lowRecords: 0 } },
    countries: { total: 0, trusted: 0, skippedSmall: 0, skippedFew: 0, guardsHit: { dominance: 0, spike: 0, lowRecords: 0 } },
    /** 明细（留痕用；只保留必要的诊断字段） */
    provinceReport: [],
    countryReport: [],
  }

  const apply = (target, key, tierMap) => {
    for (const [speciesId, tier] of Object.entries(tierMap)) {
      ;(target[speciesId] ??= {})[key] = tier
    }
  }

  if (wantProvinces) {
    for (const [pKey, speciesMap] of [...byProvince.entries()].sort()) {
      const [, code] = pKey.split('|')
      const total = provinceTotals.get(pKey) || 0
      const entries = [...speciesMap.entries()].map(([speciesId, n]) => ({ speciesId, n }))
      stats.provinces.total++
      if (total < guards.minProvinceRecords) {
        stats.provinces.skippedSmall++
        stats.provinceReport.push({ key: pKey, status: 'skipped-small', total })
        continue
      }
      const res = bandProvince(entries, total, monthsCount, guards)
      stats.provinces.guardsHit.dominance += res.guardsHit.dominance
      stats.provinces.guardsHit.spike += res.guardsHit.spike
      stats.provinces.guardsHit.lowRecords += res.guardsHit.lowRecords
      if (res.trusted < guards.minProvinceSpecies) {
        stats.provinces.skippedFew++
        stats.provinceReport.push({
          key: pKey,
          status: 'skipped-few',
          total,
          matched: entries.length,
          trusted: res.trusted,
          guardsHit: res.guardsHit,
        })
        continue
      }
      stats.provinces.trusted++
      apply(tiers, code, res.tiers)
      stats.provinceReport.push({
        key: pKey,
        status: 'ok',
        total,
        matched: entries.length,
        trusted: res.trusted,
        bandSizes: res.bandSizes,
        guardsHit: res.guardsHit,
      })
    }
  }

  if (wantCountries) {
    for (const [cc, speciesMap] of [...byCountry.entries()].sort()) {
      const total = countryTotals.get(cc) || 0
      const entries = [...speciesMap.entries()].map(([speciesId, n]) => ({ speciesId, n }))
      stats.countries.total++
      if (total < guards.minProvinceRecords) {
        stats.countries.skippedSmall++
        stats.countryReport.push({ key: cc, status: 'skipped-small', total })
        continue
      }
      const res = bandProvince(entries, total, monthsCount, guards)
      stats.countries.guardsHit.dominance += res.guardsHit.dominance
      stats.countries.guardsHit.spike += res.guardsHit.spike
      stats.countries.guardsHit.lowRecords += res.guardsHit.lowRecords
      if (res.trusted < guards.minProvinceSpecies) {
        stats.countries.skippedFew++
        stats.countryReport.push({ key: cc, status: 'skipped-few', total, matched: entries.length, trusted: res.trusted })
        continue
      }
      stats.countries.trusted++
      apply(countryTiers, cc, res.tiers)
      stats.countryReport.push({
        key: cc,
        status: 'ok',
        total,
        matched: entries.length,
        trusted: res.trusted,
        bandSizes: res.bandSizes,
        guardsHit: res.guardsHit,
      })
    }
  }

  return { tiers, countryTiers, stats }
}

/**
 * 应用人工覆盖（**最高优先**，见 docs/036 §2.2 第 ④ 步与 D-036-7）。
 * @param {Record<string, Record<string, number>>} tiers speciesId → code → tier（就地修改）
 * @param {Record<string, Record<string, number>>} overrides code（省或国家码）→ speciesId → tier
 * @returns {{ applied: number, unknown: string[] }} unknown = 未命中任何物种或 code 的覆盖项（留痕排查）
 */
export function applyOverrides(tiers, overrides) {
  let applied = 0
  const unknown = []
  for (const [code, speciesMap] of Object.entries(overrides || {})) {
    if (!speciesMap || typeof speciesMap !== 'object') continue
    for (const [speciesId, tierRaw] of Object.entries(speciesMap)) {
      const tier = Number(tierRaw)
      if (!Number.isInteger(tier) || tier < 1 || tier > 10) {
        unknown.push(`${code}\t${speciesId}\t非法档位: ${tierRaw}`)
        continue
      }
      const cur = (tiers[speciesId] ??= {})
      cur[code] = tier
      applied++
    }
  }
  return { applied, unknown }
}

/** 汇总统计（写进产物 coverage，便于追溯与后续迭代对比） */
export function summarize(tiers, countryTiers) {
  const species = new Set([...Object.keys(tiers), ...Object.keys(countryTiers)])
  let pairs = 0
  let countryPairs = 0
  const codes = new Set()
  const tierHist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const m of Object.values(tiers)) {
    // 需要 code 才能统计"涉及多少个省码"，故用 entries 而非 values
    for (const [code, t] of Object.entries(m)) {
      pairs++
      codes.add(code)
      tierHist[t] = (tierHist[t] || 0) + 1
    }
  }
  for (const m of Object.values(countryTiers)) countryPairs += Object.keys(m).length
  return { species: species.size, provinceCodes: codes.size, pairs, countryPairs, tierHist }
}

/**
 * 097 F（2026-10-30）：**全球档位**——按全球观测记录数把物种十等分。
 *
 * 用途：ALL / 洲模式没有省级档位表（档位表按省组织），此前这两档不收窄（全取满）。
 * 全球档位补上这一层：洲/全球出题时按"全球视角的常见度"做 70/80/90/100 单调覆盖。
 *
 * 语义：
 *   · 排序键 = 物种的全球 GBIF 观测记录数（region-records 各国分片求和）——
 *     同一省内"份额排序等价于记录数排序"，全球同理，无需份额归一（全球只有一个分母）；
 *   · 无守卫：分位切分只决定池子边界，极端物种（记录数巨大）本来就在最常见档，符合事实；
 *   · 无记录的物种 = 最罕见档（10）——它们是地球上最不被观测的鸟，语义自洽，
 *     且保持全球池完整（不被"表外剔除"缩小）。
 *
 * @param {Map<string, number>|Array<[string, number]>} counts 物种 id → 全球记录数
 * @param {string[]} allSpeciesIds 题库全部物种 id（含无记录者，兜进第 10 档）
 * @returns {{ tiers: Record<string, number>, bandSizes: number[], withRecords: number }}
 */
export function bandGlobal(counts, allSpeciesIds) {
  const withRecords = [...counts]
    .filter(([, n]) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const slices = bandSlices(withRecords.length, 10, 1)
  const tiers = {}
  let i = 0
  for (let k = 0; k < slices.length; k++) {
    for (let j = 0; j < slices[k]; j++) tiers[withRecords[i++][0]] = k + 1
  }
  for (const id of allSpeciesIds) if (!(id in tiers)) tiers[id] = 10
  return { tiers, bandSizes: slices, withRecords: withRecords.length }
}
