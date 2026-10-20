#!/usr/bin/env node
/**
 * 端上识鸟本地联调：起服务 + 把模型放到同源 /models/
 *
 *   node scripts/birdid-local-test.mjs              # 用 R2 桶(默认)
 *   node scripts/birdid-local-test.mjs --local      # 用本地 experiments 里的模型副本(更快/可离线)
 *   node scripts/birdid-local-test.mjs --port 4177
 *
 * 为什么要这脚本：MODEL_BASE 默认指向独立的模型桶域名，而本地没有那个域。
 * 两种跑法：
 *   --local   构建时把 VITE_BIRDID_MODEL_BASE 置空 → 走同源 /models/，
 *             再把 experiments/birdid/cache/model/ 里的权重拷进 dist/models/。
 *             权重体积不变(44MB/107MB)，所以下载耗时与线上等价，测速才有意义。
 *   默认      用真实桶地址，能验证 CORS 与真实速度。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const LOCAL = args.includes('--local')
const PORT = args.includes('--port') ? args[args.indexOf('--port') + 1] : '4177'
const MODEL_BASE = process.env.BIRDID_R2_BASE || 'https://pub-c92329d5b47e445c9e4b7401f9af57ed.r2.dev'

const MODELS = [
  ['birdnet-v2.4-int8-arm.onnx', 'cache/model/birdnet24_int8_arm.onnx'],
  ['birdnet-v2.4-labels.txt', 'cache/model/labels_birdnet24.txt'],
  // 2026-10-20：图像侧 SpeciesNet → OSEA（26MB QDQ）
  ['osea-int8-v1.onnx', 'cache/model/osea/osea-qdq-int8.onnx'],
  ['osea-bird-info.json', 'cache/model/osea/bird_info.json'],
]

function run(cmd, argv, env) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log(`\n构建（MODEL_BASE = ${LOCAL ? '同源 /models/' : MODEL_BASE}）…`)
run('npx', ['npm', 'run', 'build'], { VITE_BIRDID_MODEL_BASE: LOCAL ? '' : MODEL_BASE })

if (LOCAL) {
  const dest = path.join(ROOT, 'dist/models')
  fs.mkdirSync(dest, { recursive: true })
  for (const [name, rel] of MODELS) {
    const src = path.join(ROOT, 'experiments/birdid', rel)
    if (!fs.existsSync(src)) {
      console.error(`✗ 缺 ${src} —— 先跑 scripts/fetch-birdnet-model.mjs 或按 docs/056 §2 下载`)
      process.exit(2)
    }
    fs.copyFileSync(src, path.join(dest, name))
    console.log(`  · ${name}  ${(fs.statSync(src).size / 1048576).toFixed(1)}MB`)
  }
  console.log('  已拷进 dist/models/（同源 /models/）')
}

console.log(`\n起 preview：http://localhost:${PORT}/identify\n`)
spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { cwd: ROOT, stdio: 'inherit' })
