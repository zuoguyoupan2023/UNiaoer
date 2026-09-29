import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetBankCache,
  loadBank,
  speciesNameById,
  speciesNameByStoredName,
  type Manifest,
} from '../bank'

const manifest: Manifest = {
  generatedAt: '',
  policy: '',
  mediaMode: '',
  total: 2,
  stats: { withImage: 2, withAudio: 0 },
  species: [
    {
      id: 'a',
      nameZh: '甲鸟',
      nameEn: 'Bird A',
      nameSci: 'A avis',
      family: '甲科',
      commonness: 1,
      desc: '',
      location: '',
      habit: '',
      image: null,
      audio: null,
    },
    {
      id: 'b',
      nameZh: '乙鸟',
      nameEn: 'Bird B',
      nameSci: 'B avis',
      family: '乙科',
      commonness: 1,
      desc: '',
      location: '',
      habit: '',
      image: null,
      audio: null,
    },
  ],
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

describe('speciesNameById / speciesNameByStoredName（015 #1 记录名按 locale 解析）', () => {
  beforeEach(async () => {
    _resetBankCache()
    stubFetch()
    await loadBank()
  })

  it('按 speciesId 解析：zh 用 nameZh，en 用 nameEn', () => {
    expect(speciesNameById('a', 'zh-CN')).toBe('甲鸟')
    expect(speciesNameById('a', 'en')).toBe('Bird A')
  })

  it('按存储名反查（旧记录无 chosenId 的错选名）：中文名/英文名都能命中', () => {
    expect(speciesNameByStoredName('甲鸟', 'en')).toBe('Bird A')
    expect(speciesNameByStoredName('甲鸟', 'zh-CN')).toBe('甲鸟')
    expect(speciesNameByStoredName('Bird B', 'zh-CN')).toBe('乙鸟')
    expect(speciesNameByStoredName('Bird B', 'en')).toBe('Bird B')
    expect(speciesNameByStoredName('A avis', 'en')).toBe('Bird A')
  })

  it('未知 id / 未知名字返回 undefined（调用方回退存储字符串）', () => {
    expect(speciesNameById('nope', 'en')).toBeUndefined()
    expect(speciesNameByStoredName('不存在的鸟', 'en')).toBeUndefined()
    expect(speciesNameByStoredName(null, 'en')).toBeUndefined()
  })
})
