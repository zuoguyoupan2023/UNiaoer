#!/usr/bin/env node
/**
 * `/duyin` 中文鸟名读音页的数据产物（构建期预计算，**不引前端依赖**）。
 *
 * 产物：`public/data/duyin.json`
 *   { schemaVersion, generatedAt, sources[], counts, buckets{ a: [entry…] } }
 *   entry = { zh, py, tone, light, sci, en, key, nameZhSource, rankCN?, inCN }
 *
 * 为什么在构建期算：`pinyin-pro` 是仓库**已有的** devDependency（`scripts/lib/pinyin-key.mjs`
 * 早就在用），但把它打进前端会白撑首屏 bundle —— 与 2026-10-17 onnxruntime 27 MiB 事故同一类错误。
 * 所以这里算好落成 JSON，前端只读文件。
 *
 * 拼音口径（与 `pinyin-key.mjs` 一致但**多带两样东西**）：
 *  · `py`  —— 带声调符号的拼音（`xǐ què`），ü 保留（不转 v，因为这是给人读的）；
 *  · `light` —— **轻声位置**（哪个字读轻声），用 `toneType:'num'` 的 `0` 判定（实测 pinyin-pro 用 0 表示轻声）；
 *  · 生僻字（拼音库未收录，如 䳍 䴉）→ `CHAR_OVERRIDES` 人工校准，读不出来就**落盘上报**，不猜。
 *
 * 中文名来源（`species-index.json.nameZh`，与名录页同源）：
 *  curated 1,292（人工审校）+ wikidata 4,516 → 合计 5,808 种（52.2%）。**没有中文名的种不进本页**
 * （页面是「中文鸟名读音」，无名可读）。同名不同种保留多条（各带学名）。
 *
 * CLI：npm run build:duyin [-- --check]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinyin } from 'pinyin-pro'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public/data/duyin.json')
const args = process.argv.slice(2)
const CHECK_ONLY = args.includes('--check')

/** 生僻鸟名用字：拼音库未收录的扩展区字（读音据通行鸟类名录，带声调符号）。
 *  与 `scripts/lib/pinyin-key.mjs` 的 CHAR_OVERRIDES 是同一批字，这里多给声调符号与音节数。
 *  ⚠️ 标 `provisional` 的读音是**按偏旁/同源字推定**，需人工确认后去掉标记。 */
const CHAR_OVERRIDES = new Map([
  ['䳍', { sym: 'gōng', num: 'gong1' }], // 䳍形目 / 穴䳍(tinamou)
  ['䳭', { sym: 'jī', num: 'ji1' }], // 石䳭(chat)
  ['䴉', { sym: 'huán', num: 'huan2' }], // 朱䴉(ibis，「鹮」的异体)
  // 棘头𱉐 Pityriasis gymnocephala —— 与「鵙」(pí，伯劳属) 同源字。**provisional**：推定读音，待人工确认。
  ['𱉐', { sym: 'pí', num: 'pi2' }],
])

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{323af}]/u

/** 单字 → {py 带调, num 数字调}；未收录返回 null */
function syllable(ch) {
  const sym = pinyin(ch, { toneType: 'symbol' })
  const num = pinyin(ch, { toneType: 'num' })
  const override = CHAR_OVERRIDES.get(ch)
  if (override) return { py: override.sym, num: override.num, tone: null }
  // pinyin-pro 对未收录的字**原样返回该字**（实测：䳍 → "䳍"）。这比正则判定可靠，
  // 早期版本用音节字符集正则反而把「鸠 鹉 隼 乌 朱」这些常用字误判成未收录。
  if (sym === ch) return null
  const tone = /^([a-zü]+)(\d)$/i.exec(num)?.[2] ?? null
  return { py: sym, num, tone }
}

/** 中文名 → { py 带调整串, pyNum 数字调, light 轻声字下标, unknown 未收录字 } */
function pronounce(name) {
  const chars = [...String(name || '').normalize('NFC')].filter((c) => HAN.test(c))
  const parts = []
  const nums = []
  const light = []
  const unknown = []
  chars.forEach((ch, i) => {
    const s = syllable(ch)
    if (!s) {
      unknown.push(ch)
      parts.push(ch)
      nums.push(ch)
      return
    }
    parts.push(s.py)
    nums.push(s.num)
    // num 模式返回 `zi0` → 0 即轻声（实测 pinyin-pro 约定）
    if (s.tone === '0') light.push(i)
  })
  return { py: parts.join(' '), pyNum: nums.join(' '), light, unknown, chars: chars.length }
}

async function main() {
  const index = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/species-index.json'), 'utf8'))
  const meta = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/manifest-meta.json'), 'utf8'))
  const metaBySci = new Map((meta.species || []).map((s) => [s.nameSci, s]))

  const entries = []
  const unknownChars = new Map() // char → 出现次数（便于补 CHAR_OVERRIDES）
  for (const sp of index.species) {
    if (!sp.nameZh) continue
    const { py, pyNum, light, unknown } = pronounce(sp.nameZh)
    for (const ch of unknown) unknownChars.set(ch, (unknownChars.get(ch) || 0) + 1)
    const m = metaBySci.get(sp.nameSci) || {}
    entries.push({
      zh: sp.nameZh,
      py,
      pyNum,
      light,
      key: (py || sp.nameZh).toLowerCase().replace(/[^a-z]/g, ''),
      sci: sp.nameSci,
      en: sp.nameEn ?? null,
      family: sp.family ?? null,
      taxonKey: sp.taxonKey ?? null,
      rankCN: m.rankCN ?? null,
      inCN: Boolean(m.inCN),
    })
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.zh.localeCompare(b.zh, 'zh')))

  const buckets = {}
  for (const e of entries) {
    const k = e.key.charAt(0) || '#'
    ;(buckets[k] ||= []).push(e)
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note:
      '中文鸟名 + 带声调符号拼音 + 轻声位置。构建期由 scripts/build-duyin-index.mjs 生成' +
      '（pinyin-pro 为构建期依赖，不进前端 bundle）。中文名来源见 species-index.nameZh（curated/wikidata）；' +
      '没有中文名的种不在本页。light 是轻声字在名称中的下标（0 起），前端渲染时可加标记。',
    sources: [
      { key: 'pinyin-pro', name: 'pinyin-pro（构建期拼音库）', license: 'MIT' },
      {
        key: 'avilist',
        name: 'AviList v2025b（学名与 taxonKey）',
        url: 'https://doi.org/10.2173/avilist.v2025b',
        license: 'CC BY 4.0',
        citation: 'AviList Core Team. 2026. AviList: The Global Avian Checklist, v2025b. https://doi.org/10.2173/avilist.v2025b',
      },
      { key: 'wikidata', name: 'Wikidata 中文名（长尾种）', license: 'CC0' },
    ],
    counts: {
      total: entries.length,
      withPinyin: entries.filter((e) => e.py && !e.unknownCount).length,
      lightTone: entries.filter((e) => e.light.length).length,
      inCN: entries.filter((e) => e.inCN).length,
      buckets: Object.keys(buckets).length,
      unknownChars: unknownChars.size,
    },
    buckets,
  }

  if (CHECK_ONLY) {
    const problems = []
    if (!payload.counts.withPinyin) problems.push('没有任何条目有拼音')
    if (unknownChars.size) {
      problems.push(
        `未收录生僻字 ${unknownChars.size} 个：` +
          [...unknownChars.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([c, n]) => `${c}(${n})`)
            .join(' '),
      )
    }
    if (problems.length) {
      problems.forEach((p) => console.error(`❌ ${p}`))
      process.exit(1)
    }
    console.log(`✅ duyin.json 校验通过：${payload.counts.total} 条，其中中国可见 ${payload.counts.inCN}`)
    return
  }

  await fs.writeFile(OUT, JSON.stringify(payload) + '\n')
  const size = (await fs.stat(OUT)).size
  console.log(
    `✅ public/data/duyin.json：${payload.counts.total} 条中文名 · 有拼音 ${payload.counts.withPinyin} · 含轻声 ${payload.counts.lightTone} · 中国可见 ${payload.counts.inCN} · ${payload.counts.buckets} 桶 · ${(size / 1024).toFixed(0)} KB`,
  )
  if (unknownChars.size) {
    console.warn(
      `  ⚠️ 未收录生僻字 ${unknownChars.size} 个（已原样保留字形，拼音位为空）：` +
        [...unknownChars.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([c, n]) => `${c}(${n})`)
          .join(' '),
    )
    console.warn('     → 补 scripts/build-duyin-index.mjs 的 CHAR_OVERRIDES 后重跑')
  }
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
