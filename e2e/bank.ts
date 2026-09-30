/**
 * E2E 夹具：程序化生成的小题库（12 种，每种 1 图 1 音）。
 * 媒体 URL 指向 cdn.e2e.invalid，由 page.route 统一拦截回占位图/占位音频，
 * 保证 E2E 不依赖真实网络与 R2。
 */
import type { MediaAsset } from '../src/types'

/** 夹具所需的最小 manifest 结构（经 page.route 直接回 JSON，与应用类型解耦） */
export interface FixtureSpecies {
  id: string
  nameZh: string
  nameEn: string
  nameSci: string
  family: string
  commonness: number
  desc: string
  location: string
  habit: string
  image: MediaAsset
  audio: MediaAsset
  images: MediaAsset[]
  audios: MediaAsset[]
}

export interface FixtureManifest {
  generatedAt: string
  policy: string
  mediaMode: string
  total: number
  stats: { withImage: number; withAudio: number }
  species: FixtureSpecies[]
}

export const MEDIA_HOST = 'https://cdn.e2e.invalid'

function imageAsset(speciesId: string, n: number): MediaAsset {
  return {
    speciesId,
    type: 'image',
    url: `${MEDIA_HOST}/media/${speciesId}/image-${n}.png`,
    thumbUrl: `${MEDIA_HOST}/media/${speciesId}/image-${n}.thumb.png`,
    xlUrl: `${MEDIA_HOST}/media/${speciesId}/image-${n}.xl.png`,
    license: 'CC-BY-4.0',
    author: 'e2e-fixture',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

function audioAsset(speciesId: string, n: number): MediaAsset {
  return {
    speciesId,
    type: 'audio',
    url: `${MEDIA_HOST}/media/${speciesId}/audio-${n}.mp3`,
    license: 'CC-BY-4.0',
    author: 'e2e-fixture',
    source: 'Xeno-canto',
    sourceUrl: '',
  }
}

export function buildBank(count = 12): FixtureManifest {
  const species = Array.from({ length: count }, (_, i) => {
    const id = `sp-${String(i + 1).padStart(2, '0')}`
    const nameZh = `测试鸟${i + 1}`
    return {
      id,
      nameZh,
      nameEn: `Test Bird ${i + 1}`,
      nameSci: `Testus birdus ${i + 1}`,
      family: '测试科',
      commonness: i < 8 ? 1 : 2,
      desc: '',
      location: '',
      habit: '',
      image: imageAsset(id, 1),
      audio: audioAsset(id, 1),
      images: [imageAsset(id, 1)],
      audios: [audioAsset(id, 1)],
    }
  })
  return {
    generatedAt: 'e2e-fixture',
    policy: 'relaxed',
    mediaMode: 'remote',
    total: count,
    stats: { withImage: count, withAudio: count },
    species,
  }
}

/** 1×1 透明 PNG */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** 静音占位（非有效音频即可——E2E 不断言真实播放） */
export const TINY_MP3 = Buffer.from(
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWG4REAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//uQxAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWG4REAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'base64',
)
