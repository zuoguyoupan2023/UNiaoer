/**
 * 074 · 观鸟页「异常数据」识别（2026-10-23 用户定，方案 B）。
 *
 * 背景：按 GBIF 记录数排序后，某些物种的记录数会**远超**同地区其它鸟类，但它们并不是当地常见鸟。
 * 实测（上海）：青藏沙鸻 422,770 / 白脸鸻 422,770 / 蒙古沙鸻 421,615，三者占该省记录 ~80%，
 * 而白头鹎只有 14,965。白脸鸻与青藏沙鸻计数**完全相同** → 明显是同一份数据集被重复/批量地理参照，
 * 不是鸟类丰度信号。
 *
 * 处理（方案 B）：**不隐藏、不改数字**，只把命中规则的物种从主列表挪到「异常数据」折叠栏，
 * 并在栏内说明"开发者非专业人士，暂按异常处理，欢迎专业人士联系告知"。
 *
 * 规则（同一套用于国家与省；两者的分母不同，所以上海与全国的异常各自独立）：
 *   在**该地区记录数 Top 5** 中，同时满足
 *     · 记录数 ≥ ANOMALY_MIN_RECORDS（默认 1 万条 —— 排除"某小省只有 1 条=100%"这类噪声）
 *     · 份额 ≥ ANOMALY_MIN_SHARE（默认 20% —— 上海实测 24.9%，用 25% 会因为 0.1% 漏掉）
 *   即视为异常候选。
 *
 * 已知取舍：份额阈值是**经验值**，不是学术判据；它只影响"放在哪一栏"，不影响任何数字。
 */

/** 绝对记录数下限：低于此值的"高份额"多半是小样本噪声（1 条 = 100%） */
export const ANOMALY_MIN_RECORDS = 10_000
/** 份额阈值：该物种占本地区全部记录的比例 */
export const ANOMALY_MIN_SHARE = 0.2
/** 只看记录数 Top N 的物种（用户指定 top5） */
export const ANOMALY_TOP_N = 5

/**
 * 从「物种 id → 记录数」里找出异常候选。
 * 只用于展示分组：返回的 id 仍保留原始记录数，不做任何修改。
 */
export function findAnomalyIds(counts: ReadonlyMap<string, number>): Set<string> {
  const out = new Set<string>()
  let total = 0
  for (const n of counts.values()) total += n
  if (!total) return out
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, ANOMALY_TOP_N)
  for (const [id, n] of top) {
    if (n >= ANOMALY_MIN_RECORDS && n / total >= ANOMALY_MIN_SHARE) out.add(id)
  }
  return out
}
