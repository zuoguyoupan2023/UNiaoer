import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSqlZip, parseTsv, planChunks, readZipEntry, tsvToObjects } from '../gbif-sql-lib.mjs'

const fixture = (name) => readFileSync(path.resolve(process.cwd(), 'tests/fixtures/region/gbif-sql', name))

describe('readZipEntry', () => {
  it('解出 deflate 压缩的单条目内容（真实 GBIF 下载样本）', () => {
    const { name, data } = readZipEntry(fixture('ie-count.zip'))
    expect(name).toBe('0008186-260928105237408.csv')
    expect(data.toString('utf8')).toBe('countrycode\tn\nIE\t8012272\n')
  })
  it('非法 zip 抛错（过短 / 无 EOCD）', () => {
    expect(() => readZipEntry(Buffer.from('not a zip'))).toThrow(/zip/)
    expect(() => readZipEntry(Buffer.alloc(64, 1))).toThrow(/EOCD/)
  })
})

describe('parseTsv / tsvToObjects', () => {
  it('去 BOM、CRLF，保留空结果（仅表头）', () => {
    expect(parseTsv('\uFEFFa\tb\r\n1\t2\r\n')).toEqual({ columns: ['a', 'b'], rows: [['1', '2']] })
    expect(parseTsv('countrycode\tn\n')).toEqual({ columns: ['countrycode', 'n'], rows: [] })
    expect(parseTsv('')).toEqual({ columns: [], rows: [] })
  })
  it('对象化并补缺列', () => {
    const objs = tsvToObjects({ columns: ['a', 'b', 'c'], rows: [['1']] })
    expect(objs).toEqual([{ a: '1', b: '', c: '' }])
  })
})

describe('parseSqlZip', () => {
  it('端到端：zip → 对象数组', () => {
    expect(parseSqlZip(fixture('ie-count.zip'))).toEqual([{ countrycode: 'IE', n: '8012272' }])
  })
})

/**
 * 分块下载计划（036 期间修 GBIF 下载截断 bug 时抽出）。
 * 末块边界是最易错处：必须恰好覆盖到 total-1，且不越界。
 */
describe('planChunks（分块下载计划）', () => {
  it('整除：均分且末块完整', () => {
    expect(planChunks(4_000_000, 1_000_000)).toEqual([
      [0, 999_999],
      [1_000_000, 1_999_999],
      [2_000_000, 2_999_999],
      [3_000_000, 3_999_999],
    ])
  })

  it('不整除：末块取剩余（闭区间到 total-1）', () => {
    expect(planChunks(2_500_000, 1_000_000)).toEqual([
      [0, 999_999],
      [1_000_000, 1_999_999],
      [2_000_000, 2_499_999],
    ])
  })

  it('小于一块：单块覆盖全长', () => {
    expect(planChunks(1234, 1_000_000)).toEqual([[0, 1233]])
  })

  it('分块能无缝拼接（区间连续且总长 = total）', () => {
    const total = 8_335_262 // 真实 GBIF 下载大小（036 实测）
    const chunks = planChunks(total, 1_000_000)
    let cursor = 0
    for (const [start, end] of chunks) {
      expect(start).toBe(cursor)
      cursor = end + 1
    }
    expect(cursor).toBe(total)
  })

  it('0 / 负数 / 非法 chunk → 空数组（调用方按错误处理）', () => {
    expect(planChunks(0)).toEqual([])
    expect(planChunks(-1)).toEqual([])
    expect(planChunks(100, 0)).toEqual([])
    expect(planChunks(Number.NaN)).toEqual([])
  })
})
