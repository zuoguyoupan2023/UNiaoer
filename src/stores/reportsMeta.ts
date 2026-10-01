import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listPublicReports } from '@/core/reportsApi'

const REFRESH_INTERVAL_MS = 60_000

/**
 * 大众评审公开条目数：顶部导航入口仅在 >0 时显示（没有可评审内容不占导航位）。
 * 拉取失败（离线/后端不可用）按 0 处理，同样不显示。
 */
export const useReportsMetaStore = defineStore('reportsMeta', () => {
  const publishedCount = ref<number | null>(null)
  let lastAt = 0

  /** limit=1 只取计数；60s 节流，切路由不重复请求 */
  async function refresh() {
    if (Date.now() - lastAt < REFRESH_INTERVAL_MS) return
    lastAt = Date.now()
    try {
      const res = await listPublicReports({ limit: 1 })
      publishedCount.value = res.total
    } catch {
      publishedCount.value = 0
    }
  }

  return { publishedCount, refresh }
})
