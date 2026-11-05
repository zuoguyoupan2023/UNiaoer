#!/usr/bin/env node
/**
 * 省级档位分片**版本一致性**门禁（2026-11-05 事故后新增，见 docs/105 / AGENTS.md 铁律 13）。
 *
 * ## 为什么需要这道门禁
 *
 * 2026-10 末把档位产物从 5 等分改成 10 等分（097 第四轮），但分片只推到了本地/R2 目录的一部分，
 * 结果是：索引 `province-commonness.json` 是 10-29 的 10 档版、R2 分片是 10-24 的 5 档版。
 * 前端按 `[1..7]` 过滤时 5 档全部放行 → L1 实际是 100% 池却标「×70%」，持续一周无人发现。
 *
 * 现有门禁为什么没拦住：
 *   · `check:sync` 只 fetch 两个文件看 `res.ok`，**从不比对 generatedAt / 档位数**；
 *   · `check:region` 在分片目录缺失时**整段静默跳过**（分片不进 git，CI 上永远缺席）。
 *
 * 本脚本补上这个洞：既查本地（CI 可跑），也查远端（pre-push / 人工核实）。
 *
 * ## 检查项
 *
 * 本地（默认）：
 *   L1. 索引 `sharding.files` 清单 == 磁盘实际 .json 文件数
 *   L2. 每个省级分片每省档位数 == 10（097 十档制）
 *   L3. 分片 `generatedAt` == 索引 `generatedAt`（同一次构建产出）
 *   L4. 省码总数 == 索引 `coverage.provinceCodes`
 *   L5. 索引 guards.minBandSize == 1（十档制放开）
 *   L6. 不得出现排除码 ZZ/XK/XZ（铁律 6）
 *
 * 远端（--remote）：
 *   R1. 抽样国家分片 `generatedAt` == 本地索引 `generatedAt`
 *   R2. 抽样国家分片 maxTier == 10
 *   R3. R2 索引 `generatedAt` == 本地索引 `generatedAt`
 *
 * ## 用法
 *
 *   npm run check:tiers                  # 本地 + 远端（pre-push 用）
 *   npm run check:tiers -- --no-net      # 只查本地（CI 用）
 *   npm run check:tiers -- --sample CN,US,GB
 *   npm run check:tiers -- --verbose
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs } from './lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await loadEnv(path.join(ROOT, '.env'))
const args = parseArgs(process.argv.slice(2))
const NO_NET = !!args['no-net']
const VERBOSE = !!args.verbose
const TARGET_BANDS = 10

/** 抽样国家：覆盖五大洲 + 大/中/小档位表，且都是 373 片里确实存在的 */
const DEFAULT_SAMPLE = ['CN', 'US', 'GB', 'AU', 'BR', 'JP', 'ZA', 'IN', 'MX', 'FR']

const DATA = path.join(ROOT, 'public/data')
const SHARD_DIR = path.join(DATA, 'province-commonness')
const INDEX = path.join(DATA, 'province-commonness.json')

const errors = []
const warnings = []
const info = []
const fail = (msg) => errors.push(msg)
const ok = (msg) => {
  if (VERBOSE) console.log(`  ✓ ${msg}`)
}

const readJson = async (p) => {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    return null
  }
}

// ── 0. 读索引与磁盘 ─────────────────────────────────────────────
const index = await readJson(INDEX)
if (!index) {
  console.error('❌ 读不到 public/data/province-commonness.json（索引是 git 产物，不该缺）')
  process.exit(1)
}
const idxFiles = index.sharding?.files ?? []
const diskFiles = (await fs.readdir(SHARD_DIR).catch(() => [])).filter((f) => f.endsWith('.json'))
const diskSet = new Set(diskFiles)

console.log(
  `索引 generatedAt ${index.generatedAt} · 清单 ${idxFiles.length} 片 · 磁盘 ${diskFiles.length} 片`,
)

// ── L1. 清单与磁盘一致 ──────────────────────────────────────────
if (!idxFiles.length) {
  fail('索引缺 sharding.files（无法核对分片）')
} else if (!diskFiles.length) {
  // 分片只推 R2、不进 git → 新 clone / CI 上本来就没有。明确降级为警告（不是失败）。
  warnings.push(
    `本地无分片（清单 ${idxFiles.length} 片）——分片只推 R2、不进 git，跳过 L2/L3/L4 的逐片校验`,
  )
} else {
  const missing = idxFiles.filter((f) => !diskSet.has(f))
  const extra = diskFiles.filter((f) => !idxFiles.includes(f))
  if (missing.length) fail(`索引列出但磁盘缺失 ${missing.length} 片（如 ${missing.slice(0, 3).join(', ')}）`)
  if (extra.length) fail(`磁盘多出索引未列出的 ${extra.length} 片（如 ${extra.slice(0, 3).join(', ')}）`)
  if (!missing.length && !extra.length) ok(`L1 清单与磁盘一致（${diskFiles.length} 片）`)
}

// ── L5. 十档制参数 ─────────────────────────────────────────────
if (index.guards?.minBandSize !== 1) {
  fail(`索引 guards.minBandSize = ${index.guards?.minBandSize}，十档制应为 1（097 第四轮）`)
} else ok('L5 guards.minBandSize = 1')

// ── L6. 排除码（铁律 6）────────────────────────────────────────
const scope = index.scope?.countries ?? []
const denied = scope.filter((c) => ['ZZ', 'XK', 'XZ'].includes(c))
if (denied.length) fail(`索引 scope.countries 出现排除码 ${denied.join(', ')}（铁律 6）`)
else ok('L6 无排除码 ZZ/XK/XZ')

// ── L2/L3/L4. 逐片校验 ────────────────────────────────────────
let provinceCodeTotal = 0
let bandsChecked = 0
if (diskFiles.length) {
  for (const f of diskFiles) {
    const shard = await readJson(path.join(SHARD_DIR, f))
    if (!shard) {
      fail(`分片 ${f}: 不是合法 JSON`)
      continue
    }
    // L3. 同一次构建
    if (shard.generatedAt !== index.generatedAt) {
      fail(`分片 ${f}: generatedAt ${shard.generatedAt} ≠ 索引 ${index.generatedAt}`)
    }
    if (shard.level === 'province') {
      const codes = Object.keys(shard.tiersByCode ?? {})
      provinceCodeTotal += codes.length
      for (const code of codes) {
        if (!String(code).startsWith(`${shard.country}-`)) {
          fail(`分片 ${f}: 省码 ${code} 与国家 ${shard.country} 不匹配`)
        }
        const map = shard.tiersByCode[code] ?? {}
        const bands = new Set(Object.values(map))
        // L2. 十档制
        if (bands.size !== TARGET_BANDS) {
          fail(`分片 ${f} 省码 ${code}: 档位数 ${bands.size} ≠ ${TARGET_BANDS}`)
        }
        for (const [id, t] of Object.entries(map)) {
          if (!Number.isInteger(t) || t < 1 || t > TARGET_BANDS) {
            fail(`分片 ${f} 省码 ${code} 物种 ${id}: 档位 ${t} 越界 1..${TARGET_BANDS}`)
            break
          }
        }
        bandsChecked++
      }
    }
    ok(`${f} ✓`)
  }
  // L4. 省码总数
  const expected = index.coverage?.provinceCodes
  if (typeof expected === 'number' && provinceCodeTotal !== expected) {
    fail(`省码总数 ${provinceCodeTotal} ≠ 索引 coverage.provinceCodes ${expected}`)
  } else ok(`L4 省码总数 ${provinceCodeTotal} == 索引 ${expected}`)
}

// ── R1/R2/R3. 远端 ────────────────────────────────────────────
const sample = String(args.sample || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const SAMPLES = sample.length ? sample : DEFAULT_SAMPLE

if (NO_NET) {
  console.log('远端校验：--no-net 跳过')
} else {
  const base = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
  if (!base) {
    warnings.push('缺 R2_PUBLIC_BASE（.env）→ 跳过远端校验')
  } else {
    const root = /^https?:\/\//.test(base) ? base : `https://${base}`
    console.log(`远端校验：${root}/data/province-commonness/ 抽样 ${SAMPLES.length} 国`)

    // R3. R2 索引版本
    try {
      const res = await fetch(`${root}/data/province-commonness.json`, {
        headers: { 'cache-control': 'no-cache' },
      })
      if (!res.ok) {
        fail(`R3 R2 索引 HTTP ${res.status}（未上传？跑 sync:prod）`)
      } else {
        const remoteIdx = await res.json()
        if (remoteIdx.generatedAt !== index.generatedAt) {
          fail(
            `R3 R2 索引 generatedAt ${remoteIdx.generatedAt} ≠ 本地索引 ${index.generatedAt}` +
              ` → 分片/索引未推齐。修：node scripts/push-r2-data.mjs --dir public/data/province-commonness --apply` +
              `（该命令会同时推 373 片与同级索引 data/province-commonness.json；` +
              `两者必须同版本，否则 R3 永远红）`,
          )
        } else ok(`R3 R2 索引版本一致（${remoteIdx.generatedAt}）`)
      }
    } catch (e) {
      fail(`R3 R2 索引读取失败：${e.message}`)
    }

    // R1/R2. 抽样分片
    const results = await Promise.all(
      SAMPLES.map(async (cc) => {
        try {
          const res = await fetch(`${root}/data/province-commonness/${cc}.json`, {
            headers: { 'cache-control': 'no-cache' },
          })
          if (!res.ok) return { cc, err: `HTTP ${res.status}` }
          const shard = await res.json()
          const bands = new Set()
          const maps = shard.level === 'province' ? Object.values(shard.tiersByCode ?? {}) : [shard.tiers ?? {}]
          for (const m of maps) for (const t of Object.values(m)) bands.add(t)
          return { cc, generatedAt: shard.generatedAt, maxTier: Math.max(...bands), bandCount: bands.size }
        } catch (e) {
          return { cc, err: e.message }
        }
      }),
    )

    for (const r of results) {
      if (r.err) {
        fail(`R1/R2 ${r.cc}: ${r.err}`)
        continue
      }
      if (r.generatedAt !== index.generatedAt) {
        fail(`R1 ${r.cc}: R2 generatedAt ${r.generatedAt} ≠ 索引 ${index.generatedAt}（旧版分片未更新）`)
      }
      if (r.bandCount !== TARGET_BANDS) {
        fail(`R2 ${r.cc}: R2 档位数 ${r.bandCount} ≠ ${TARGET_BANDS}（旧 5 档制残留）`)
      }
      if (!errors.some((e) => e.includes(r.cc))) ok(`R1/R2 ${r.cc} ✓ (${r.generatedAt}, ${r.bandCount} 档)`)
    }
  }
}

// ── 汇总 ──────────────────────────────────────────────────────
console.log('')
for (const w of warnings) console.log(`  ⚠ ${w}`)
for (const i of info) console.log(`  · ${i}`)
if (errors.length) {
  console.error(`❌ check:tiers 失败：${errors.length} 条`)
  for (const e of errors.slice(0, 30)) console.error(`   ✗ ${e}`)
  if (errors.length > 30) console.error(`   … 其余 ${errors.length - 30} 条`)
  process.exit(1)
}
console.log(`✅ check:tiers 通过（${provinceCodeTotal || '—'} 省码 · ${bandsChecked || '—'} 张档位表）`)
