/**
 * 地域先验 —— 识鸟候选的地理重排（docs/055 §5.4 的延伸）
 *
 * ## 为什么必须做这一层
 *
 * SpeciesNet 的输出概率**饱和到 99.9%~100%**，几乎没有区分度
 * （实测 top-12 全在 98.6% 以上）。这种情况下单靠模型分数排序，
 * 排出来的顺序基本是噪声。
 *
 * 而现实中有个极强的约束被浪费了：**用户拍的鸟，大概率就在他所在的地方**。
 * Merlin 之所以「准」，很大一部分就来自这个地理先验 ——
 * 它先问你所在地区，再在当地的种里排。我们手里正好有现成的数据：
 * 省级常见度档位（`public/data/province-commonness/`，036 建的），
 * 1 = 当地最常见 … 5 = 当地稀有。
 *
 * ## 排序规则（保守版）
 *
 *   主键：当地档位（越小越靠前；查不到 = 不参与，排在有档位的之后）
 *   次键：模型分数（仍作为同档位内的排序依据，也保留给 UI 展示）
 *
 * ## 绝不做的三件事
 *
 *   1. **不删候选** —— 稀有鸟、迷鸟本来就是识鸟最有价值的部分；
 *   2. **不因为「当地无记录」就断言不存在**（GBIF 记录有地理偏差）；
 *   3. **不隐藏模型分数** —— 分数照旧传给 UI，由 confidence.ts 决定要不要呈现。
 *
 * 无地区数据时原样返回，行为与现在完全一致（渐进增强）。
 */
import { regionTierMap, regionTierOf } from '@/core/provinceCommonness'
import type { Candidate } from './types'

const cache = new Map<string, Promise<Map<string, number> | null>>()

/** 取某地区的档位表（带缓存；失败静默返回 null，绝不因此报错） */
export function loadTierMap(region: string): Promise<Map<string, number> | null> {
  const key = region || 'ALL'
  let p = cache.get(key)
  if (!p) {
    p = regionTierMap(key).then((r) => r?.tiers ?? null).catch(() => null)
    cache.set(key, p)
  }
  return p
}

/** 测试用 */
export function _resetRegionPriorCache(): void {
  cache.clear()
}

/**
 * 按当地常见度重排候选。
 * @param candidates 原始候选（模型顺序）
 * @param tiers      该地区的档位表；null/空 → 原样返回
 */
export function applyRegionPrior(
  candidates: Candidate[],
  tiers: Map<string, number> | null,
): Candidate[] {
  const withTier: Candidate[] = candidates.map((c) => ({
    ...c,
    regionTier: c.speciesId ? regionTierOf(tiers, c.speciesId) : null,
  }))
  if (!tiers || !tiers.size) return withTier

  // 有当地档位的排在前面；同档位按模型分数；分数再相同按原顺序（稳定）
  const indexed = withTier.map((c, i) => ({ c, i }))
  indexed.sort((a, b) => {
    const ta = a.c.regionTier
    const tb = b.c.regionTier
    if (ta != null && tb != null) {
      if (ta !== tb) return ta - tb
      return b.c.score - a.c.score || a.i - b.i
    }
    if (ta != null) return -1
    if (tb != null) return 1
    return b.c.score - a.c.score || a.i - b.i
  })
  return indexed.map((x) => x.c)
}

/** 异步便捷入口：地区键（如 `CN` / `CN-11` / `ALL`）+ 候选 → 重排结果 */
export async function rerankByRegion(
  candidates: Candidate[],
  region: string,
): Promise<Candidate[]> {
  const tiers = await loadTierMap(region)
  return applyRegionPrior(candidates, tiers)
}