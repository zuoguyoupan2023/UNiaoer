/**
 * `aggregateStats()` 的等价性单测（docs/111）。
 *
 * ## 这个文件守的是什么
 *
 * 2026-11-06 把 `/api/stats/public` 的 **6 条独立聚合 SQL** 换成
 * **1 次全表扫描 + JS 聚合**（读行数 46,322 → 6,419，省 7.2×）。
 *
 * 换实现最大的风险是**聚合口径悄悄变了**（静默错）。所以这里构造固定数据集，
 * 同时跑「旧 SQL 的聚合逻辑（用 JS 模拟）」和「新 `aggregateStats()`」，
 * **逐字段比对**。不一致就是回归。
 *
 * 覆盖的口径边界（最容易错的地方）：
 *   · `totals` = **全时段**（不筛 day）
 *   · `series` = **近 N 天**（筛 day >= since）
 *   · `badges` / `titles` = 全时段，按 props，**按 n 降序**
 *   · `accuracyByTier` = quiz_score 精确 + quiz_result 早期分桶（只算「首次精确数据之前」）
 */
import { describe, expect, it } from 'vitest'
import { aggregateStats } from '../index'

interface MetricRow {
  day: string
  event: string
  props: string
  n: number
}

/** 固定数据集：覆盖各种 case */
const ROWS: MetricRow[] = [
  // --- page_view / session_start（只有 totals + series）---
  { day: '2026-10-20', event: 'page_view', props: '', n: 100 },
  { day: '2026-10-21', event: 'page_view', props: '', n: 50 },
  { day: '2026-09-01', event: 'page_view', props: '', n: 999 }, // 早于 since，只进 totals
  { day: '2026-10-20', event: 'session_start', props: '', n: 30 },

  // --- quiz_answer（物种级明细：看板只要 totals，不进 series 的 props 维度）---
  { day: '2026-10-20', event: 'quiz_answer', props: 'ok=1;region=CN;species=a;tier=1', n: 5 },
  { day: '2026-10-20', event: 'quiz_answer', props: 'ok=0;region=CN;species=b;tier=1', n: 3 },
  { day: '2026-10-21', event: 'quiz_answer', props: 'ok=1;region=US;species=c;tier=2', n: 2 },

  // --- badge_earned / title_earned（按 props 聚合、按 n 降序）---
  { day: '2026-10-20', event: 'badge_earned', props: 'badge=first-round', n: 10 },
  { day: '2026-10-21', event: 'badge_earned', props: 'badge=first-round', n: 5 },
  { day: '2026-10-20', event: 'badge_earned', props: 'badge=streak-7', n: 2 },
  { day: '2026-10-20', event: 'title_earned', props: 'track=observer;level=1', n: 4 },

  // --- quiz_score（精确正确率）---
  { day: '2026-10-20', event: 'quiz_score', props: 'correct=8;tier=1;total=10', n: 2 },
  { day: '2026-10-21', event: 'quiz_score', props: 'correct=6;tier=1;total=10', n: 1 },
  { day: '2026-10-20', event: 'quiz_score', props: 'correct=3;tier=2;total=10', n: 1 },
  // 非法行：correct > total → 必须被丢弃
  { day: '2026-10-20', event: 'quiz_score', props: 'correct=99;tier=9;total=10', n: 5 },

  // --- quiz_result（早期分桶：只在「该 tier 首次精确数据之前」才计入）---
  // tier=1 首次精确日是 2026-10-20 → 10-19 的早期行计入，10-20 及之后的不计
  { day: '2026-10-19', event: 'quiz_result', props: 'band=60-80;tier=1', n: 2 },
  { day: '2026-10-20', event: 'quiz_result', props: 'band=60-80;tier=1', n: 3 },
  // tier=3 从未有精确数据 → 早期行全部计入
  { day: '2026-10-20', event: 'quiz_result', props: 'band=80-100;tier=3', n: 4 },
]

const DAYS = 30
const SINCE = '2026-10-08'

/** 假的 D1：只支持 `aggregateStats` 用到的那一条 SQL（按 event 白名单过滤） */
function fakeEnv(rows: MetricRow[]) {
  return {
    DB: {
      prepare(sql: string) {
        // 只接受「按 event 白名单过滤」的那条（2026-11-06：扫描范围 6,419 → ~1,534 行）
        expect(sql).toMatch(/^SELECT day, event, props, n FROM metrics_daily WHERE event IN \(\?/)
        return {
          bind: () => ({
            all: async () => ({ results: rows }),
          }),
        }
      },
    },
  } as unknown as Parameters<typeof aggregateStats>[0]
}

/** 旧实现（6 条 SQL）的 JS 等价物——用于比对 */
function legacyAggregate(rows: MetricRow[], since: string) {
  // 1) series：WHERE day >= ? GROUP BY day, event ORDER BY day
  const seriesMap = new Map<string, number>()
  for (const r of rows) {
    if (r.day < since) continue
    const k = `${r.day}|${r.event}`
    seriesMap.set(k, (seriesMap.get(k) ?? 0) + r.n)
  }
  const series = [...seriesMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, n]) => {
      const i = k.indexOf('|')
      return { day: k.slice(0, i), event: k.slice(i + 1), n }
    })

  // 2) byEvent：GROUP BY event（全时段）
  const totals: Record<string, number> = {}
  for (const r of rows) totals[r.event] = (totals[r.event] ?? 0) + r.n

  // 3) badge / title：WHERE event=? GROUP BY props ORDER BY n DESC（全时段）
  const byProps = (ev: string) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.event === ev) m.set(r.props, (m.get(r.props) ?? 0) + r.n)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([props, n]) => ({ props, n }))
  }

  // 4) quiz_score / quiz_result：GROUP BY day, props（全时段）
  const byDayProps = (ev: string) => {
    const m = new Map<string, { day: string; props: string; n: number }>()
    for (const r of rows) {
      if (r.event !== ev) continue
      const k = `${r.day}|${r.props}`
      const cur = m.get(k)
      if (cur) cur.n += r.n
      else m.set(k, { day: r.day, props: r.props, n: r.n })
    }
    return [...m.values()]
  }

  return { series, totals, badges: byProps('badge_earned'), titles: byProps('title_earned'), scores: byDayProps('quiz_score'), results: byDayProps('quiz_result') }
}

function parseProps(s: string): Record<string, string> {
  return Object.fromEntries(
    s
      .split(';')
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=')
        return i > 0 ? [kv.slice(0, i), kv.slice(i + 1)] : [kv, '']
      }),
  )
}

describe('aggregateStats · 与旧 6 条 SQL 逐字段等价', () => {
  const legacy = legacyAggregate(ROWS, SINCE)

  it('totals 是全时段（含 since 之前的行）', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    expect(out.totals).toEqual(legacy.totals)
    // 关键断言：9 月那 999 次 page_view 必须算进 totals
    expect((out.totals as Record<string, number>).page_view).toBe(100 + 50 + 999)
  })

  it('series 只含近 N 天（排除 since 之前的行）', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    expect(out.series).toEqual(legacy.series)
    // 关键断言：9 月那行不能出现在 series 里
    expect((out.series as { day: string }[]).some((r) => r.day === '2026-09-01')).toBe(false)
  })

  it('badges 按 props 聚合、按 n 降序', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    const got = (out.badges as { badge?: string; n: number }[]).map((b) => ({ badge: b.badge, n: b.n }))
    expect(got).toEqual([
      { badge: 'first-round', n: 15 }, // 10 + 5 跨日累加
      { badge: 'streak-7', n: 2 },
    ])
  })

  it('titles 按 props 聚合', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    expect((out.titles as { track?: string; level?: string; n: number }[])[0]).toEqual({
      track: 'observer',
      level: '1',
      n: 4,
    })
  })

  it('accuracyByTier：精确值 + 早期估算，且非法行被丢弃', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    const list = out.accuracyByTier as {
      tier: string
      n: number
      mean: number
      approx: boolean
    }[]

    // tier=1 精确：(8*2 + 6*1) / (10*2 + 10*1) = 22/30 = 73%
    const t1 = list.find((x) => x.tier === '1' && !x.approx)!
    expect(t1).toBeDefined()
    expect(t1.n).toBe(3) // rounds = 2 + 1
    expect(t1.mean).toBe(73)

    // tier=2 精确：3/10 = 30%
    const t2 = list.find((x) => x.tier === '2' && !x.approx)!
    expect(t2.mean).toBe(30)

    // tier=9 是非法行（correct>total）→ 不得出现
    expect(list.find((x) => x.tier === '9')).toBeUndefined()

    // tier=1 早期：只有 10-19 那行（60-80 → 中点 70），10-20 的 3 次因与精确重复被排除
    const t1early = list.find((x) => x.tier === '1' && x.approx)!
    expect(t1early.n).toBe(2)
    expect(t1early.mean).toBe(70)

    // tier=3 从未有精确数据 → 早期全部计入（80-100 → 90）
    const t3early = list.find((x) => x.tier === '3')!
    expect(t3early.approx).toBe(true)
    expect(t3early.n).toBe(4)
    expect(t3early.mean).toBe(90)
  })

  it('accuracyByTier 按 tier 升序、同 tier 精确在前', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    const list = out.accuracyByTier as { tier: string; approx: boolean }[]
    const keys = list.map((x) => `${x.tier}:${x.approx ? 'a' : 'e'}`)
    expect(keys).toEqual(['1:e', '1:a', '2:e', '3:a'])
  })

  it('空表 → 返回可用形状（不抛错）', async () => {
    const out = await aggregateStats(fakeEnv([]), DAYS, SINCE)
    expect(out.totals).toEqual({})
    expect(out.series).toEqual([])
    expect(out.badges).toEqual([])
    expect(out.titles).toEqual([])
    expect(out.accuracyByTier).toEqual([])
  })

  it('输出含 days / since / generatedAt / notes', async () => {
    const out = await aggregateStats(fakeEnv(ROWS), DAYS, SINCE)
    expect(out.days).toBe(DAYS)
    expect(out.since).toBe(SINCE)
    expect(typeof out.generatedAt).toBe('string')
    expect(out.notes).toBeTruthy()
  })

  it('只发一条 SQL，且按看板事件白名单过滤（这是 7.2× + 4.2× 收益的来源）', async () => {
    let calls = 0
    let sqlSeen = ''
    const env = {
      DB: {
        prepare(sql: string) {
          calls++
          sqlSeen = sql
          return { bind: () => ({ all: async () => ({ results: ROWS }) }) }
        },
      },
    } as unknown as Parameters<typeof aggregateStats>[0]
    await aggregateStats(env, DAYS, SINCE)
    expect(calls).toBe(1)
    // 关键：必须按 event 过滤，否则会把 quiz_answer 的物种明细也读进来（4,885 行）
    expect(sqlSeen).toContain('WHERE event IN')
  })
})

describe('aggregateStats · 旧实现口径的说明', () => {
  it('legacy 模拟与真实旧 SQL 的一致性（防止测试自欺）', () => {
    // 这条测试不是验 assert 什么新东西，而是**固定 legacy 的行为**：
    // 若将来有人改 legacyAggregate 去迁就新实现，这里的显式期望会失败。
    const legacy = legacyAggregate(ROWS, SINCE)
    expect(legacy.totals.page_view).toBe(1149)
    expect(legacy.totals.quiz_answer).toBe(10)
    expect(legacy.series.find((s) => s.day === '2026-10-20' && s.event === 'quiz_answer')?.n).toBe(8)
    expect(legacy.badges[0]).toEqual({ props: 'badge=first-round', n: 15 })
    // quiz_score 的非法行仍然进了原始聚合（旧 SQL 不过滤，过滤发生在上层）
    expect(legacy.scores.some((s) => parseProps(s.props).tier === '9')).toBe(true)
  })
})

describe('handlePublicStats · 兜底路径不能崩溃（2026-11-06 线上事故回归）', () => {
  it('无快照时走重算，并成功返回数据（不因 ctx 未定义而 BYPASS）', async () => {
    // 线上事故：参数改名为 _ctx 后，兜底写入仍用 ctx → ReferenceError → BYPASS + 空数据。
    // 这里用最小 mock 复现「无快照 → 重算 → 写快照」这条路径。
    const { default: worker } = await import('../index')

    const rows: MetricRow[] = [
      { day: '2026-10-20', event: 'page_view', props: '', n: 7 },
      { day: '2026-10-20', event: 'quiz_complete', props: 'mode=image', n: 2 },
    ]
    const written: unknown[] = []
    const env = {
      DB: {
        prepare(sql: string) {
          if (sql.includes('FROM metrics_snapshot')) {
            return { bind: () => ({ first: async () => null }) }
          }
          if (sql.includes('FROM metrics_daily')) {
            return { bind: () => ({ all: async () => ({ results: rows }) }) }
          }
          // INSERT INTO metrics_snapshot
          return {
            bind: (...args: unknown[]) => ({
              run: async () => {
                written.push(args)
                return { success: true }
              },
            }),
          }
        },
      },
    } as never

    const pending: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
    } as never

    const res = await worker.fetch(
      new Request('https://uniaoer.com/api/stats/public?days=30'),
      env,
      ctx,
    )
    const body = (await res.json()) as { totals?: Record<string, number> }

    // 关键断言：不能是 BYPASS 空壳
    expect(res.headers.get('x-stats-cache')).not.toBe('BYPASS')
    expect(res.headers.get('x-stats-error')).toBeNull()
    expect(body.totals?.page_view).toBe(7)
    expect(body.totals?.quiz_complete).toBe(2)

    // 且快照写入被排入 waitUntil（不是裸跑）
    await Promise.all(pending)
    expect(written.length).toBeGreaterThan(0)
  })
})
