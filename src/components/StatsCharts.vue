<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BarChart3, TrendingUp } from 'lucide-vue-next'
import type { MediaType, Tier } from '@/types'
import type { RoundRecord } from '@/core/historyDb'
import { TIERS, countsInClassicStats } from '@/core/difficulty'
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
 * 为什么按「有记录的日子」而不是「自然日」：多数人不会每天做题，
 * 按自然日做 3 日均线会在没记录的日子直接断掉（或需要补插值编造数据）；
 * 用户明确要求「过去 3 个有记录的日期（中间有可能是间断的）」，即跳过空档。
 *
 * 跨轮次加权：同一天做了两轮就合并成一个点（按题数加权），否则一天两个点会让曲线抖动。
 */
interface MaPoint {
  at: number
  /** 该点覆盖的日期个数（末尾不足 3 天时为 1 或 2） */
  span: number
  accuracy: number
  /** 该日各轮次在趋势序列里的序号（算均线点的 x 用） */
  indices: number[]
}

/** 按「日」聚合成日正确率桶（同一天多轮 → 按题数加权合并），时间正序 */
interface DayBucket {
  at: number
  questions: number
  correct: number
  /** 当天所有轮次在趋势序列里的序号（均线点取它们的平均 x，不偏向当天首轮） */
  indices: number[]
}
const dayBuckets = computed<DayBucket[]>(() => {
  const map = new Map<number, DayBucket>()
  for (const [i, p] of trend.value.entries()) {
    const d = new Date(p.at)
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const b = map.get(key)
    if (b) {
      b.questions += p.total
      b.correct += p.correct
      b.indices.push(i)
    } else {
      map.set(key, { at: p.at, questions: p.total, correct: p.correct, indices: [i] })
    }
  }
  return [...map.values()].sort((a, b) => a.at - b.at)
})

/** 3 日移动平均：每个有记录日一个点，取最近 3 个有记录日（含自身）的加权正确率 */
const maPoints = computed<MaPoint[]>(() => {
  const days = dayBuckets.value
  const out: MaPoint[] = []
  for (let i = 0; i < days.length; i++) {
    const from = Math.max(0, i - 2) // 3 日窗口：i-2, i-1, i
    const window = days.slice(from, i + 1)
    const questions = window.reduce((n, d) => n + d.questions, 0)
    const correct = window.reduce((n, d) => n + d.correct, 0)
    out.push({
      at: days[i]!.at,
      span: window.length,
      accuracy: questions ? Math.round((correct / questions) * 100) : 0,
      indices: days[i]!.indices,
    })
  }
  return out
})

/** 均线点的 x 坐标：与趋势点共用同一套「按序号均分」的横轴（时间间隔不按真实时长缩放） */
const maPts = computed(() =>
  maPoints.value.map((p) => {
    const n = trend.value.length
    // 同一天多轮 → 取当天各轮次的平均序号，均线点落在当天中间而不是偏左
    const idx = p.indices.reduce((a, b) => a + b, 0) / p.indices.length
    const x = n === 1 ? (W - PAD * 2) / 2 + PAD : PAD + (idx * (W - PAD * 2)) / (n - 1)
    return { ...p, x, y: PAD + ((100 - p.accuracy) * (H - PAD * 2)) / 100 }
  }),
)

/**
 * 平滑路径（Catmull-Rom → 三次贝塞尔）。
 * 直接连折线会显得生硬；这里把每段曲线的控制点取相邻点切线，
 * 视觉上就是股价图里那种圆滑的弧线，且**必然穿过每个数据点**（不改变数值）。
 */
const maPath = computed(() => {
  const pts = maPts.value
  if (pts.length < 2) return ''
  const k = 0.2 // 切线张力：0 = 折线，0.5 = 很圆；0.2 接近常见均线的柔和度
  const first = pts[0]!
  let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p0 = pts[i - 1] ?? p1
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) * k
    const c1y = p1.y + (p2.y - p0.y) * k
    const c2x = p2.x - (p3.x - p1.x) * k
    const c2y = p2.y - (p3.y - p1.y) * k
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
})
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
          <!-- 3 日移动平均（2026-11-04 用户定）：平滑弧线，替代原来的水平虚线 -->
          <path v-if="maPath" :d="maPath" class="ma-line" />
          <circle
            v-for="(p, i) in maPts"
            :key="'ma' + i"
            :cx="p.x"
            :cy="p.y"
            :r="1.6"
            class="ma-dot"
          >
            <title>{{ t('charts.maDotTitle', { day: fmtDay(p.at), span: p.span, acc: p.accuracy }) }}</title>
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
