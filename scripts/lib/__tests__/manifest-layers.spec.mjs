/**
 * 029 M1:manifest 分层拆分纯函数单测(toCore / toAssetBuckets / toGlobalPool / bucketOf)。
 */
import { describe, expect, it } from 'vitest'
import {
  bucketOf,
  resolveBucket,
  splitLargeBuckets,
  subBucketOf,
  toCore,
  toAssetBuckets,
  toGlobalPool,
} from '../manifest-layers.mjs'

const asset = (id, n, kind = 'image') => ({
  url: `https://bird.wewalk.world/media/${id}/image-${n}.full.webp`,
  thumbUrl: `https://bird.wewalk.world/media/${id}/image-${n}.thumb.webp`,
  license: 'CC-BY',
  author: 'A',
  source: 'iNaturalist',
  sourceUrl: 'https://example.org/1',
  type: kind,
  speciesId: id,
  transcode: true,
  // 详情层专属字段:core 不应携带
  originalUrl: 'https://src.example.org/x.jpg',
})

const manifest = {
  schemaVersion: 2,
  generatedAt: '2026-10-08T00:00:00.000Z',
  policy: 'relaxed',
  mediaMode: 'stage',
  source: 'public/data/species-index.json',
  perSpecies: 1,
  total: 3,
  stats: { withImage: 3, withAudio: 2 },
  species: [
    {
      id: 'abeillia-abeillei',
      nameZh: '翠颏蜂鸟',
      nameSci: 'Abeillia abeillei',
      family: 'Trochilidae',
      taxonKey: 'avibase-1',
      commonness: 3,
      playable: true,
      playableImage: true,
      playableAudio: true,
      desc: '详情层字段',
      location: 'x',
      habit: 'y',
      images: [asset('abeillia-abeillei', 1), asset('abeillia-abeillei', 2)],
      audios: [asset('abeillia-abeillei', 1, 'audio'), asset('abeillia-abeillei', 2, 'audio')],
      notes: { titleZh: '注', titleEn: 'n', bodyZh: 'b', bodyEn: 'b' },
    },
    {
      id: 'zosterops-stalkeri',
      nameZh: '',
      nameSci: 'Zosterops stalkeri',
      family: 'Zosteropidae',
      taxonKey: 'avibase-2',
      commonness: 5,
      playable: true,
      playableImage: true,
      playableAudio: false,
      image: asset('zosterops-stalkeri', 1),
      audio: null,
      images: [asset('zosterops-stalkeri', 1)],
      audios: [],
    },
    {
      id: '1weird-id',
      nameSci: 'Weirdus idus',
      family: 'X',
      playable: false,
      images: [],
      audios: [],
    },
  ],
}

describe('bucketOf', () => {
  it('首字母 a-z 用字母桶,其余进 0-9', () => {
    expect(bucketOf('abeillia-abeillei')).toBe('a')
    expect(bucketOf('Zosterops-stalkeri')).toBe('z')
    expect(bucketOf('1weird-id')).toBe('0-9')
    expect(bucketOf('-leading-dash')).toBe('0-9')
    expect(bucketOf('')).toBe('0-9')
  })
})

describe('splitLargeBuckets / resolveBucket', () => {
  it('小桶原样保留,大桶按前两位拆分', () => {
    const small = { a: { 'abeillia-abeillei': { x: 1 } } }
    const out = splitLargeBuckets(small, 1000)
    expect(Object.keys(out)).toEqual(['a'])

    const big = {
      p: {
        'passer-montanus': { v: 'x'.repeat(300) },
        'pycnonotus-sinensis': { v: 'y'.repeat(300) },
        'phylloscopus-collybita': { v: 'z'.repeat(300) },
      },
    }
    const out2 = splitLargeBuckets(big, 200)
    expect(Object.keys(out2).sort()).toEqual(['pa', 'ph', 'py'])
    expect(Object.keys(out2.pa)).toEqual(['passer-montanus'])
  })

  it('确定性:同输入同输出;0-9 桶永不拆', () => {
    const big = { '0-9': { '1abc': { v: 'x'.repeat(500) } } }
    expect(splitLargeBuckets(big, 10)).toEqual(big)
    const a = splitLargeBuckets({ p: { 'pa-x': { v: 'x'.repeat(50) } } }, 10)
    const b = splitLargeBuckets({ p: { 'pa-x': { v: 'x'.repeat(50) } } }, 10)
    expect(a).toEqual(b)
  })

  it('resolveBucket:先两位子桶,再一位桶', () => {
    expect(resolveBucket('passer-montanus', ['pa', 'py'])).toBe('pa')
    expect(resolveBucket('passer-montanus', ['a', 'p'])).toBe('p')
    expect(resolveBucket('zosterops-stalkeri', ['a', 'z'])).toBe('z')
    // 都不在清单:容错回退一位桶名
    expect(resolveBucket('passer-montanus', [])).toBe('p')
  })

  it('subBucketOf:两位字母/退化情形', () => {
    expect(subBucketOf('passer-montanus')).toBe('pa')
    expect(subBucketOf('a1-thing')).toBe('a1')
    expect(subBucketOf('a-b')).toBe('a_')
    expect(subBucketOf('1abc')).toBe('0-9')
  })
})

describe('toCore', () => {
  const core = toCore(manifest)

  it('只留名录字段 + 首图首音,不透传详情层字段', () => {
    const sp = core.species[0]
    expect(sp.nameZh).toBe('翠颏蜂鸟')
    expect(sp.commonness).toBe(3)
    expect(sp.image.url).toContain('image-1.full.webp')
    expect(sp.audio.url).toContain('image-1.full.webp')
    // 详情层字段不进 core
    expect(sp.desc).toBeUndefined()
    expect(sp.images).toBeUndefined()
    expect(sp.audios).toBeUndefined()
    // notes/profile 体量小且被无 loading 态的页面直读 → 随 core 提供
    expect(sp.notes.titleZh).toBe('注')
    // 素材只留答题必需字段
    expect(sp.image.originalUrl).toBeUndefined()
    expect(sp.image.license).toBe('CC-BY')
  })

  it('兼容单值 image/audio(无数组时)', () => {
    const sp = core.species[1]
    expect(sp.image.url).toContain('zosterops-stalkeri/image-1.full.webp')
    expect(sp.audio).toBeUndefined()
  })

  it('无素材物种保留名录条目但不带 image/audio', () => {
    const sp = core.species[2]
    expect(sp.id).toBe('1weird-id')
    expect(sp.image).toBeUndefined()
    expect(sp.audio).toBeUndefined()
  })

  it('顶层带 layer/buckets/stats', () => {
    expect(core.layer).toBe('core')
    expect(core.buckets).toEqual(['0-9', 'a', 'z'])
    expect(core.total).toBe(3)
    expect(core.stats.withImage).toBe(2)
    expect(core.stats.withAudio).toBe(1)
  })

  it('体积显著小于原 manifest(core 只带首图首音)', () => {
    const full = JSON.stringify(manifest).length
    const slim = JSON.stringify(core).length
    expect(slim).toBeLessThan(full * 0.6)
  })
})

describe('toAssetBuckets', () => {
  const buckets = toAssetBuckets(manifest)

  it('按桶拆分且保留完整素材数组', () => {
    expect(Object.keys(buckets).sort()).toEqual(['a', 'z'])
    expect(buckets.a['abeillia-abeillei'].images).toHaveLength(2)
    expect(buckets.a['abeillia-abeillei'].audios).toHaveLength(2)
    expect(buckets.z['zosterops-stalkeri'].images).toHaveLength(1)
  })

  it('notes/profile 留在 core,不进分片(避免重复)', () => {
    expect(buckets.a['abeillia-abeillei'].notes).toBeUndefined()
    expect(toCore(manifest).species[0].notes.titleZh).toBe('注')
  })

  it('空物种(无素材)不进桶', () => {
    expect(buckets['0-9']).toBeUndefined()
  })

  it('core 首图 === 分片 images[0](一致性:两级不能各说一套)', () => {
    const core = toCore(manifest)
    const mismatches = []
    for (const sp of core.species) {
      const b = bucketOf(sp.id)
      const entry = buckets[b]?.[sp.id]
      if (entry?.images?.length && entry.images[0].url !== sp.image.url) mismatches.push(sp.id)
      if (entry?.audios?.length && entry.audios[0].url !== sp.audio.url) mismatches.push(sp.id)
    }
    expect(mismatches).toEqual([])
    expect(core.species.length).toBeGreaterThan(0)
  })
})

describe('toGlobalPool', () => {
  it('只收有素材物种,带 layer:global,且为 core 同构', () => {
    const pool = toGlobalPool(manifest)
    expect(pool.layer).toBe('global')
    expect(pool.total).toBe(2)
    expect(pool.species[0].image).toBeDefined()
    expect(pool.species[0].images).toBeUndefined()
    expect(pool.species.map((s) => s.id)).toEqual(['abeillia-abeillei', 'zosterops-stalkeri'])
  })
})
