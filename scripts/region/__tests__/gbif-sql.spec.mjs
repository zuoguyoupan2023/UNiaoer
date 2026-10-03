import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSqlZip, parseTsv, readZipEntry, tsvToObjects } from '../gbif-sql-lib.mjs'

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
