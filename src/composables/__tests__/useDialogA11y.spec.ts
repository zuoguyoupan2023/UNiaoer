import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useDialogA11y } from '../useDialogA11y'

const Host = defineComponent({
  setup() {
    const open = ref(false)
    const { panelRef } = useDialogA11y(() => open.value, {
      onClose: () => {
        open.value = false
      },
    })
    return { open, panelRef }
  },
  template: `
    <button id="trigger" type="button" @click="open = true">open</button>
    <div v-if="open" ref="panelRef" role="dialog">
      <input id="first" />
      <button id="last" type="button">close</button>
    </div>
  `,
})

describe('useDialogA11y', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  async function open() {
    wrapper = mount(Host, { attachTo: document.body })
    document.getElementById('trigger')!.focus()
    await wrapper.get('#trigger').trigger('click')
    await flushPromises()
  }

  it('打开时焦点移入面板第一个可聚焦元素，并锁定 body 滚动', async () => {
    await open()
    expect(document.activeElement?.id).toBe('first')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('Tab 在面板内圈闭（首尾循环，Shift 反向）', async () => {
    await open()
    document.getElementById('last')!.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement?.id).toBe('first')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(document.activeElement?.id).toBe('last')
  })

  it('ESC 关闭弹层：焦点还原到打开前的元素，滚动锁解除', async () => {
    await open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.id).toBe('trigger')
    expect(document.body.style.overflow).toBe('')
  })
})
