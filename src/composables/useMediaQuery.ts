import { onUnmounted, ref, type Ref } from 'vue'

/**
 * 响应式媒体查询：宽度/断点相关的**结构**差异（不只是样式）用它在 JS 侧判断。
 *
 * 为什么不用纯 CSS：移动端需要把地区选择器 Teleport 到 body 变成抽屉
 * （`.card` 的 `overflow: hidden` 会破坏 sticky，且抽屉不能推挤文档流），
 * 这类「换结构」没法只靠媒体查询样式完成。
 *
 * 无 `window` 或环境不支持 matchMedia（jsdom / 老浏览器）时恒为 `false`。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return matches

  const mql = window.matchMedia(query)
  matches.value = mql.matches
  const onChange = (e: MediaQueryListEvent) => {
    matches.value = e.matches
  }
  // addEventListener 在旧版 WebKit 缺失 → 回退 addListener（事件对象形态也不同）
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange)
    onUnmounted(() => mql.removeEventListener('change', onChange))
  } else {
    mql.addListener(onChange)
    onUnmounted(() => mql.removeListener(onChange))
  }
  return matches
}
