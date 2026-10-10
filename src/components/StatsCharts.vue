<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BarChart3, TrendingUp } from 'lucide-vue-next'
import type { MediaType } from '@/types'
import type { RoundRecord } from '@/core/historyDb'
import { TIER_LIST, TIERS } from '@/core/difficulty'
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

/** 时间正序的趋势点（按所选区间过滤） */
const trend = computed(() => {
  const [from, to] = rangeBounds(range.value)
  return [...props.rounds]
    .filter((r) => r.at >= from && r.at < to)
    .sort((a, b) => a.at - b.at)
    .map((r) => ({ at: r.at, accuracy: r.accuracy, mode: r.mode, tier: r.tier }))
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

const byTier = computed(() =>
  TIER_LIST.map((t) => t.tier)
    .map((tier) => ({ key: tier, label: t(TIERS[tier].labelKey), ...agg(props.rounds.filter((r) => r.tier === tier)) }))
    .filter((x) => x.rounds > 0),
)

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
</style>
