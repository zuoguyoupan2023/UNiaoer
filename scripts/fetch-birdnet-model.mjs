#!/usr/bin/env node
/**
 * 拉取端上识鸟模型权重到 public/models/（仅本地开发用；不入库）
 *
 *   node scripts/fetch-birdnet-model.mjs [--force]
 *
 * 生产环境这份 25MB 权重走 R2（与媒体同一套公开域 + ACAO），
 * 理由见 docs/055 §5.2。
 *
 * ⚠️ 中国网络注意：Zenodo 单流实测仅 12~22 KB/s 且会断线（50MB 要 70 分钟）。
 *    支持 Range，必须分块并发 —— 本脚本用 16 线程，实测 ≈185 KB/s、313 秒完成。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'public/models')
const OUT = path.join(OUT_DIR, 'birdnet-audio.tflite')
const URL_ZIP =
  'https://zenodo.org/api/records/15050749/files/BirdNET_v2.4_tflite_fp16.zip/content'
const URL_MODEL =
  'https://zenodo.org/api/records/15050749/files/BirdNET_v2.4_tflite_fp16.zip/content'
const TOTAL = 53025528
const N = 16

if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1)
  console.log(`✓ 模型已存在：${path.relative(ROOT, OUT)} (${mb} MB)。加 --force 重下。`)
  process.exit(0)
}
fs.mkdirSync(OUT_DIR, { recursive: true })

// 1) 分块并发下 zip（单流会被掐断）
const chunkSize = Math.ceil(TOTAL / N)
const tmp = path.join(OUT_DIR, '.zip')
const procs = []
console.log(`分 ${N} 块并发下载 zip（${(TOTAL / 1048576).toFixed(0)}MB）…`)
for (let i = 0; i < N; i++) {
  const start = i * chunkSize
  const end = Math.min(start + chunkSize - 1, TOTAL - 1)
  procs.push(
    new Promise((resolve) => {
      const run = (attempt) => {
        const c = spawn(
          'curl',
          ['-s', '--max-time', '300', '-r', `${start}-${end}`, '-o', `${tmp}.${i}`, URL_ZIP],
          { stdio: 'ignore' },
        )
        c.on('exit', () => {
          const want = end - start + 1
          const got = fs.existsSync(`${tmp}.${i}`) ? fs.statSync(`${tmp}.${i}`).size : 0
          if (got === want || attempt >= 4) resolve()
          else setTimeout(() => run(attempt + 1), 2000)
        })
      }
      run(0)
    }),
  )
}
await Promise.all(procs)
fs.writeFileSync(
  tmp,
  Buffer.concat(Array.from({ length: N }, (_, i) => fs.readFileSync(`${tmp}.${i}`))),
)
for (let i = 0; i < N; i++) fs.rmSync(`${tmp}.${i}`, { force: true })

// 2) 只取 audio-model-fp16.tflite（浏览器端不需要 meta-model）
console.log('解压 audio-model-fp16.tflite…')
await new Promise((resolve, reject) => {
  const u = spawn('unzip', ['-o', '-j', tmp, 'audio-model-fp16.tflite', '-d', OUT_DIR], {
    stdio: 'ignore',
  })
  u.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`unzip 退出码 ${c}`))))
})
fs.rmSync(tmp, { force: true })
const renamed = path.join(OUT_DIR, 'audio-model-fp16.tflite')
if (fs.existsSync(renamed)) fs.renameSync(renamed, OUT)
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1)
console.log(`✓ 完成：${path.relative(ROOT, OUT)} (${mb} MB)`)
console.log(`  许可：BirdNET+ V3/V2.4 模型权重 CC BY-NC（Zenodo 15050749）——非商用项目适用`)
console.log(`  上线前请按 AGENTS.md 在 docs/024 登记。`)
void URL_MODEL
