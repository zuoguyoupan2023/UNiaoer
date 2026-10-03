/**
 * 023 P0:下载 AviList v2025b(extended)到 data-cache/taxonomy/(已 gitignore)。
 * 许可 CC BY 4.0;引用:AviList Core Team. 2026. AviList: The Global Avian Checklist, v2025b. https://doi.org/10.2173/avilist.v2025b
 * 已有缓存(>1MB)默认跳过;--refresh 强制重下。
 * 常量(AVILIST_CACHE 等)被 build-species-index import——主逻辑只在直接执行时运行。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from '../lib/util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const AVILIST_VERSION = 'v2025b'
export const AVILIST_URL = 'https://www.avilist.org/wp-content/uploads/2026/06/AviList-v2025b-10Jun2026-extended.xlsx'
export const AVILIST_CACHE = path.join(ROOT, 'data-cache/taxonomy/AviList-v2025b-extended.xlsx')

/** 直接执行本脚本时才跑下载(node fetch-avilist.mjs;被 import 时只取常量)。 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(path.dirname(AVILIST_CACHE), { recursive: true })
  if (!args.refresh) {
    const st = await fs.stat(AVILIST_CACHE).catch(() => null)
    if (st && st.size > 1_000_000) {
      console.log(`已有缓存(${(st.size / 1e6).toFixed(1)}MB),跳过下载;--refresh 强制重下 → ${path.relative(ROOT, AVILIST_CACHE)}`)
      return
    }
  }
  console.log(`下载 AviList ${AVILIST_VERSION} …`)
  const res = await fetch(AVILIST_URL, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // zip 本地文件头 PK\x03\x04;体积下限挡住被 CDN 劫持成 HTML 的情形
  if (buf.length < 1_000_000 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`响应不像 xlsx/zip(${buf.length} 字节),拒绝落盘`)
  }
  await fs.writeFile(AVILIST_CACHE, buf)
  console.log(`已保存 ${(buf.length / 1e6).toFixed(1)}MB → ${path.relative(ROOT, AVILIST_CACHE)}`)
}

if (isMain) {
  main().catch((e) => {
    console.error(`✗ fetch-avilist:${e.message}`)
    process.exit(1)
  })
}
