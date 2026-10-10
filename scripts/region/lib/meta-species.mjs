/**
 * 051 S3：地区产物的**权威层数据源**。
 *
 * 背景（docs/051 §3）：地区产物（季节 `seasonality.json`、省级 `region-provinces.json`）
 * 长期只覆盖核心库 1,299 种，因为它们读的是 `public/data/manifest.json`（完整层=核心库），
 * 而全球层的 `taxonId` 此前全为 null。050 P3 已用 gbif-match 缓存把 9,545 种的 `taxonId` 回填进
 * 权威层（10,647 / 10,844），现在这些脚本可以改读权威层，把覆盖扩到全球种。
 *
 * ## 为什么媒体月份必须一起加载
 * `seasonality` 的**主数据源是媒体自带月份**（采集时从 XC 的 date / iNat 的 observed_on 捕获），
 * 实测全球种 9,532 / 9,545 **至少一项媒体带 month** —— 也就是说：
 *   · 不联网就能为 88% 的种产出逐月分布；
 *   · GBIF 只是补缺（`--gbif-limit` 控制补多少种）。
 * 权威层本身**不含媒体**（050 §2.1），所以这里额外从采集台账 `data-cache/manifest-global.json`
 * 取媒体的 month（仍在，`--source meta` 可从它读；P5 退役前都在）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 读权威层物种 + 媒体月份，返回**与 manifest 同构**的 species 数组（供既有构建脚本直接消费）。
 * @param {string} root 仓库根
 * @param {{ withMedia?: boolean }} opts withMedia=false 时不挂媒体（省级层不需要）
 */
export async function loadMetaSpecies(root, opts = {}) {
  const metaPath = path.join(root, 'public/data/manifest-meta.json')
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'))
  const species = (meta.species || []).map((sp) => ({
    id: sp.id,
    nameSci: sp.nameSci,
    nameZh: sp.nameZh,
    nameEn: sp.nameEn,
    family: sp.family,
    order: sp.order,
    taxonId: sp.taxonId,
    commonness: sp.commonness,
    profile: sp.profile,
  }))

  if (!opts.withMedia) return species

  // 媒体月份（P5）：直接读 assets 分片（已覆盖全量种，含 month 字段；
  // 不再依赖已退役的 manifest.json / 采集台账）。
  const byId = new Map(species.map((sp) => [sp.id, sp]))
  const assetsDir = path.join(root, 'public/data/assets')
  const files = (await fs.readdir(assetsDir).catch(() => [])).filter((f) => f.endsWith('.json'))
  for (const f of files) {
    const doc = JSON.parse(await fs.readFile(path.join(assetsDir, f), 'utf8'))
    for (const [id, e] of Object.entries(doc.species || {})) {
      const target = byId.get(id)
      if (!target) continue
      if (e.images?.length) target.images = e.images
      if (e.audios?.length) target.audios = e.audios
    }
  }
  return species
}
