/**
 * 「全球出题区」一次性解锁（2026-11-06 用户定，同日二次修订）。
 *
 * ## 为什么隐藏全球
 *
 * 用户原话：「绝大部分人都是熟悉本国、最多本洲的鸟，甚至本地的鸟都认不全；
 * 所以全球这个维度，从观鸟-名录上看图听音频可以，但是从做题界面就不需要提供；
 * 把它隐藏（然后额外可以有一个后缀，加上他可以去挑战全球维度，但是不直接显示出来，
 * 避免新用户贸然尝试，那结果必然是错题非常多，对提高大众认鸟水平效果不大）。」
 *
 * 数据支持（docs/109 §7.1，10-30～11-06 共 2,070 次作答）：87% 落在省/国，全球只占 6.0%。
 * 而全球模式的训练信号接近于零——题目里的鸟用户从未见过，正确率趋近 25% 概率。
 *
 * ## 为什么是**一次性**而不是「记住解锁」
 *
 * 用户二次修订原话：「zone=global 是否可以作为一次性的，比如有些人好奇开了，
 * 下次这个人其实还是做上海/香港/云南的，而不是 ALL；这种情况，每次想做 global 的人
 * 需要用特殊链接访问，这样才合理吧？」
 *
 * **这个判断是对的**，而且比「记住」更符合直觉：
 *
 * | 语义 | 问题 |
 * |---|---|
 * | 记住解锁（旧设计） | 用户好奇点了一次，之后**永久**留在一个他自己没意识到的状态；`region` 被改成 `'ALL'` 且写进存档，下次打开还是全球 |
 * | **一次性（现设计）** | 带后缀进来 → 这一轮可以做全球；**不写 localStorage、不改 `settings.region`**；下次正常打开，仍是原来的上海/云南 |
 *
 * 实现上就是把开关做成**纯 URL 判定，零持久化**：
 *
 * · `?zone=global` → 本次会话允许全球（不落盘、不写 settings）
 * · 没有该参数 → 不允许
 * · 不需要 `?zone=0` 关闭（没有持久化，刷新即恢复）
 *
 * ⚠️ 「本次会话」的口径：URL 参数在**同一个页面生命周期内**一直有效（含 SPA 内部路由跳转，
 * 因为不重新加载页面；但用户手动刷新或换 URL 后就没了）。这正好符合「用特殊链接访问」的语义。
 */
const PARAM = 'zone'
const VALUE = 'global'

let cached: boolean | null = null

/** 测试用：清掉进程内缓存 */
export function _resetGlobalZoneCache(): void {
  cached = null
}

/** 本次访问是否允许「全球」出题区（**一次性，不持久化**） */
export function isGlobalZoneEnabled(): boolean {
  if (cached !== null) return cached
  cached = false
  if (typeof window === 'undefined') return cached
  try {
    cached = new URL(window.location.href).searchParams.get(PARAM) === VALUE
  } catch {
    cached = false
  }
  return cached
}
