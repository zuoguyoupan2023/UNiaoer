import { nextTick, onUnmounted, ref, watch, type WatchSource } from 'vue'

/** 面板内可聚焦元素（焦点圈闭的查询范围） */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** 是否要求减少动效（无 matchMedia 的环境一律视为否） */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// body 滚动锁计数：多个弹层叠加时，只在最后一个关闭后解锁
let scrollLocks = 0

/**
 * 弹层无障碍（H3）：打开时焦点移入面板并圈闭在其中、ESC 触发 onClose、锁定
 * body 滚动；关闭时焦点还原到打开前的元素。`panelRef` 绑到弹层面板元素上。
 */
export function useDialogA11y(
  active: WatchSource<boolean>,
  opts: { onClose?: () => void; initialFocus?: () => HTMLElement | null } = {},
) {
  const panelRef = ref<HTMLElement | null>(null)
  let restoreFocusTo: HTMLElement | null = null
  let open = false

  // capture 监听：抢在页面级快捷键（如答题 1/2/3/4）之前处理
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (opts.onClose) {
        e.stopPropagation()
        opts.onClose()
      }
      return
    }
    if (e.key !== 'Tab') return
    const panel = panelRef.value
    if (!panel) return
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const current = document.activeElement
    const inside = current instanceof Node && panel.contains(current)
    if (e.shiftKey) {
      if (!inside || current === first) {
        e.preventDefault()
        last.focus()
      }
    } else if (!inside || current === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function release() {
    document.removeEventListener('keydown', onKeydown, true)
    scrollLocks = Math.max(0, scrollLocks - 1)
    if (scrollLocks === 0) document.body.style.overflow = ''
  }

  watch(
    active,
    (on) => {
      if (on) {
        open = true
        restoreFocusTo =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        document.addEventListener('keydown', onKeydown, true)
        scrollLocks += 1
        document.body.style.overflow = 'hidden'
        void nextTick(() => {
          if (!open) return
          const target =
            opts.initialFocus?.() ??
            panelRef.value?.querySelector<HTMLElement>(FOCUSABLE) ??
            panelRef.value
          target?.focus()
        })
      } else {
        open = false
        release()
        restoreFocusTo?.focus()
        restoreFocusTo = null
      }
    },
    { flush: 'post' },
  )

  // 开着弹层时组件被卸载（如切题/路由跳转）：清掉监听与滚动锁
  onUnmounted(() => {
    if (!open) return
    open = false
    release()
  })

  return { panelRef }
}
