#!/usr/bin/env node
/**
 * 029 M1:manifest 分层产物构建(独立命令)——由完整 manifest 派生三层产物:
 *   public/data/manifest-core.json        启动层(名录 + 首图首音;前端 loadBank 只取这份)
 *   public/data/assets/<bucket>.json      详情层分片(完整素材 + notes/profile;按 id 前两位,大桶自动拆)
 *   public/data/manifest-global.min.json  全球池(核心同构,懒加载)
 *
 * 完整层 public/data/manifest.json 仍是构建真源(不修改);本脚本可反复运行(幂等)。
 * 采集收尾(build-bank)也会调用同一实现,保证产物始终与 manifest 同步。
 *
 * 用法:
 *   npm run layers                 # 由 public/data/manifest.json 产三层
 *   npm run check:layers           # 校验三层与完整层一致(见 scripts/check-manifest-layers.mjs)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCore, toAssetBuckets, toGlobalPool, splitLargeBuckets } from './lib/manifest-layers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 原子写(tmp + rename):防中断产生半截 JSON(与 build-bank 同规)。 */
async function writeJsonAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, file)
}

/**
 * 写三层产物。返回统计(供 build-bank / CLI 打印)。
 * @param {{dataDir?:string, globalLedger?:string, quiet?:boolean}} opts
 */
export async function writeManifestLayers(manifest, opts = {}) {
  const dataDir = opts.dataDir || path.join(ROOT, 'public/data')
  const globalLedger = opts.globalLedger || path.join(ROOT, 'data/manifest-global.json')
  const quiet = !!opts.quiet
  /** 附注统计(commonness 合并数等),随 stats 返回 */
  const stats_note = {}

  const core = toCore(manifest)
  const buckets = splitLargeBuckets(toAssetBuckets(manifest))
  const bucketNames = Object.keys(buckets).sort()
  core.buckets = bucketNames // 以实际分片为准(大桶拆分后桶名可能与首字母不同)
  const coreText = JSON.stringify(core)
  await writeJsonAtomic(path.join(dataDir, 'manifest-core.json'), coreText)

  const assetsDir = path.join(dataDir, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })
  // 清理过期分片(桶名随拆分策略变化,旧文件留着会被误读)
  const existing = (await fs.readdir(assetsDir).catch(() => [])).filter((f) => f.endsWith('.json'))
  const keep = new Set(bucketNames.map((n) => `${n}.json`))
  for (const f of existing) {
    if (!keep.has(f)) await fs.rm(path.join(assetsDir, f), { force: true })
  }
  let bucketBytes = 0
  let maxBucket = { name: '', bytes: 0 }
  for (const name of bucketNames) {
    const text = JSON.stringify({ layer: 'assets', bucket: name, species: buckets[name] })
    await writeJsonAtomic(path.join(assetsDir, `${name}.json`), text)
    bucketBytes += Buffer.byteLength(text)
    if (text.length > maxBucket.bytes) maxBucket = { name, bytes: text.length }
  }

  let global = null
  try {
    const g = JSON.parse(await fs.readFile(globalLedger, 'utf8'))
    global = toGlobalPool(g)
    // 029 M2:全球池的 commonness 用骨架合成值覆盖台账占位值(台账采集期统一填 2)。
    // 按 nameSci 精确联表(骨架 11,131 种全覆盖,含台账全部物种)。
    try {
      const idx = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
      const byName = new Map(idx.species.map((s) => [s.nameSci, s]))
      let merged = 0
      for (const sp of global.species) {
        const e = byName.get(sp.nameSci)
        if (e && Number.isInteger(e.commonness)) {
          sp.commonness = e.commonness
          merged++
        }
      }
      stats_note.commonness = merged
    } catch {
      stats_note.commonness = 0
    }
    await writeJsonAtomic(path.join(dataDir, 'manifest-global.min.json'), JSON.stringify(global))
    // 全量可玩口径(首页展示用):核心 + 全球,含图/音计数。
    // 烘焙进 core 避免前端为了显示统计再多拉 10MB 全球池。
    const countMedia = (list) => ({
      total: list.length,
      withImage: list.filter((sp) => sp.image).length,
      withAudio: list.filter((sp) => sp.audio).length,
    })
    const coreStats = countMedia(core.species)
    const globalStats = countMedia(global.species)
    core.universe = {
      coreTotal: coreStats.total,
      globalTotal: globalStats.total,
      total: coreStats.total + globalStats.total,
      withImage: coreStats.withImage + globalStats.withImage,
      withAudio: coreStats.withAudio + globalStats.withAudio,
    }
    await writeJsonAtomic(path.join(dataDir, 'manifest-core.json'), JSON.stringify(core))
  } catch {
    global = null // 无台账:跳过(不报错)
  }

  const stats = {
    coreBytes: Buffer.byteLength(JSON.stringify(core)),
    coreTotal: core.total,
    buckets: bucketNames.length,
    bucketBytes,
    maxBucket,
    globalBytes: global ? Buffer.byteLength(JSON.stringify(global)) : 0,
    globalTotal: global ? global.total : 0,
    globalCommonnessMerged: stats_note.commonness || 0,
  }
  if (!quiet) {
    const MB = (b) => `${(b / 1e6).toFixed(2)}MB`
    console.log(
      `分层产物:core ${MB(stats.coreBytes)}(${stats.coreTotal} 种,${stats.buckets} 桶) · assets ${MB(stats.bucketBytes)}(最大桶 ${stats.maxBucket.name} ${(stats.maxBucket.bytes / 1024).toFixed(0)}KB)` +
        (global
          ? ` · global.min ${MB(stats.globalBytes)}(${stats.globalTotal} 种,commonness 联表 ${stats.globalCommonnessMerged})`
          : ' · 无全球台账,global.min 跳过'),
    )
  }
  return stats
}

/** CLI 入口(直接运行时) */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const manifestPath = path.join(ROOT, 'public/data/manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    console.log(`读 ${path.relative(ROOT, manifestPath)}(${manifest.species?.length || 0} 种)`)
    const stats = await writeManifestLayers(manifest)
    if (stats.maxBucket.bytes > 400_000) {
      console.warn(`⚠ 最大桶 ${stats.maxBucket.name} 超 400KB DoD 线(检查拆分策略)`)
    }
  } catch (e) {
    console.error(`✗ build-manifest-layers:${e.message}`)
    process.exit(1)
  }
}
