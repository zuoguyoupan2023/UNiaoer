#!/usr/bin/env node
/**
 * 把 data/species-notes.json 增量并入已生成的 manifest（答疑专栏 011 §9）。
 *
 * 构建期 build-bank.mjs 会自动并入；本脚本用于「不重跑 bank（抓取/转码）」时更新说明，
 * 就地写回 species[].notes（未命中则删除旧字段）。默认操作 public/data/manifest.json。
 *
 * 用法：node scripts/apply-notes.mjs [--manifest public/data/manifest.json]
 * 退出码：0 成功；1 notes 里有 manifest 中不存在的物种 id（多为拼写错误）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from './lib/util.mjs'
import { loadSpeciesNotes, applySpeciesNotes, unmatchedNoteIds } from './lib/notes.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const MANIFEST = path.resolve(ROOT, args.manifest || 'public/data/manifest.json')

const notes = await loadSpeciesNotes(ROOT)
const total = Object.keys(notes).length
if (!total) {
  console.log('ℹ️  data/species-notes.json 没有条目，跳过')
  process.exit(0)
}

const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'))
if (!Array.isArray(manifest.species)) {
  console.error(`❌ ${path.relative(ROOT, MANIFEST)} 的 species 不是数组`)
  process.exit(1)
}

const applied = applySpeciesNotes(manifest.species, notes)
const orphan = unmatchedNoteIds(manifest.species, notes)
await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2))

console.log(
  `✅ 答疑专栏：${path.relative(ROOT, MANIFEST)} 并入 ${applied}/${total} 条（物种总数 ${manifest.species.length}）`,
)
if (orphan.length) {
  console.error(`❌ 以下 notes id 在 manifest 中不存在（检查拼写）：${orphan.join('、')}`)
  process.exit(1)
}
