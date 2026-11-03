/**
 * 铁律 11（2026-11-03）：作答后必须给出「A→鸟名」与「A→作者·许可证」两块。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import Answereview from '../AnswerReview.vue'
import zhCN from '@/i18n/locales/zh-CN'

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

function media(url: string, author: string, license: string) {
  return {
    url, thumbUrl: url, type: 'image' as const, license, author,
    source: 'iNaturalist', sourceUrl: 'https://www.inaturalist.org/observations/1',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  }
}

describe('AnswerReview（作答后的选项对照 + 来源署名）', () => {
  it('看名选图：两块都渲染（鸟名 + 图片署名）', () => {
    const w = mount(Answereview, {
      props: {
        options: ['红尾水鸲', '红耳鹎', '白腹鸫', '黑领椋鸟'],
        optionsMedia: [
          media('https://x/1.webp', '作者甲', 'CC-BY-NC'),
          media('https://x/2.webp', '作者乙', 'CC-BY'),
          media('https://x/3.webp', '作者丙', 'CC0'),
          media('https://x/4.webp', '作者丁', 'CC-BY-SA'),
        ],
        answer: '红耳鹎',
        chosen: '白腹鸫',
      },
      global: { plugins: [i18n] },
    })
    const text = w.text()
    // ① 选项对照：四个鸟名都在，且标注正确答案 / 你选的
    for (const n of ['红尾水鸲', '红耳鹎', '白腹鸫', '黑领椋鸟']) expect(text).toContain(n)
    expect(text).toContain('正确答案')
    expect(text).toContain('你选的')
    // ② 图片来源：四位作者与许可证都在
    for (const a of ['作者甲', '作者乙', '作者丙', '作者丁']) expect(text).toContain(a)
    expect(text).toContain('CC-BY-NC')
    expect(text).toContain('CC-BY-SA')
  })

  it('看图选名（选项是文字，无图）：只渲染选项对照，不渲染图片来源', () => {
    const w = mount(Answereview, {
      props: {
        options: ['红尾水鸲', '红耳鹎', '白腹鸫', '黑领椋鸟'],
        answer: '红耳鹎',
        chosen: null, // 超时
      },
      global: { plugins: [i18n] },
    })
    expect(w.text()).toContain('红耳鹎')
    expect(w.text()).toContain('选项对照')
    // 无 optionsMedia → 不出现「图片来源」标题
    expect(w.text()).not.toContain('图片来源')
  })
})
