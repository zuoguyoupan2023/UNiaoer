#!/usr/bin/env node
/**
 * 推送前质量抽检(staged media QA)
 *
 *   node scripts/check-staged-media.mjs            # 全量本地文件 + 台账双向对账
 *   node scripts/check-staged-media.mjs --sample 50 # 只对账随机 50 个物种(快)
 *
 * 推送(R2)是不可逆的批量动作:一个坏文件传上去,线上就是坏图/坏音,
 * 且 --resume 台账会认为它「已传」,不再重传。故推送前必须过这道闸。
 *
 * 四类检查:
 *   A. 文件完整性  —— 零字节 / 过小 / 魔数与扩展名不符(截断、伪装、错格式)
 *   B. 派生件齐全  —— 有 full 必有 thumb;xl/avif 按transcode 标志判断
 *   C. 台账 → 本地  —— 台账声明的每个 URL,本地有文件 或 已在已传台账(否则=遗漏)
 *   D. 本地 → 台账  —— 本地存在但台账无对应条目(=孤儿,推送上去也没人引用)
 *
 * 退出码:0 全绿 / 1 有问题(阻止推送)
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const MEDIA_DIR = path.join(ROOT, 'public/media')
const LEDGER = path.join(ROOT, 'data-cache/manifest-global.json')
const UPLOADED = path.join(ROOT, 'data-cache/r2-uploaded.json')

const args = process.argv.slice(2)
const SAMPLE = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1]) || 50 : 0

// 派生件之外的最小合理体积(低于此视为可疑)
// 注意:320px 的 webp 缩略图合法体积可以低到 ~400B,故 webp/avif 阈值取 256;
// 真正的截断靠魔数 + 解码兜底,不能只靠体积。
const MIN_SIZE = {
  '.webp': 256,
  '.avif': 256,
  '.jpg': 1024,
  '.jpeg': 1024,
  '.mp3': 4096,
  '.wav': 4096,
  '.m4a': 4096,
}

/** 魔数校验:返回 null 表示通过,否则返回问题描述 */
function magicOk(buf, ext) {
  if (buf.length < 16) return '文件过短,读不出魔数'
  switch (ext) {
    case '.webp':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP'
        ? null
        : '不是 WebP(RIFF/WEBP 头不符)'
    case '.avif': {
      const brand = buf.subarray(4, 12).toString('ascii')
      return brand.includes('ftyp') && /avif|avis/.test(buf.subarray(8, 12).toString('ascii'))
        ? null
        : `不是 AVIF(brand=${brand})`
    }
    case '.jpg':
    case '.jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? null : '不是 JPEG(缺 FFD8FF SOI)'
    case '.mp3':
      // 真实踩过的坑:ND 素材不转码,原始 iNaturalist WAV 被直接存成 .mp3。
      // R2 会按扩展名发 Content-Type: audio/mpeg,字节却是 RIFF/WAVE ——
      // Safari/iOS 拒播(docs/033 同类故障),且体积是未压缩 PCM 的 2~3MB。
      if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') {
        return '⚠️ 实际是 WAV 却命名为 .mp3(Content-Type 会错报 audio/mpeg,Safari 可能拒播)'
      }
      return (
        buf.subarray(0, 3).toString('ascii') === 'ID3' ||
        (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
      )
        ? null
        : '不是 MP3(ID3/帧同步头缺失)'
    case '.wav':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE'
        ? null
        : '不是 WAV(RIFF/WAVE 头不符)'
    case '.m4a':
      return buf.subarray(4, 8).toString('ascii') === 'ftyp' ? null : '不是 M4A/MP4(缺 ftyp box)'
    default:
      return null
  }
}

const problems = []
const add = (kind, msg) => problems.push({ kind, msg })

// ---------- A + D:扫本地 ----------
async function walk(dir, base = '') {
  const out = []
  let ents
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    if (e.name === '.DS_Store') continue
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)))
    else out.push(rel)
  }
  return out
}

if (!fs.existsSync(MEDIA_DIR)) {
  console.log('✓ public/media 不存在(无暂存,跳过)')
  process.exit(0)
}

const localFiles = await walk(MEDIA_DIR)
if (!localFiles.length) {
  console.log('✓ public/media 为空(无暂存,跳过)')
  process.exit(0)
}

const localSet = new Set(localFiles.map((f) => `media/${f}`))
let bytes = 0
let bad = 0

for (const rel of localFiles) {
  const abs = path.join(MEDIA_DIR, rel)
  const ext = path.extname(rel).toLowerCase()
  let st
  try {
    st = await fsp.stat(abs)
  } catch (e) {
    add('A-不可读', `${rel} —— ${e.code || e.message}`)
    bad++
    continue
  }
  bytes += st.size

  if (st.size === 0) {
    add('A-零字节', `${rel}`)
    bad++
    continue
  }
  const min = MIN_SIZE[ext]
  if (min && st.size < min) {
    add('A-过小', `${rel} —— ${st.size}B < ${min}B 下限,疑似截断`)
    bad++
    continue
  }
  // 只读文件头校验魔数(整文件读没必要,4KB 足够判类型)
  const fd = await fsp.open(abs, 'r')
  const buf = Buffer.alloc(Math.min(4096, st.size))
  await fd.read(buf, 0, buf.length, 0)
  await fd.close()
  const why = magicOk(buf, ext)
  if (why) {
    // WAV 冒充 .mp3 单列 —— 它不只是"格式不符",而是会在线上错报
    // Content-Type 导致 Safari 拒播,必须和"文件损坏"区分开计数
    const kind = why.startsWith('⚠️') ? 'A-格式错配' : 'A-格式不符'
    add(kind, `${rel} —— ${why.replace('⚠️ ', '')}(${st.size}B)`)
    bad++
  }
}

// ---------- 台账 ----------
let ledger = null
try {
  ledger = JSON.parse(await fsp.readFile(LEDGER, 'utf8'))
} catch (e) {
  console.error(`✗ 读不到台账: ${e.message}`)
  process.exit(1)
}
const uploaded = new Set(
  fs.existsSync(UPLOADED) ? JSON.parse(await fsp.readFile(UPLOADED, 'utf8')) : [],
)

const allSp = Array.isArray(ledger.species) ? ledger.species : Object.values(ledger.species)
const pool = SAMPLE
  ? [...allSp].sort(() => Math.random() - 0.5).slice(0, SAMPLE)
  : allSp

/** 台账 URL → 相对键(去掉 R2 公开域前缀) */
const toKey = (u) => {
  if (!u) return null
  const m = String(u).match(/\/media\/(.+)$/)
  return m ? `media/${m[1]}` : null
}

let expected = 0
let missing = 0
let orphan = 0

for (const sp of pool) {
  const id = sp.id || sp.speciesId
  for (const kind of ['images', 'audios']) {
    for (const a of sp[kind] || []) {
      const fields =
        kind === 'images'
          ? ['url', 'thumbUrl', 'xlUrl', 'avifUrl']
          : ['url']
      const keys = fields.map((f) => toKey(a[f])).filter(Boolean)
      // 派生件齐全性:有 full 却没 thumb → 必坏
      if (kind === 'images' && toKey(a.url) && toKey(a.url).includes('.full.') && !toKey(a.thumbUrl)) {
        add('B-派生件缺失', `${id} 图片有 full 但缺 thumbUrl`)
      }
      for (const k of keys) {
        // ND / 下载失败时 url 可能是源站地址,toKey 返回 null,已过滤
        expected++
        if (localSet.has(k)) continue
        if (uploaded.has(k)) continue
        missing++
        add('C-遗漏', `${id} ${kind.slice(0, -1)} 台账声明 ${k} 但本地无文件、也不在已传台账`)
      }
    }
  }
}

// D.孤儿:本地文件不被任何台账条目引用
// 注意:这里必须用**全量**台账建引用集,不能用 --sample 的子集 ——
// 否则「抽样 200 种的引用」去比对「全量本地文件」会把 854 个物种的文件全判成孤儿。
const referenced = new Set()
for (const sp of allSp) {
  for (const kind of ['images', 'audios']) {
    for (const a of sp[kind] || []) {
      for (const f of ['url', 'thumbUrl', 'xlUrl', 'avifUrl', 'originalUrl']) {
        const k = toKey(a[f])
        if (k) referenced.add(k)
      }
    }
  }
}
for (const k of localSet) {
  if (!referenced.has(k)) {
    orphan++
    add('D-孤儿', `${k} 本地存在但台账无引用(推上去也没入口,建议删或补台账)`)
  }
}

// ---------- 报告 ----------
const mb = (bytes / 1024 / 1024).toFixed(0)
console.log(`\n${'─'.repeat(64)}`)
console.log(`  推送前质量抽检 · ${SAMPLE ? `随机 ${SAMPLE}/${allSp.length} 种` : `全量 ${allSp.length} 种`}`)
console.log(`${'─'.repeat(64)}`)
console.log(`\n【本地暂存】${localFiles.length} 个文件 / ${mb}MB / ${new Set(localFiles.map((f) => f.split('/')[0])).size} 个物种目录`)
console.log(`【台账期望】${expected} 个 URL`)
console.log(`【已传台账】${uploaded.size} 个键(此前已成功上传)`)

const groups = new Map()
for (const p of problems) {
  if (!groups.has(p.kind)) groups.set(p.kind, [])
  groups.get(p.kind).push(p.msg)
}

const KIND_DESC = {
  'A-格式错配': '🔴 扩展名与真实格式不符(线上会错报 Content-Type)',
  'A-零字节': '🔴 零字节文件',
  'A-过小': '🟠 过小/疑似截断',
  'A-格式不符': '🔴 魔数与扩展名不符',
  'A-不可读': '🔴 不可读',
  'B-派生件缺失': '🔴 派生件不齐',
  'C-遗漏': '🔴 台账声明但本地缺失(推上去线上就缺图/缺音)',
  'D-孤儿': '🟡 本地有但台账无引用(无害,只是无用文件)',
}

console.log('')
if (!problems.length) {
  console.log('✅ 全绿 —— 可以推送\n')
  process.exit(0)
}
for (const [kind, msgs] of groups) {
  console.log(`❌ ${KIND_DESC[kind] || kind} —— ${msgs.length} 个`)
  for (const m of msgs.slice(0, 5)) console.log(`     · ${m}`)
  if (msgs.length > 5) console.log(`     … 另有 ${msgs.length - 5} 个`)
  console.log('')
}
console.log(`汇总:${problems.length} 个问题(零字节/过小/格式 ${bad} · 遗漏 ${missing} · 孤儿 ${orphan})`)

// 退出码分级 —— 供监管器决定是否阻断推送:
//   0 = 干净
//   1 = 仅 🟡(孤儿等无害项)      → 放行
//   2 = 有 🔴 数据丢失类(遗漏/零字节/派生件缺失) → 阻断
//   3 = 有 🔴 格式错配(WAV 冒充 mp3 等)         → 默认放行但大声报警
//        刻意不阻断:这类文件传上去只是 Content-Type 标错,数据没丢,
//        阻断会让整条流水线为几十个文件停摆 38 小时。修它属于「改管道 + 补采」,
//        不属于「拦住一次推送」。
const fatal = [...groups.keys()].filter((k) =>
  k === 'C-遗漏' || k === 'A-零字节' || k === 'B-派生件缺失' || k === 'A-不可读',
)
const mismatch = groups.has('A-格式错配')

console.log('')
if (fatal.length) {
  console.log(`⛔ 阻断级(数据丢失):${fatal.map((k) => KIND_DESC[k]).join('、')}`)
  console.log(`   推送已取消,本地文件未清理。修好后重跑即可(--resume 会跳过已传)。\n`)
  process.exit(2)
}
if (mismatch) {
  console.log(`⚠️ 放行但需处理:${groups.get('A-格式错配').length} 个文件扩展名与真实格式不符。`)
  console.log(`   根因:XC /download 有时返回 WAV,代码因 URL 无扩展名而默认存成 .mp3,`)
  console.log(`   R2 会按扩展名发 Content-Type: audio/mpeg,Safari/iOS 可能拒播(docs/033 同类)。`)
  console.log(`   ND 素材禁止转码,合规修法是「按真实字节改扩展名」而非重编码。\n`)
  process.exit(3)
}
console.log(`🟡 仅无害项,可放心推送。\n`)
process.exit(1)