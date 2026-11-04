<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BarChart3, TrendingUp } from 'lucide-vue-next'
import type { MediaType, Tier } from '@/types'
import type { RoundRecord } from '@/core/historyDb'
import { TIERS, countsInClassicStats } from '@/core/difficulty'
import { dailyBuckets, localDayStart } from '@/core/statsChart'
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

// ---- 趋势折线图几何 ----
// viewBox 300×148：上方 12 边距 + 绘图区 + 下方 20 的日期刻度带，左右各 12。
// **横轴是真实日历轴**（2026-11-05 用户定）：x 与日期成比例，刻度每 2 个自然日一个。
// 此前按「轮次序号均分」排 x，导致刻度标签间隔忽宽忽窄（用户当场指出）。
const W = 300
const H = 148
const PAD = 12 /* R34：由 6 增大，修复 g=100 文字/圆点顶部被 viewBox 裁切 */
const AXIS_H = 20 /* 底部日期刻度带高度 */
const PLOT_H = H - PAD - AXIS_H - PAD /* 绘图区高度（0~100% 的映射空间） */
const DAY_MS = 86_400_000

const yOf = (accuracy: number) => PAD + ((100 - accuracy) * PLOT_H) / 100

/** 有记录的天（本地日）序列；用于日历轴两端与「同日多轮」的散开定位 */
const recordDays = computed(() => dailyBuckets(trend.value))

/** 日历轴的起止（都归到当天 0 点）与总天数 */
const calSpan = computed(() => {
  const days = recordDays.value
  if (!days.length) return null
  const first = localDayStart(days[0]!.at)
  const last = localDayStart(days[days.length - 1]!.at)
  return { first, last, totalDays: Math.max(1, Math.round((last - first) / DAY_MS)) }
})

/** 时刻 → 横轴 x（与真实日期成比例） */
function xOfAt(at: number): number {
  const span = calSpan.value
  if (!span) return (W - PAD * 2) / 2 + PAD
  return PAD + ((localDayStart(at) - span.first) / DAY_MS / span.totalDays) * (W - PAD * 2)
}

const trendPts = computed(() => {
  const span = calSpan.value
  const dayWidth = span ? (W - PAD * 2) / span.totalDays : 0
  // 同一天多轮在当天格内横向散开（居中），否则圆点会完全重叠
  const dotStep = Math.min(4, Math.max(2, dayWidth * 0.45))
  const seen = new Map<number, number>()
  return trend.value.map((p) => {
    const ds = localDayStart(p.at)
    const pos = seen.get(ds) ?? 0
    seen.set(ds, pos + 1)
    const k = recordDays.value.find((d) => d.at >= ds && d.at < ds + DAY_MS)?.indices.length ?? 1
    const x = xOfAt(ds) + (pos - (k - 1) / 2) * dotStep
    return { ...p, x, y: yOf(p.accuracy) }
  })
})

/** 区间平均正确率（按题加权，与下方按档位/模式条形同口径）——图内一条水平参考线 */
const trendAvg = computed(() => {
  const [from, to] = rangeBounds(range.value)
  return agg(props.rounds.filter((r) => r.at >= from && r.at < to))
})

const avgY = computed(() => yOf(trendAvg.value.accuracy))

/**
 * 横轴日期刻度（2026-11-05 用户定）：**每隔 2 个自然日一个**，与数据有无无关。
 * 大跨度（按年）下每两天一个会挤成一团，按密度自动放大间隔（下限仍是 2 天）。
 */
const axisTicks = computed(() => {
  const span = calSpan.value
  if (!span) return []
  const stepDays = Math.max(2, Math.ceil(span.totalDays / 15))
  const out: { at: number; x: number }[] = []
  for (let t = span.first; t <= span.last; t += stepDays * DAY_MS) {
    const mid = t + DAY_MS / 2 // 刻度对齐「当天中部」，与该日散点簇对齐
    out.push({ at: mid, x: xOfAt(mid) })
  }
  return out
})

/** 日期随 locale（015 i18n-4：统一 Intl） */
function fmtDay(at: number) {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'numeric', day: 'numeric' }).format(at)
}
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
          <line v-for="g in [0, 50, 100]" :key="g" :x1="PAD" :x2="W - PAD" :y1="yOf(g)" :y2="yOf(g)" class="grid" />
          <text v-for="g in [100, 50, 0]" :key="'t' + g" :x="PAD + 2" :y="yOf(g) - 2" class="grid-text">{{ g }}</text>
          <!-- 区间平均正确率：虚线 + 右端数值（2026-11-05 用户定：回退到这个形态） -->
          <line v-if="trendAvg.rounds" :x1="PAD" :x2="W - PAD" :y1="avgY" :y2="avgY" class="avg-line" />
          <text v-if="trendAvg.rounds" :x="W - PAD - 2" :y="avgY - 3" text-anchor="end" class="avg-text">
            {{ t('charts.trendAvg', { acc: trendAvg.accuracy }) }}
          </text>
          <polyline v-if="trendPts.length > 1" :points="trendPts.map((p) => `${p.x},${p.y}`).join(' ')" class="line" />
          <!-- 横轴日期刻度：每隔两天一个日期（2026-11-05 用户定） -->
          <text v-for="tick in axisTicks" :key="'d' + tick.at" :x="tick.x" :y="H - 6" text-anchor="middle" class="axis-text">
            {{ fmtDay(tick.at) }}
          </text>
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
/* 区间平均正确率（虚线 + 右端标签）——2026-11-05 用户定回退为此形态 */
.avg-line {
  stroke: #b0851f;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.avg-text {
  font-size: 7px;
  fill: #b0851f;
  font-weight: 700;
}
/* 横轴日期刻度（每隔两天一个） */
.axis-text {
  font-size: 7px;
  fill: #9fb5aa;
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
