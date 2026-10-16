/**
 * 部署体积门禁：Cloudflare Pages 对**单个文件**有 25 MiB 上限，
 * 超了整次部署会在上传阶段失败 —— 而本地 `npm run build` 是绿的，
 * CI 也可能全绿，导致「代码没问题、线上却一直是旧版本」这种最难查的故障。
 *
 * 2026-10-17 事故：引 `onnxruntime-web` 包根带进 27 MiB 的
 * `ort-wasm-simd-threaded.jsep.wasm`（WebGPU 用），Pages 连续两次 Failure，
 * uniaoer.com 停在 12 小时前的版本。修法是改引 `onnxruntime-web/wasm`（13.58 MiB）。
 *
 * 用法：npm run check:dist-size（已挂进 npm run build，构建后自动跑）
 * 退出码：0 通过 / 1 有超限文件（**导致部署失败**）
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
/** Pages 单文件上限 25 MiB；留一点余量，超过 24.5 MiB 就预警 */
const LIMIT = 25 * 1024 * 1024
const WARN = 24.5 * 1024 * 1024

if (!fs.existsSync(DIST)) {
  console.error('✗ 找不到 dist/；先跑 npm run build')
  process.exit(2)
}

/** 该 dist 文件是否来自「本地才有、不进 git」的源（如 public/models 里的模型） */
function isLocalOnly(distFile) {
  const rel = path.relative(DIST, distFile).split(path.sep).join('/')
  for (const candidate of [`public/${rel}`, rel]) {
    try {
      execFileSync('git', ['check-ignore', '-q', candidate], { cwd: ROOT, stdio: 'ignore' })
      return candidate // 被 gitignore 忽略 → 部署里不会有
    } catch {
      /* 未被忽略，继续试下一个 */
    }
  }
  return null
}

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else out.push({ full, size: fs.statSync(full).size })
  }
  return out
}

const files = walk(DIST)
const over = files.filter((f) => f.size > LIMIT)
const near = files.filter((f) => f.size > WARN && f.size <= LIMIT)

const mb = (n) => (n / 1048576).toFixed(2)
const fatal = []
for (const f of over) {
  const src = isLocalOnly(f.full)
  const rel = path.relative(DIST, f.full)
  if (src) {
    console.log(`  ⚠ ${rel} ${mb(f.size)} MiB —— 来自本地才有（gitignore 的 ${src}），部署里不含，放行`)
  } else {
    fatal.push(rel)
    console.error(`  ✗ ${rel} ${mb(f.size)} MiB > 25 MiB → Pages 部署会失败`)
  }
}
for (const f of near) {
  console.log(`  · ${path.relative(DIST, f.full)} ${mb(f.size)} MiB（接近 25 MiB 上限，注意别再加）`)
}

console.log(`\n部署体积门禁：检查 ${files.length} 个文件，最大 ${mb(Math.max(...files.map((f) => f.size)))} MiB`)
if (fatal.length) {
  console.error(`\n⛔ ${fatal.length} 个文件超过 Pages 单文件上限，部署必定失败：`)
  for (const f of fatal) console.error(`    ${f}`)
  console.error('  处理：改用更小的依赖构建（如 onnxruntime-web/wasm 替代包根），或把该资源改为运行时从 R2 拉取。')
  process.exit(1)
}
console.log('✅ 通过（无超限文件）\n')
