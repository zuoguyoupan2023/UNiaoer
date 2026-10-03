/**
 * 022 §1.7 GBIF SQL Download 纯函数（不碰网络/文件系统，可单测）。
 * GBIF SQL 下载结果 = 单个 zip，内含一个「制表符分隔」的 {key}.csv。
 */
import zlib from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50

/** 从 zip Buffer 取第一个（或指定 name）条目的内容；支持 stored(0)/deflate(8)。 */
export function readZipEntry(buf, { name = null } = {}) {
  if (!buf || buf.length < 22) throw new Error(`gbif-sql: 数据不是有效 zip（仅 ${buf ? buf.length : 0} 字节）`)
  const minStart = Math.max(0, buf.length - 22 - 65535)
  let eocd = -1
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('gbif-sql: 非法 zip（找不到 EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== CENTRAL_SIG) throw new Error('gbif-sql: 非法 zip（中央目录）')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const fnLen = buf.readUInt16LE(off + 28)
    const exLen = buf.readUInt16LE(off + 30)
    const cmLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const entryName = buf.toString('utf8', off + 46, off + 46 + fnLen)
    if (!name || entryName === name) {
      const lfnLen = buf.readUInt16LE(localOff + 26)
      const lexLen = buf.readUInt16LE(localOff + 28)
      const raw = buf.subarray(localOff + 30 + lfnLen + lexLen)
      const data = method === 0 ? Buffer.from(raw.subarray(0, compSize)) : zlib.inflateRawSync(raw.subarray(0, compSize))
      return { name: entryName, data }
    }
    off += 46 + fnLen + exLen + cmLen
  }
  throw new Error(`gbif-sql: zip 内未找到条目${name ? ` ${name}` : ''}`)
}

/** TSV 文本 → { columns, rows }（去 BOM/CRLF，末尾空行丢弃）。 */
export function parseTsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (!lines.length) return { columns: [], rows: [] }
  return { columns: lines[0].split('\t'), rows: lines.slice(1).map((l) => l.split('\t')) }
}

/** { columns, rows } → 对象数组（缺列补空串）。 */
export function tsvToObjects({ columns, rows }) {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])))
}

/** zip Buffer → 对象数组（readZipEntry + parseTsv + tsvToObjects）。 */
export function parseSqlZip(buf, opts) {
  const { data } = readZipEntry(buf, opts)
  return tsvToObjects(parseTsv(data.toString('utf8')))
}
