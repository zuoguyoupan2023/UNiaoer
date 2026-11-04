<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BarChart3, TrendingUp } from 'lucide-vue-next'
import type { MediaType, Tier } from '@/types'
import type { RoundRecord } from '@/core/historyDb'
import { TIERS, countsInClassicStats } from '@/core/difficulty'
import { movingAverage } from '@/core/statsChart'
import { currentLocale } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{ rounds: RoundRecord[] }>()

const MODE_KEYS: Record<MediaType, string> = { image: 'charts.modeImage', audio: 'charts.modeAudio' }
const modeOf = (m: MediaType) => t(MODE_KEYS[m])

// ---- 趋势区间：默认最近 7 天；可切最近 30 天；以及有数据的年份 ----
type TrendRange = '7d' | '30d' | number
const DAY = 86_400_000
const range = ref<TrendRange>('7d')

/** 有数据的年份（降序，只列出存在的） */
const years = computed(() => {
  const set = new Set<number>()
  for (const r of props.rounds) set.add(new Date(r.at).getFullYear())
  return [...set].sort((a, b) => b - a)
})

function rangeBounds(r: TrendRange): [number, number] {
  if (r === '7d') return [Date.now() - 7 * DAY, Infinity]
  if (r === '30d') return [Date.now() - 30 * DAY, Infinity]
  return [new Date(r, 0, 1).getTime(), new Date(r + 1, 0, 1).getTime()]
}

/** 时间正序的趋势点（按所选区间过滤）；带上题数/对数，均线按题加权要用 */
const trend = computed(() => {
  const [from, to] = rangeBounds(range.value)
  return [...props.rounds]
    .filter((r) => r.at >= from && r.at < to)
    .sort((a, b) => a.at - b.at)
    .map((r) => ({
      at: r.at,
      accuracy: r.accuracy,
      total: r.total,
      correct: r.correct,
      mode: r.mode,
      tier: r.tier,
    }))
})

function agg(list: RoundRecord[]) {
  const questions = list.reduce((n, r) => n + r.total, 0)
  const correct = list.reduce((n, r) => n + r.correct, 0)
  return {
    rounds: list.length,
    questions,
    correct,
    accuracy: questions ? Math.round((correct / questions) * 100) : 0,
  }
}

/**
 * 按档位拆分（docs/100 §5 缺陷 5）：**只列经典档 1–7**。
 * L8（8）与 S1（9）是独立模式，不占经典档位行——S1 的归属单独在 standaloneRounds
 * 里统计，将来做 S1 独立统计页时从这里取数，不要塞回本列表（否则经典档图会被
 * 「没见过 L4 却有 S1」的行打乱）。
 */
const byTier = computed(() =>
  ([1, 2, 3, 4, 5, 6, 7] as Tier[])
    .map((tier) => ({ key: tier, label: t(TIERS[tier].labelKey), ...agg(props.rounds.filter((r) => r.tier === tier)) }))
    .filter((x) => x.rounds > 0),
)

/** 独立模式轮次（L8 / S1）——不进经典档位图，仅在页面底部汇总一行，避免「数据凭空消失」 */
const standaloneRounds = computed(() => {
  const list = props.rounds.filter((r) => !countsInClassicStats(r.tier))
  return list.length ? { roundCount: list.length, ...agg(list) } : null
})

const byMode = computed(() =>
  (['image', 'audio'] as MediaType[])
    .map((mode) => ({ key: mode, label: modeOf(mode), ...agg(props.rounds.filter((r) => r.mode === mode)) }))
    .filter((x) => x.rounds > 0),
)

// ---- 趋势折线图几何（viewBox 300×130，左右留 6 边距） ----
const W = 300
const H = 130
const PAD = 12 /* R34：由 6 增大，修复 g=100 文字/圆点顶部被 viewBox 裁切 */

const trendPts = computed(() =>
  trend.value.map((p, i) => ({
    ...p,
    x:
      trend.value.length === 1
        ? (W - PAD * 2) / 2 + PAD
        : PAD + (i * (W - PAD * 2)) / (trend.value.length - 1),
    y: PAD + ((100 - p.accuracy) * (H - PAD * 2)) / 100,
  })),
)

/** 日期随 locale（015 i18n-4：统一 Intl） */
function fmtDay(at: number) {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'numeric', day: 'numeric' }).format(at)
}

/* ── 移动平均线（2026-11-04 用户定）────────────────────────────────────
 * 原来是一条贯穿全图的**水平虚线**（整个区间一个平均值），信息量太低、看着也呆板。
 * 改成类似股市均线的**平滑曲线**：以「有记录的日子」为步长，每个点的值是
 * **最近 3 个有记录日**的按题加权正确率，然后把这些点连成平滑弧线。
 *
 * 归一化说明：
 *  · 按「有记录的日子」而不是「自然日」——多数人不会每天做题，按自然日会在空档处
 *    断裂或需要编造插值；用户要的是「过去 3 个有记录的日期」。
 *  · 同一天多轮先按题数加权合并成日均值，否则一天两个点会让曲线抖动。
 *  · **窗口填满 3 个记录日才出第一个点**——不足 3 天拿原始值冒充「3 日均值」是假的。
 *
 * 算法本身在 `core/statsChart.ts` 的 `movingAverage()` 里，有单测覆盖
 * （`statsChart.spec.ts`：开头不出点 / 空档跳过 / 同日合并 / 滑动移出窗口）。
 */

/** 均线点（带屏幕坐标） */
const maPts = computed(() => {
  const n = trend.value.length
  return movingAverage(trend.value, 3).map((p) => {
    // 同一天多轮 → 取当天各轮次的平均序号，均线点落在当天中间而不是偏左
    const idx = p.indices.reduce((a, b) => a + b, 0) / p.indices.length
    const x = n === 1 ? (W - PAD * 2) / 2 + PAD : PAD + (idx * (W - PAD * 2)) / (n - 1)
    return { ...p, x, y: PAD + ((100 - p.accuracy) * (H - PAD * 2)) / 100 }
  })
})

/**
 * 平滑路径：**C1 连续的三次 Hermite 样条**（中心差分取切线）。
 *
 * 为什么不用均匀参数化的 Catmull-Rom：均线点的 x 间距**不均匀**——
 * 同一天有多轮时，均线点落在当天各轮次的平均序号上，间距随当天轮数变化。
 * 均匀公式（控制点 = 相邻点差 × tension）在不等距处会给出错误的切线，
 * 视觉上表现为尖角或过冲（之前 11/5→11/6 那段就是尖的）。
 *
 * 正确做法是按实际 x 间距缩放切线：
 *   切线 m_i = (P_{i+1} − P_{i−1}) / (x_{i+1} − x_{i−1})   ← 导数估计
 *   段 i→i+1 的控制点：c1 = P_i + m_i·dx/3，c2 = P_{i+1} − m_{i+1}·dx/3
 * 这样曲线必然穿过每个数据点，且在不等距处也是平滑的。
 */
const smoothPath = (pts: { x: number; y: number }[]) => {
  const n = pts.length
  if (n < 2) return ''

  // 每点的切线斜率（dy/dx）；端点用单侧差分
  const slope: number[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(n - 1, i + 1)]!
    const dx = b.x - a.x
    slope.push(dx === 0 ? 0 : (b.y - a.y) / dx)
  }

  const first = pts[0]!
  let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const dx = p2.x - p1.x
    if (dx <= 0) {
      // 退化（同 x）：直接连线，避免除零
      d += ` L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
      continue
    }
    const c1x = p1.x + dx / 3
    const c1y = p1.y + (slope[i]! * dx) / 3
    const c2x = p2.x - dx / 3
    const c2y = p2.y - (slope[i + 1]! * dx) / 3
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

const maPath = computed(() => smoothPath(maPts.value))
</script>

<template>
  <section v-if="rounds.length" class="charts">
    <h3 class="sec">
      <TrendingUp class="ic" :size="18" /> {{ t('charts.trendTitle') }}
    </h3>
    <div class="range" role="group" :aria-label="t('charts.trendTitle')">
      <button
        type="button"
        :class="{ on: range === '7d' }"
        :aria-pressed="range === '7d'"
        @click="range = '7d'"
      >
        {{ t('charts.range7d') }}
      </button>
      <button
        type="button"
        :class="{ on: range === '30d' }"
        :aria-pressed="range === '30d'"
        @click="range = '30d'"
      >
        {{ t('charts.range30d') }}
      </button>
      <button
        v-for="y in years"
        :key="y"
        type="button"
        :class="{ on: range === y }"
        :aria-pressed="range === y"
        @click="range = y"
      >
        {{ t('charts.rangeYear', { year: y }) }}
      </button>
    </div>
    <div class="chart-card">
      <p v-if="!trend.length" class="empty muted">{{ t('charts.trendEmpty') }}</p>
      <template v-else>
        <svg :viewBox="`0 0 ${W} ${H}`" class="trend" role="img" :aria-label="t('charts.trendAria')">
          <line v-for="g in [0, 50, 100]" :key="g" :x1="PAD" :x2="W - PAD" :y1="PAD + ((100 - g) * (H - PAD * 2)) / 100" :y2="PAD + ((100 - g) * (H - PAD * 2)) / 100" class="grid" />
          <text v-for="g in [100, 50, 0]" :key="'t' + g" :x="PAD + 2" :y="PAD + ((100 - g) * (H - PAD * 2)) / 100 - 2" class="grid-text">{{ g }}</text>
          <!-- 3 日移动平均（2026-11-04 用户定）：平滑弧线，替代原来的水平虚线。
               从**第 3 个记录日**起才有线（窗口填满 3 天），前两天的数据不参与假均线 -->
          <path v-if="maPath" :d="maPath" class="ma-line" />
          <circle
            v-for="(p, i) in maPts"
            :key="'ma' + i"
            :cx="p.x"
            :cy="p.y"
            :r="2"
            class="ma-dot"
          >
            <title>{{ t('charts.maDotTitle', { day: fmtDay(p.at), acc: p.accuracy }) }}</title>
          </circle>
          <polyline v-if="trendPts.length > 1" :points="trendPts.map((p) => `${p.x},${p.y}`).join(' ')" class="line" />
          <circle
            v-for="(p, i) in trendPts"
            :key="i"
            :cx="p.x"
            :cy="p.y"
            :r="3"
            class="dot"
            :class="{ audio: p.mode === 'audio' }"
          >
            <title>{{
              t('charts.dotTitle', { day: fmtDay(p.at), mode: modeOf(p.mode), tier: p.tier, acc: p.accuracy })
            }}</title>
          </circle>
        </svg>
        <p class="legend muted">{{ t('charts.legend') }}</p>
        <p v-if="maPts.length > 1" class="legend muted">{{ t('charts.legendMa') }}</p>
      </template>
    </div>

    <h3 class="sec"><BarChart3 class="ic" :size="18" /> {{ t('charts.byTierMode') }}</h3>
    <div class="chart-card">
      <div v-for="row in [...byTier, ...byMode]" :key="row.key" class="bar-row">
        <span class="bar-label">{{ row.label }}</span>
        <div class="bar-track">
          <div class="bar" :style="{ width: row.accuracy + '%' }"></div>
        </div>
        <span class="bar-val">{{ row.accuracy }}%</span>
        <span class="bar-n muted">{{ t('charts.questionsCount', { correct: row.correct, total: row.questions }) }}</span>
      </div>
      <!-- 独立模式（L8 记忆挑战鸟 / S1 相似种挑战）不计入经典档位，单独一行汇总，
           避免「打过但图表里看不到」的数据凭空消失（docs/100 §5 缺陷 5） -->
      <div v-if="standaloneRounds" class="bar-row standalone">
        <span class="bar-label">{{ t('charts.standalone') }}</span>
        <div class="bar-track">
          <div class="bar" :style="{ width: standaloneRounds.accuracy + '%' }"></div>
        </div>
        <span class="bar-val">{{ standaloneRounds.accuracy }}%</span>
        <span class="bar-n muted">
          {{ t('charts.questionsCount', { correct: standaloneRounds.correct, total: standaloneRounds.questions }) }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.charts {
  margin-top: 22px;
}
.range {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.range button {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.range button:hover {
  border-color: var(--primary-light);
  color: var(--primary);
}
.range button.on {
  background: var(--grad);
  color: #fff;
  border-color: transparent;
}
.chart-card {
  background: #f9fcfa;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin-bottom: 12px;
}
.empty {
  text-align: center;
  padding: 22px 0;
  font-size: 0.82rem;
}
.trend {
  width: 100%;
  height: auto;
  display: block;
}
.grid {
  stroke: #e3eee8;
  stroke-width: 1;
}
.grid-text {
  font-size: 7px;
  fill: #9fb5aa;
}
/* 3 日移动平均线（2026-11-04）：比数据折线细一点、颜色偏暖，作为参考线不与主数据抢视觉 */
.ma-line {
  fill: none;
  stroke: #b0851f;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.9;
}
.ma-dot {
  fill: #b0851f;
}
.line {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.dot {
  fill: var(--primary);
}
.dot.audio {
  fill: #14532d;
}
.legend {
  font-size: 0.7rem;
  margin-top: 6px;
  text-align: center;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
}
.bar-label {
  flex: 0 0 72px;
  font-size: 0.78rem;
  font-weight: 600;
}
.bar-track {
  flex: 1;
  height: 10px;
  background: #e7f1ec;
  border-radius: 5px;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: var(--grad);
  border-radius: 5px;
  min-width: 2px;
}
.bar-val {
  flex: 0 0 42px;
  text-align: right;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.bar-n {
  flex: 0 0 70px;
  font-size: 0.7rem;
  text-align: right;
}
/* 独立模式汇总行（L8/S1）：与经典档位用一条上分隔线隔开，不做成「另一个档位」的样子 */
.bar-row.standalone {
  margin-top: 6px;
  padding-top: 11px;
  border-top: 1px dashed #d5e5dd;
}
.bar-row.standalone .bar-label {
  color: var(--muted, #6b7c74);
}
</style>
