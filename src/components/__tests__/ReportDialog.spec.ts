import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { submitMock } = vi.hoisted(() => ({
  submitMock: vi.fn<(entry: unknown, cid: string) => Promise<void>>(async () => undefined),
}))

vi.mock('@/core/reportsApi', () => ({
  submitReport: submitMock,
}))

vi.mock('@/core/metrics', () => ({
  track: vi.fn<() => void>(),
}))

import { useSettingsStore } from '@/stores/settings'
import { clearReports, listReports } from '@/core/reportStore'
import ReportDialog from '../ReportDialog.vue'

function mountDialog() {
  return mount(ReportDialog, {
    props: {
      open: true,
      speciesId: 'turdus-merula',
      speciesName: '乌鸫',
      sci: 'Turdus merula',
      questionType: 'image' as const,
      mediaUrl: 'https://cdn.test/a.webp',
    },
  })
}

/** 浮窗内容 Teleport 到 body，取真实 DOM 里的输入框 */
function nicknameInput(): HTMLInputElement {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('.report-panel input')]
  return inputs[inputs.length - 1]!
}
function submitButton(): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('.report-panel button')].find(
    (b) => b.textContent?.trim() === '提交',
  )!
}
/** IndexedDB 事务比 flushPromises 落盘更晚，等一个真实宏任务再清微任务 */
async function settle() {
  await new Promise((r) => setTimeout(r, 30))
  await flushPromises()
}

describe('ReportDialog（报错昵称）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
    submitMock.mockReset()
    submitMock.mockResolvedValue(undefined)
    await clearReports()
  })

  it('填写昵称：随报错保存，并写回本地身份昵称', async () => {
    const settings = useSettingsStore()
    mountDialog()
    await flushPromises()

    await (document.querySelector('.report-panel .reason') as HTMLButtonElement).click()
    nicknameInput().value = '观鸟人'
    nicknameInput().dispatchEvent(new Event('input'))
    await flushPromises()
    submitButton().click()
    await settle()

    const rows = await listReports()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.nickname).toBe('观鸟人')
    expect(settings.nickname).toBe('观鸟人')
    expect(submitMock).toHaveBeenCalledTimes(1)
  })

  it('昵称留空：报错不带昵称，且不改动已有昵称', async () => {
    const settings = useSettingsStore()
    settings.nickname = ''
    mountDialog()
    await flushPromises()

    expect(nicknameInput().value).toBe('')
    submitButton().click()
    await settle()

    const rows = await listReports()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.nickname).toBeUndefined()
    expect(settings.nickname).toBe('')
  })

  it('本机已有昵称时自动带出，可直接沿用', async () => {
    const settings = useSettingsStore()
    settings.nickname = '老张'
    mountDialog()
    await flushPromises()

    expect(nicknameInput().value).toBe('老张')
    submitButton().click()
    await settle()

    const rows = await listReports()
    expect(rows[0]!.nickname).toBe('老张')
  })

  it('只填一个字：提示太短，不提交', async () => {
    mountDialog()
    await flushPromises()

    nicknameInput().value = '张'
    nicknameInput().dispatchEvent(new Event('input'))
    await flushPromises()
    submitButton().click()
    await settle()

    expect(document.querySelector('.report-panel')?.textContent).toContain('至少 2 个字符')
    expect(await listReports()).toHaveLength(0)
    expect(submitMock).not.toHaveBeenCalled()
  })
})
