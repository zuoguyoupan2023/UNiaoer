import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { MediaAsset } from '@/types'
import SpeciesGallery from '../SpeciesGallery.vue'

function asset(id: string, type: 'image' | 'audio'): MediaAsset {
  return {
    id,
    speciesId: 'sp',
    type,
    url: `https://example.test/${id}.${type === 'image' ? 'jpg' : 'mp3'}`,
    license: 'CC-BY',
    licenseUrl: '',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

describe('SpeciesGallery', () => {
  it('素材 ≤1 时不渲染', () => {
    const w = mount(SpeciesGallery, { props: { images: [asset('i0', 'image')], audios: [] } })
    expect(w.find('.sg').exists()).toBe(false)
  })

  it('select 模式：点击发射 select（同类型照片）', async () => {
    const target = asset('i1', 'image')
    const w = mount(SpeciesGallery, {
      props: { images: [asset('i0', 'image'), target], audios: [], mode: 'select' },
    })
    await w.find('.sg-toggle').trigger('click')
    await w.findAll('.sg-thumb')[1]!.trigger('click')
    expect(w.emitted('select')?.[0]?.[0]).toEqual(target)
  })

  it('select 模式：跨类型录音点击也发射 select', async () => {
    const clip = asset('a0', 'audio')
    const w = mount(SpeciesGallery, {
      props: { images: [asset('i0', 'image')], audios: [clip], mode: 'select' },
    })
    await w.find('.sg-toggle').trigger('click')
    await w.find('.sg-audio').trigger('click')
    expect(w.emitted('select')?.[0]?.[0]).toEqual(clip)
  })
})
