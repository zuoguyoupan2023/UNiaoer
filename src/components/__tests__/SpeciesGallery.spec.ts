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

  it('去冗余：当前展示的素材被排除，1 图 1 音时只剩"另一种"', async () => {
    const img = asset('i0', 'image')
    const clip = asset('a0', 'audio')
    // 图题（active=图）：只列音频
    const imgMode = mount(SpeciesGallery, {
      props: { images: [img], audios: [clip], mode: 'select', activeUrl: img.url },
    })
    expect(imgMode.find('.sg').exists()).toBe(true) // 有一条非当前的素材 → 按钮要在
    await imgMode.find('.sg-toggle').trigger('click')
    expect(imgMode.findAll('.sg-thumb')).toHaveLength(0)
    expect(imgMode.findAll('.sg-audio')).toHaveLength(1)
    expect(imgMode.find('.sg-toggle').text()).toContain('1')
    // 音题（active=音）：只列图片
    const audioMode = mount(SpeciesGallery, {
      props: { images: [img], audios: [clip], mode: 'select', activeUrl: clip.url },
    })
    await audioMode.find('.sg-toggle').trigger('click')
    expect(audioMode.findAll('.sg-audio')).toHaveLength(0)
    expect(audioMode.findAll('.sg-thumb')).toHaveLength(1)
  })

  it('去冗余：切到跨类型后，原题面重新出现（列表随当前展示动态过滤）', async () => {
    const img0 = asset('i0', 'image')
    const img1 = asset('i1', 'image')
    const clip = asset('a0', 'audio')
    const w = mount(SpeciesGallery, {
      props: { images: [img0, img1], audios: [clip], mode: 'select', activeUrl: clip.url },
    })
    await w.find('.sg-toggle').trigger('click')
    expect(w.findAll('.sg-thumb')).toHaveLength(2) // 音题已切到音频 → 两张图都在
    expect(w.findAll('.sg-audio')).toHaveLength(0)
    // 模拟父级把"当前展示"切回图 0 → 图 0 被排除，录音回归列表
    await w.setProps({ activeUrl: img0.url })
    expect(w.findAll('.sg-thumb')).toHaveLength(1)
    expect(w.findAll('.sg-audio')).toHaveLength(1)
  })

  it('browse 模式（无 activeUrl）不过滤：结果页仍照旧全列', async () => {
    const w = mount(SpeciesGallery, {
      props: { images: [asset('i0', 'image')], audios: [asset('a0', 'audio')], mode: 'browse' },
    })
    await w.find('.sg-toggle').trigger('click')
    expect(w.findAll('.sg-thumb')).toHaveLength(1)
    expect(w.findAll('.sg-audio-row')).toHaveLength(1)
  })
})
