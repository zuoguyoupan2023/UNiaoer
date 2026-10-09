import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Manifest, BankSpecies } from '@/core/bank'
import type { MediaAsset } from '@/types'

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn<() => Promise<void>>() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function media(id: string, kind: 'image' | 'audio'): MediaAsset {
  return {
    id,
    speciesId: 'sp',
    type: kind,
    url: `https://example.test/${id}.${kind === 'image' ? 'webp' : 'mp3'}`,
    thumbUrl: kind === 'image' ? `https://example.test/${id}.thumb.webp` : undefined,
    license: 'CC-BY',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

function sp(id: string, nameZh: string): BankSpecies {
  const images = Array.from({ length: 5 }, (_, i) => media(`${id}-i${i}`, 'image'))
  const audios = Array.from({ length: 5 }, (_, i) => media(`${id}-a${i}`, 'audio'))
  return {
    id,
    nameZh,
    nameSci: `${id} sci`,
    family: '测试科',
    commonness: 1,
    desc: '',
    location: '',
    habit: '',
    image: images[0]!,
    audio: audios[0]!,
    images,
    audios,
  }
}

const manifest: Manifest = {
  generatedAt: '',
  policy: 'relaxed',
  mediaMode: 'remote',
  total: 3,
  stats: { withImage: 3, withAudio: 3 },
  species: [sp('a', '甲鸟'), sp('b', '乙鸟'), sp('c', '丙鸟')],
}

vi.mock('@/core/bank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/bank')>()),
  loadBank: vi.fn<() => Promise<Manifest>>(async () => manifest),
}))

import QuizPlay from '../QuizPlay.vue'

describe('QuizPlay C3 画廊', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    pushMock.mockClear()
  })

  it('L1 也展示全部图/音；但当前题面素材被排除（去冗余，2026-10-09）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const wrapper = mount(QuizPlay, { props: { type: 'image' } })
      await flushPromises()
      const tierBtn = wrapper.findAll('.tier').find((b) => b.text().includes('L1'))!
      await tierBtn.trigger('click')
      await flushPromises()
      await wrapper.findAll('.regime')[0]!.trigger('click')
      await flushPromises()
      const startBtn = wrapper.findAll('.intro button').find((b) => b.text().includes('开始答题'))!
      await startBtn.trigger('click')
      await flushPromises()

      // 打开画廊
      const toggle = wrapper.find('.sg-toggle')
      expect(toggle.exists()).toBe(true)
      await toggle.trigger('click')
      await flushPromises()

      // 图题：题面那张图不再列出（4 = 5 − 题面），跨类型录音 5 条全在
      expect(wrapper.findAll('.sg-thumb')).toHaveLength(4)
      expect(wrapper.findAll('.sg-audio')).toHaveLength(5)
      // 计数标签也应为过滤后的 9
      expect(toggle.text()).toContain('9')

      // 题面图确实不在列表里（选中态不存在 → 列表里没有任何高亮项）
      expect(wrapper.findAll('.sg-thumb.on')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
