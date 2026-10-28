#!/usr/bin/env node
/**
 * 生成 `public/data/thumbs.json` —— 观鸟页卡片缩略图/鸣声的轻量索引。
 *
 * 为什么需要它：`manifest-meta.json`（名单层）**不含媒体字段**（050 P1），
 * 卡片要显示缩略图/就地播放只能从 assets 分片拿 URL；但一个国家的物种散布在
 * 数百个分片里，逐片拉取不现实。本脚本把每个物种的**首图缩略 URL 路径**与
 * **首音 URL 路径**抽取成单文件索引，前端懒加载一次即可。
 *
 * 为什么存"路径段"而不是硬拼 `image-1`：媒体纠错会更换槽位 key（image-6/7/8…，
 * 见 docs/068/070），坏图停用后文件仍留在 R2 上——硬拼 `image-1` 会把已停用的
 * 坏图拼回来。因此这里存分片里的**真实路径段**（如 `image-3.thumb.webp`），
 * 与纠错后的首图永远一致。
 *
 * 输出结构：
 *   {
 *     "schemaVersion": 1,
 *     "base": "https://bird.wewalk.world/media/",
 *     "thumb": { "<speciesId>": "image-1.thumb.webp", ... },
 *     "audio": { "<speciesId>": "audio-1.mp3", ... }
 *   }
 *
 * 用法：`npm run thumbs`（读 public/data/assets/*.json，写 public/data/thumbs.json）。
 * 媒体纠错 / 重建分片后需要重跑本脚本保持索引一致。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = path.join(ROOT, 'public/data/assets')
const OUT_FILE = path.join(ROOT, 'public/data/thumbs.json')

const MEDIA_PREFIX_RE = /^https?:\/\/[^/]+\/media\//

/** 从绝对 URL 提取 `media/<id>/` 之后的路径段；不匹配返回 null */
function mediaPathOf(url) {
  if (!url) return null
  if (!MEDIA_PREFIX_RE.test(url)) return null
  const rest = url.replace(MEDIA_PREFIX_RE, '')
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  return { id: rest.slice(0, slash), seg: rest.slice(slash + 1) }
}

async function main() {
  const files = (await readdir(ASSETS_DIR)).filter((f) => f.endsWith('.json')).sort()
  if (!files.length) {
    console.error(`[thumbs] no shards under ${ASSETS_DIR} — run the manifest build first`)
    process.exit(1)
  }

  const bases = new Set()
  const thumb = {}
  const audio = {}
  let badUrls = 0

  for (const f of files) {
    const bucket = JSON.parse(await readFile(path.join(ASSETS_DIR, f), 'utf8'))
    for (const [id, sp] of Object.entries(bucket.species ?? {})) {
      const firstImg = sp.images?.[0]
      if (firstImg) {
        // 缩略优先；未转码的直连图（image-1.jpg/jpeg，约 1,242 种）没有 .thumb.webp 变体，
        // 回退用完整图当缩略（懒加载兜底）。只收自有媒体域的 URL，不猜外链。
        const srcUrl = firstImg.thumbUrl || (MEDIA_PREFIX_RE.test(firstImg.url ?? '') ? firstImg.url : null)
        if (srcUrl) {
          const parsed = mediaPathOf(srcUrl)
          if (parsed) {
            if (parsed.id !== id) {
              console.warn(`[thumbs] ${f}: image url id mismatch (${parsed.id} != ${id}), skipped`)
              badUrls++
            } else {
              bases.add(srcUrl.slice(0, srcUrl.length - parsed.seg.length - parsed.id.length - 1))
              thumb[id] = parsed.seg
            }
          } else {
            console.warn(`[thumbs] ${f}: ${id} unexpected image url, skipped`)
            badUrls++
          }
        }
      }
      const firstAud = sp.audios?.[0]
      if (firstAud?.url) {
        const parsed = mediaPathOf(firstAud.url)
        if (parsed) {
          if (parsed.id !== id) {
            console.warn(`[thumbs] ${f}: audio url id mismatch (${parsed.id} != ${id}), skipped`)
            badUrls++
          } else {
            bases.add(firstAud.url.slice(0, firstAud.url.length - parsed.seg.length - parsed.id.length - 1))
            audio[id] = parsed.seg
          }
        } else {
          console.warn(`[thumbs] ${f}: ${id} unexpected audio url, skipped`)
          badUrls++
        }
      }
    }
  }

  if (bases.size !== 1) {
    console.error(`[thumbs] expected exactly one media base, got ${bases.size}: ${[...bases].join(', ')}`)
    process.exit(1)
  }
  const base = [...bases][0]

  const out = { schemaVersion: 1, base, thumb, audio }
  const text = JSON.stringify(out)
  await writeFile(OUT_FILE, text)

  const imgN = Object.keys(thumb).length
  const audN = Object.keys(audio).length
  console.log(
    `[thumbs] wrote ${OUT_FILE} (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB): ` +
      `${imgN} thumbs, ${audN} audios, base=${base}` +
      (badUrls ? `, ${badUrls} unexpected urls skipped` : ''),
  )
}

main().catch((err) => {
  console.error('[thumbs] failed:', err)
  process.exit(1)
})
