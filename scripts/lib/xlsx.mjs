/**
 * 极简 xlsx 读取器（无第三方依赖）：只解析 sharedStrings + 工作表的字符串/数值单元格。
 *
 * 为什么要自己写：仓库里没有 xlsx 解析依赖，而新增依赖要过体积门禁与许可登记，
 * 实际上我们只需要读 1–2 个「机器生成的」工作表（几千行、几十列），
 * 用系统自带的 `unzip -p` + 定向正则足够，不值得为它引入一个包。
 *
 * 局限（够用即止，遇到即报错而不是猜）：
 *  · 不支持共享公式与日期格式换算（本项目只读文本/数字）
 *  · 不支持压缩流以外的加密/受保护工作簿
 *  · 只按 `<row>`/`<c>` 的原始顺序还原，缺失单元格补 null（**不做行列错位推断**）
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** 共享字符串表：<si> 里可能有多个 <t>（富文本），按出现顺序拼接 */
async function sharedStrings(file) {
  const { stdout } = await exec('unzip', ['-p', file, 'xl/sharedStrings.xml'], {
    maxBuffer: 256 * 1024 * 1024,
  })
  if (!stdout.trim()) return []
  const out = []
  for (const si of stdout.split('<si>').slice(1)) {
    const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1])
    out.push(unescapeXml(texts.join('')))
  }
  return out
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

const colToIndex = (ref) => {
  const m = /^([A-Z]+)/.exec(ref)
  if (!m) return -1
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * 读一个工作表 → { headers: string[], rows: (string|number|null)[][] }
 * @param {string} file  xlsx 路径
 * @param {string} sheet 工作表名（如 'species.level.data'）
 */
export async function readSheet(file, sheet) {
  // 先读 workbook.xml 拿到 sheet 名 → sheetN.xml 的映射
  const { stdout: wb } = await exec('unzip', ['-p', file, 'xl/workbook.xml'], { maxBuffer: 32 * 1024 * 1024 })
  const sheetRels = []
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    sheetRels.push({ name: decodeXmlName(m[1]), rid: m[2] })
  }
  if (!sheetRels.length) for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*sheetId="([^"]+)"/g)) {
    sheetRels.push({ name: decodeXmlName(m[1]), sheetId: m[2] })
  }
  const target = sheetRels.find((s) => s.name === sheet)
  if (!target) throw new Error(`工作表不存在：${sheet}（实际有：${sheetRels.map((s) => s.name).join(', ')}）`)

  // sheet 名 → xl/worksheets/sheetN.xml：先看 workbook rels 找 target，再退回按序号猜
  let sheetPath = null
  try {
    const { stdout: rels } = await exec('unzip', ['-p', file, 'xl/_rels/workbook.xml.rels'], {
      maxBuffer: 32 * 1024 * 1024,
    })
    const relMap = new Map()
    for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2])
    for (const m of rels.matchAll(/<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap.set(m[2], m[1])
    if (target.rid && relMap.has(target.rid)) sheetPath = 'xl/' + relMap.get(target.rid).replace(/^\/?xl\//, '')
  } catch {
    /* rels 读不到就用序号猜 */
  }
  if (!sheetPath) {
    const idx = sheetRels.indexOf(target) + 1
    sheetPath = `xl/worksheets/sheet${idx}.xml`
  }

  const strings = await sharedStrings(file)
  const { stdout: xml } = await exec('unzip', ['-p', file, sheetPath], { maxBuffer: 256 * 1024 * 1024 })

  const rows = []
  for (const rowXml of xml.split('<row').slice(1)) {
    const cells = []
    for (const m of rowXml.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1]
      const body = m[2] ?? ''
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]
      const type = /t="([^"]+)"/.exec(attrs)?.[1]
      let value = null
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1])).join('')
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        if (v !== undefined) {
          if (type === 's') value = strings[Number(v)] ?? null
          else if (type === 'str') value = unescapeXml(v)
          else if (v === 'NA' || v === '') value = null
          else {
            const n = Number(v)
            value = Number.isFinite(n) ? n : unescapeXml(v)
          }
        }
      }
      const ci = ref ? colToIndex(ref) : cells.length
      cells[ci] = value ?? null
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null
    rows.push(cells)
  }
  const headers = (rows.shift() || []).map((h) => (h === null ? '' : String(h)))
  return { headers, rows }
}

function decodeXmlName(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
