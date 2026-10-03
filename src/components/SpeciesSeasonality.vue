<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarRange } from 'lucide-vue-next'
import type { SeasonalityEntry } from '@/core/seasonality'

const props = defineProps<{ entry: SeasonalityEntry }>()

const { t, locale } = useI18n()

/** 来源内部 key → 展示名（署名不可省，021 §2.4） */
const SOURCE_LABELS: Record<string, string> = {
  gbif: 'GBIF',
  xc: 'Xeno-canto',
  inat: 'iNaturalist',
}

const sourceLabels = computed(() => {
  const base = props.entry.sources.map((s) => SOURCE_LABELS[s] || s).join(' · ')
  // 权威居留型（021 M3）来自生活史数据集，署名不可省（docs/024 §2.5）
  const rangeSrc = props.entry.range?.length ? `；${t('season.rangeSource')}` : ''
  return base + rangeSrc
})

const monthNames = computed(() =>
  Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale.value, { month: 'narrow' }).format(new Date(2024, i, 15)),
  ),
)

const maxShare = computed(() => Math.max(...props.entry.months, 0))

/** 高峰月份 = 份额 ≥60% 峰值的月份，连续月折叠为区间（如 4月–7月 / Apr–Jul） */
const peakLabel = computed(() => {
  const th = maxShare.value * 0.6
  if (maxShare.value <= 0) return ''
  const ms = props.entry.months.map((v, i) => (v >= th ? i + 1 : 0)).filter(Boolean)
  if (!ms.length) return ''
  const ranges: string[] = []
  let start = ms[0]!
  let prev = ms[0]!
  for (const m of ms.slice(1)) {
    if (m === prev + 1) {
      prev = m
      continue
    }
    ranges.push(start === prev ? `${monthNames.value[start - 1]}` : `${monthNames.value[start - 1]}–${monthNames.value[prev - 1]}`)
    start = m
    prev = m
  }
  ranges.push(
    start === prev ? `${monthNames.value[start - 1]}` : `${monthNames.value[start - 1]}–${monthNames.value[prev - 1]}`,
  )
  return ranges.join('、')
})

const ariaLabel = computed(() => {
  const peak = peakLabel.value ? `; ${t('season.peak', { months: peakLabel.value })}` : ''
  return `${t('season.title')}${peak}; ${t('season.records', { n: props.entry.recordCount })}`
})

/** 权威居留型（021 M3）：文案复用 species.migrations 词条 */
const rangeLabels = computed(() =>
  (props.entry.range || []).map((r) => t(`species.migrations.${r}`)).filter((s) => !s.startsWith('species.')),
)

function barHeight(v: number): string {
  if (maxShare.value <= 0) return '0%'
  return `${Math.max((v / maxShare.value) * 100, 3)}%`
}

function barTitle(i: number): string {
  return `${monthNames.value[i]}: ${props.entry.months[i]}`
}
</script>

<template>
  <section class="season">
    <h3 class="head"><CalendarRange class="ic" :size="16" /> {{ t('season.title') }}</h3>
    <div class="bars" role="group" :aria-label="ariaLabel">
      <div v-for="(v, i) in entry.months" :key="i" class="col" aria-hidden="true">
        <div class="track">
          <div class="bar" :class="{ empty: v === 0 }" :style="{ height: barHeight(v) }" :title="barTitle(i)"></div>
        </div>
        <span class="label">{{ monthNames[i] }}</span>
      </div>
    </div>
    <p v-if="peakLabel" class="peak">{{ t('season.peak', { months: peakLabel }) }}</p>
    <p v-if="rangeLabels.length" class="range-tags">
      <span v-for="r in rangeLabels" :key="r" class="tag tag-green">{{ r }}</span>
    </p>
    <p class="meta muted">
      {{ t('season.records', { n: entry.recordCount }) }}
      <span class="src">{{ sourceLabels }}</span>
    </p>
    <p class="muted hint">{{ t('season.hint') }}</p>
  </section>
</template>

<style scoped>
.season {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: #f7faf8;
  text-align: left;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--primary-dark);
  margin-bottom: 10px;
}
.head .ic {
  color: var(--primary);
}
.bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.track {
  width: 100%;
  max-width: 34px;
  height: 64px;
  display: flex;
  align-items: flex-end;
  background: #eaf4ef;
  border-radius: 5px;
  overflow: hidden;
}
.bar {
  width: 100%;
  background: var(--grad);
  border-radius: 5px 5px 0 0;
  transition: height 0.3s ease;
}
.bar.empty {
  background: transparent;
}
.label {
  font-size: 0.62rem;
  color: var(--text-light);
  line-height: 1.2;
}
.peak {
  margin-top: 8px;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--primary-dark);
}
.range-tags {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.meta {
  margin-top: 4px;
  font-size: 0.74rem;
}
.meta .src {
  margin-left: 8px;
  color: var(--text-light);
}
.hint {
  margin-top: 2px;
  font-size: 0.7rem;
}
</style>
