/**
 * 023 P1-a:Wikidata(CC0)中文名批量查询的纯函数(不碰网络/文件系统,可单测)。
 * 策略:按学名(wdt:P225)精确匹配 → 收集每个条目的 zh* 标签 → 按语言优先级取一个。
 * 防误配:双名法跨纲不保证唯一(鸟种可能与昆虫等同名),候选条目必须满足
 * 「父级分类单元(P171)学名首词 = 查询学名首词(属名)」优先;无父级信息才降级;
 * 同分再按 taxon rank=species(Q7432) 优先 → QID 数值最小(最早/最主流)。
 */

/** SPARQL 字符串字面量转义 */
export function escapeSparqlString(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** zh 变体语言标签 → 取值优先级(zh-CN 项目:简体优先,繁体兜底) */
export const ZH_LANG_PRIORITY = ['zh-cn', 'zh-hans', 'zh', 'zh-sg', 'zh-my', 'zh-tw', 'zh-hk', 'zh-mo', 'zh-hant']
const LANG_IN = ZH_LANG_PRIORITY.map((l) => `"${l}"`).join(',')

/** 按学名列表构造 WDQS 查询(一次一批,VALUES 精确匹配;P171 取父级学名用于属名校验) */
export function buildZhQuery(names) {
  const values = names.map((n) => `"${escapeSparqlString(n)}"`).join(' ')
  return (
    `SELECT ?sci ?item ?rank ?parentName ?zhLabel ?langCode WHERE {\n` +
    `  VALUES ?sci { ${values} }\n` +
    `  ?item wdt:P225 ?sci .\n` +
    `  OPTIONAL { ?item wdt:P105 ?rank . }\n` +
    `  OPTIONAL { ?item wdt:P171 ?parent . ?parent wdt:P225 ?parentName . }\n` +
    `  ?item rdfs:label ?zhLabel .\n` +
    `  FILTER(LANG(?zhLabel) IN (${LANG_IN}))\n` +
    `}`
  )
}

function qidNum(item) {
  const m = String(item || '').match(/Q(\d+)$/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

const genusOf = (sci) => String(sci || '').trim().split(/\s+/)[0]?.toLowerCase() || ''

/** 单学名多候选 → 取一个标签:属名匹配优先 → species rank 优先 → QID 小者优先,再按语言优先级 */
export function pickLabel(candidates, sci, priority = ZH_LANG_PRIORITY) {
  if (!candidates || !candidates.length) return null
  const genus = genusOf(sci)
  const items = new Map()
  for (const c of candidates) {
    if (!items.has(c.item)) items.set(c.item, [])
    items.get(c.item).push(c)
  }
  const score = (labels) => {
    const parentOk = labels.some((c) => c.parentName && genusOf(c.parentName) === genus)
    const rankOk = labels.some((c) => c.rank === 'http://www.wikidata.org/entity/Q7432')
    return [parentOk ? 0 : 1, rankOk ? 0 : 1, qidNum(labels[0].item)]
  }
  const ordered = [...items.values()].sort((a, b) => {
    const sa = score(a); const sb = score(b)
    return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2]
  })
  for (const lang of priority) {
    for (const labels of ordered) {
      const hit = labels.find((c) => c.lang === lang)
      if (hit) return { zh: hit.zh, lang: hit.lang, item: hit.item }
    }
  }
  return null
}

/** WDQS JSON → { [学名]: { zh, lang, item } }(仅命中的学名出现在结果里) */
export function parseZhResults(json, priority = ZH_LANG_PRIORITY) {
  const bindings = json?.results?.bindings || []
  const bySci = new Map()
  for (const b of bindings) {
    const sci = b.sci?.value
    const zh = b.zhLabel?.value
    const lang = b.langCode?.value
    const item = b.item?.value
    if (!sci || !zh || !lang || !item) continue
    if (!bySci.has(sci)) bySci.set(sci, [])
    bySci.get(sci).push({
      zh,
      lang: String(lang).toLowerCase(),
      item,
      rank: b.rank?.value || null,
      parentName: b.parentName?.value || null,
    })
  }
  const out = {}
  for (const [sci, candidates] of bySci) {
    const pick = pickLabel(candidates, sci, priority)
    if (pick) out[sci] = pick
  }
  return out
}

/**
 * wbgetentities(formatversion=2) JSON → { [页面标题(下划线转空格)]: { zh, lang, item } }。
 * specieswiki 页面标题 = 接受学名,标题精确匹配零误配;missing 条目跳过。
 * 标题→实体是 1:1,无同名歧义,故不做 genus/rank 仲裁,只做语言优先级。
 */
export function parseEntitiesResults(json, priority = ZH_LANG_PRIORITY) {
  const out = {}
  for (const [qid, e] of Object.entries(json?.entities || {})) {
    if (!e || e.missing !== undefined) continue
    const title = e?.sitelinks?.specieswiki?.title
    if (!title || !e.labels) continue
    const name = String(title).replace(/_/g, ' ')
    const labels = Object.entries(e.labels).map(([lang, l]) => ({
      zh: l?.value,
      lang: String(lang).toLowerCase(),
      item: qid,
    }))
    const pick = pickLabel(labels, name, priority)
    if (pick) out[name] = pick
  }
  return out
}
