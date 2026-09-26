<script setup lang="ts">
import { computed } from 'vue'
import { BarChart3, TrendingUp } from 'lucide-vue-next'
import type { MediaType, Tier } from '@/types'
import type { RoundRecord } from '@/core/historyDb'

const props = defineProps<{ rounds: RoundRecord[] }>()

const TIERS: Record<Tier, string> = { 1: '入门', 2: '进阶', 3: '高手', 4: '专家', 5: '地狱' }
const MODES: Record<MediaType, string> = { image: '看图', audio: '听音' }

/** 时间正序的趋势点（最近 20 轮） */
const trend = computed(() =>
  [...props.rounds]
    .sort((a, b) => a.at - b.at)
    .slice(-20)
    .map((r) => ({ at: r.at, accuracy: r.accuracy, mode: r.mode, tier: r.tier })),
)

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
  ([1, 2, 3, 4, 5] as Tier[])
    .map((tier) => ({ key: tier, label: `L${tier} ${TIERS[tier]}`, ...agg(props.rounds.filter((r) => r.tier === tier)) }))
    .filter((x) => x.rounds > 0),
)

const byMode = computed(() =>
  (['image', 'audio'] as MediaType[])
    .map((mode) => ({ key: mode, label: MODES[mode], ...agg(props.rounds.filter((r) => r.mode === mode)) }))
    .filter((x) => x.rounds > 0),
)

// ---- 趋势折线图几何（viewBox 300×130，左右留 6 边距） ----
const W = 300
const H = 130
const PAD = 6

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

function fmtDay(at: number) {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <section v-if="rounds.length" class="charts">
    <h3 class="sec"><TrendingUp class="ic" :size="18" /> 正确率趋势（最近 {{ trend.length }} 轮）</h3>
    <div class="chart-card">
      <svg :viewBox="`0 0 ${W} ${H}`" class="trend" role="img" aria-label="每轮正确率趋势">
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
          <title>{{ fmtDay(p.at) }} · {{ MODES[p.mode] }} L{{ p.tier }} · {{ p.accuracy }}%</title>
        </circle>
      </svg>
      <p class="legend muted">圆点：单轮正确率（悬停看详情） · 绿=看图 / 深绿=听音</p>
    </div>

    <h3 class="sec"><BarChart3 class="ic" :size="18" /> 按难度 / 模式</h3>
    <div class="chart-card">
      <div v-for="row in [...byTier, ...byMode]" :key="row.key" class="bar-row">
        <span class="bar-label">{{ row.label }}</span>
        <div class="bar-track">
          <div class="bar" :style="{ width: row.accuracy + '%' }"></div>
        </div>
        <span class="bar-val">{{ row.accuracy }}%</span>
        <span class="bar-n muted">{{ row.correct }}/{{ row.questions }} 题</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.charts {
  margin-top: 22px;
}
.chart-card {
  background: #f9fcfa;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
  margin-bottom: 12px;
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
