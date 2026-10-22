/**
 * 路由加载反馈与 chunk 失败恢复（072-b 修复）。
 *
 * 背景（实测）：`/quiz/image` 等路由是**懒加载 chunk**，点击后 chunk 到达前页面毫无变化；
 * 若 chunk 请求失败（弱网/离线/CDN 5xx），Vue Router 会**静默丢弃**本次导航 ——
 * 用户看到的就是"点了没反应、点几次也进不去"，且没有任何提示。
 *
 * 这里只做三件事（不改变路由行为本身）：
 *   ① 导航挂起超过 120ms → 顶部显示细进度条（消除"点了没反应"）；
 *   ② `router.onError` 捕获 chunk 失败 → 自动重试一次（同一路径只重试一次）；
 *   ③ 仍失败 → 顶部横幅提示 + 「重试 / 刷新」按钮（绝不静默）。
 *
 * 时序：120ms 以内不显示，避免快路由闪烁（人眼感知阈值）。
 */
import { readonly, ref } from 'vue'

/** 顶部细进度条是否可见（导航挂起 > 120ms） */
const pending = ref(false)
/** chunk 加载失败（重试后仍失败）→ 显示可操作横幅 */
const failed = ref(false)
/** 失败的目标路径（重试用） */
const failedPath = ref('')

const SHOW_DELAY_MS = 120
let timer: ReturnType<typeof setTimeout> | null = null

export const routeStatus = {
  pending: readonly(pending),
  failed: readonly(failed),
}

export function beginNavigation(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    pending.value = true
  }, SHOW_DELAY_MS)
}

export function endNavigation(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pending.value = false
}

/** 同一目标路径只自动重试一次，避免"失败→重试→失败"死循环 */
const retried = new Set<string>()

/**
 * 路由错误入口。`retry` 返回 Promise：自动重试一次；仍拒绝则显示横幅。
 * 空路径（拿不到目标）直接显示横幅。
 */
export function handleRouteError(to: string, retry: (path: string) => Promise<unknown>): void {
  endNavigation()
  if (!to) {
    failed.value = true
    return
  }
  if (!retried.has(to)) {
    retried.add(to)
    // 自动重试一次：瞬时的 fetch 失败（弱网抖动）大多能在第二次成功
    void Promise.resolve(retry(to)).catch(() => {
      failed.value = true
      failedPath.value = to
    })
    return
  }
  failed.value = true
  failedPath.value = to
}

/** 用户点「重试」：清掉失败态并再试一次（手动重试不受自动重试次数限制） */
export function manualRetry(retry: (path: string) => Promise<unknown>): void {
  failed.value = false
  const p = failedPath.value
  failedPath.value = ''
  if (p) void Promise.resolve(retry(p)).catch(() => (failed.value = true))
}

export function dismissRouteError(): void {
  failed.value = false
  failedPath.value = ''
}

/** 测试用：重置模块内状态 */
export function _resetRouteStatus(): void {
  pending.value = false
  failed.value = false
  failedPath.value = ''
  retried.clear()
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
