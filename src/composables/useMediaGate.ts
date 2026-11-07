import { computed, ref } from 'vue'
// 2026-11-05 用户：文案不再展示网速，测速探针停用（见下方注释块）。
// 恢复时：取消本行、probeSpeed、watch、reset 内 probeUrl/speedMbps 相关注释即可。
// import { measureSpeedMbps } from '@/core/speedProbe'

/**
 * 媒体就绪门（2026-10-26）：题目**媒体真正可用之后**才开始倒计时。
 *
 * 为什么：切题即计时会让网络慢的人凭空损失几秒（图还在转圈、音频还在缓冲）。
 * 计时应当只衡量"辨认"这一步，不该惩罚带宽。
 *
 * 规则：
 *  - 图片：`<img>` 的 load 到达才算就绪（完全显示，不是骨架/占位）；
 *  - 音频：真正 play 起来才算就绪（缓冲多久等多久，不设兜底）；
 *  - **1s 兜底**：图片只是慢、既没 load 也没 error，1s 后照常开始计时，
 *    不让用户干等着不知道要干什么；
 *  - **5s 看门狗**：兜底放行后仍迟迟不出来的图，才算"没显示"并计入失败
 *    （既不 load 也不 error 的素材，只有这条路径能识别）；
 *  - **失败判据**：本组失败数 ≥ 总数的 1/3 → 提示换网络重开。
 *
 * 计数口径：一道题里"必须加载的媒体"算一组（L6 的 6 张选项图同属一组）。
 */

export interface MediaGateOptions {
  /** 兜底：图片既没 load 也没 error 时，多久后放开计时（毫秒） */
  fallbackMs?: number
  /** 看门狗：兜底之后再等多久仍无结果，就判为"没显示"（毫秒） */
  stallMs?: number
  /** 失败比例达到多少就提示"建议换网络重开"（默认 1/3） */
  failureRatio?: number
}

export function useMediaGate(opts: MediaGateOptions = {}) {
  const fallbackMs = opts.fallbackMs ?? 1000
  const stallMs = opts.stallMs ?? 5000
  const failureRatio = opts.failureRatio ?? 1 / 3

  /** 本组媒体总数（组件在切题时按题型设置） */
  const total = ref(0)
  /** 已有结果的媒体数（成功 + 失败） */
  const settled = ref(0)
  const failed = ref(0)
  /** 就绪 = 可以开始计时 */
  const ready = ref(false)

  /* ── 测速探针（2026-11-05 用户：文案不再展示速度，整段停用）────────────
   * 原逻辑：失败比例达标 → 用第一份素材的 URL 禁缓存下载一次，按 字节/耗时
   * 估算 Mbps 展示在提示里。问题：这个数把 DNS/TLS 握手全算进去，
   * 在到 Cloudflare 抖动的链路上会读出 0.0x~0.5 Mbps 的「假速度」，
   * 用户看了莫名其妙（2026-11-04 反馈）。文案已改为不带速度，
   * 探针失去展示意义，注释保留备查。恢复步骤：
   *   1) 取消下方 import measureSpeedMbps
   *   2) 取消 speedMbps / probing / probeUrl / probeSpeed / watch 的注释
   *   3) reset 签名加回第 3 参 speedProbeUrl 并恢复赋值行
   *   4) 组件里 networkNote 恢复「带速度/不带速度」双文案分支
   *   5) i18n 的 quiz.networkPoor 恢复 {speed} 占位
   */
  // /** 最近一次测速结果（Mbps），null = 未测或失败 */
  // const speedMbps = ref<number | null>(null)
  // /** 测速正在跑（避免每个失败事件重复发起） */
  // let probing = false
  // /** 测速用的素材 URL（reset 时由调用方给出） */
  // let probeUrl: string | null = null

  let fallbackTimer: number | undefined
  let stallTimer: number | undefined

  function clearTimers() {
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer)
      fallbackTimer = undefined
    }
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer)
      stallTimer = undefined
    }
  }

  /** 放行：兜底到点 / 音频开播 / 无需等待的题型 */
  function release() {
    if (ready.value) return
    // 已放行就别再让看门狗把"正常播放"记成失败
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer)
      stallTimer = undefined
    }
    ready.value = true
  }

  /** 仍未出结果的媒体数 */
  function pendingCount() {
    return Math.max(0, total.value - settled.value)
  }

  function markLoaded() {
    settled.value += 1
    if (!ready.value && settled.value >= total.value) release()
  }

  function markFailed() {
    failed.value += 1
    settled.value += 1
    if (!ready.value && settled.value >= total.value) release()
  }

  /**
   * 切题重置。`count` 为本题必须加载的媒体数（0 = 无需等待，直接放行）；
   * `armFallback=false` 用于听音题——音频缓冲多久就等多久。
   * （曾有的第 3 参 speedProbeUrl 随测速探针一起停用，见上方注释块。）
   */
  function reset(count: number, armFallback = true) {
    clearTimers()
    ready.value = false
    total.value = Math.max(0, count)
    settled.value = 0
    failed.value = 0
    // speedMbps.value = null
    // probing = false
    // probeUrl = speedProbeUrl ?? null
    if (total.value === 0) {
      release()
      return
    }
    if (!armFallback) return
    // 第一段：1s 后无论有没有结果都开始计时（"只是慢"不该罚站）
    fallbackTimer = window.setTimeout(() => {
      release()
      if (pendingCount() === 0) return
      // 第二段：再等 5s 仍不出来 = 这些图确实没显示，计入失败。
      // 用触发时刻的实时值，期间加载成功的不会被误算。
      stallTimer = window.setTimeout(() => {
        const stuck = pendingCount()
        if (stuck === 0) return
        failed.value += stuck
        settled.value += stuck
      }, stallMs)
    }, fallbackMs)
  }

  /** 听音用：给"永远播不出来"的音频一个逃生口（到点放行并计为失败） */
  function armStall(ms = 10000) {
    if (ready.value || total.value === 0) return
    if (stallTimer !== undefined) clearTimeout(stallTimer)
    stallTimer = window.setTimeout(() => {
      const stuck = pendingCount()
      if (stuck > 0) {
        failed.value += stuck
        settled.value += stuck
      }
      release()
    }, ms)
  }

  /** 本组失败比例是否已达「建议换网络重开」的程度 */
  const shouldPromptRetry = computed(
    () => total.value > 0 && failed.value / total.value >= failureRatio,
  )

  // /** 测量当前网速（失败/超时保持 null，界面显示"速度未知"） */
  // async function probeSpeed(url: string) {
  //   if (probing || speedMbps.value !== null) return
  //   probing = true
  //   speedMbps.value = await measureSpeedMbps(url)
  //   probing = false
  // }

  /** 进度（已出结果 / 总数），供"加载中 3/6"这类提示 */
  const progress = computed(() => ({ settled: settled.value, total: total.value }))

  // /**
  //  * 失败比例一旦达到阈值就测一次网速（只测一次，供提示文案用）。
  //  * `probeUrl` 由调用方在 reset 时给出（通常取本题第一份素材的 URL）。
  //  */
  // watch(shouldPromptRetry, (bad) => {
  //   if (bad && probeUrl && !probing && speedMbps.value === null) void probeSpeed(probeUrl)
  // })
  void shouldPromptRetry.value // 组件仍读取它决定是否弹提示；探针停用后此处不再消费

  return {
    ready,
    total,
    settled,
    failed,
    progress,
    // speedMbps,
    shouldPromptRetry,
    markLoaded,
    markFailed,
    release,
    reset,
    armStall,
    // probeSpeed,
  }
}
