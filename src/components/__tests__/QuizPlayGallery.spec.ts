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

  it('L1 也展示全部图/音（各 5 个）', async () => {
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

      expect(wrapper.findAll('.sg-thumb')).toHaveLength(5) // 5 张照片
      expect(wrapper.findAll('.sg-audio')).toHaveLength(5) // 5 条录音（跨类型）
    } finally {
      vi.useRealTimers()
    }
  })
})
