<script setup lang="ts">
/**
 * 028 公开统计看板（/stats）——公开只读，无需登录。
 *
 * 展示：独立访客 / 访问会话 / 完成轮次 / 答题总数 / 页面浏览 / 海报与反馈，
 * 以及**徽章与称号的获取人数**（数据由匿名计量事件累积，见 docs/028 §3.4）。
 * 口径说明随页面一起展示（避免"数字怎么来的"疑问）；成绩/档案仍只存各人设备。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BarChart3, Trophy } from 'lucide-vue-next'
import BadgeIcon from '@/components/BadgeIcon.vue'
import { BADGES } from '@/core/badges'
import { TITLE_TRACKS } from '@/core/titles'
import { dailySeries, fetchPublicStats, totalOf, type PublicStats } from '@/core/publicStats'
import { logPct, logTicks, logTop, trimLeadingZeros } from '@/core/statsChart'
import { currentLocale } from '@/i18n'

const { t } = useI18n()

const stats = ref<PublicStats | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const unavailable = ref(false)

async function load() {
  const s = await fetchPublicStats(30)
  stats.value = s
  unavailable.value = !s
  loading.value = false
  refreshing.value = false
}

/** 手动刷新：数据最多 5 分钟旧（Worker 聚合缓存），不必等页面重进 */
async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  await load()
}

onMounted(load)

type CardKey = 'uniqueVisitors' | 'sessions' | 'rounds' | 'pageViews' | 'posters' | 'reports'
const cards = computed<{ key: CardKey; event: string; note?: boolean }[]>(() => [
  { key: 'uniqueVisitors', event: 'visitor_unique', note: true },
  { key: 'sessions', event: 'session_start', note: true },
  { key: 'rounds', event: 'quiz_complete' },
  { key: 'pageViews', event: 'page_view' },
  { key: 'posters', event: 'poster_create' },
  { key: 'reports', event: 'report_submit' },
])
const valueOf = (event: string) => totalOf(stats.value, event)

/**
 * 近 N 日「完成轮次」逐日条形。
 *
 * 2026-10-21 改造（用户反馈）：
 * ① 纵轴改**对数刻度**——早期一天几轮、最近一天上百轮，线性刻度会把前期压成 0；
 * ② 去掉开头上线前的 0（否则 9 月会显示一排"绿色小柱子"，误导成有数据）；
 * ③ 每根柱子标出具体数值；手机端隔一根显示数值/日期，避免密密麻麻。
 */
const roundBars = computed(() => trimLeadingZeros(dailySeries(stats.value, 'quiz_complete')))
const chartTop = computed(() => logTop(Math.max(0, ...roundBars.value.map((d) => d.n))))
const yTicks = computed(() => logTicks(chartTop.value))
const barPct = (n: number) => logPct(n, chartTop.value)
const rangeText = computed(() => {
  const bars = roundBars.value
  if (!bars.length) return ''
  return t('stats.range', {
    from: dayLabel(bars[0]!.day),
    to: dayLabel(bars[bars.length - 1]!.day),
    n: bars.length,
  })
})

/** 徽章获取榜（按人数降序；只显示 >0 的，全部为 0 时给一句占位） */
const badgeRows = computed(() => {
  const map = new Map((stats.value?.badges ?? []).map((b) => [b.badge, b.n]))
  return BADGES.map((b) => ({ id: b.id, labelKey: b.labelKey, icon: b.icon, n: map.get(b.id) ?? 0 }))
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n)
})

/** 称号获取榜（track × level） */
const titleRows = computed(() => {
  const list: { trackId: string; level: number; nameKey: string; labelKey: string; icon: string; n: number }[] = []
  for (const tr of TITLE_TRACKS) {
    for (let lv = 1; lv <= tr.levels.length; lv++) {
      const level = tr.levels[lv - 1]
      if (!level) continue
      const n = (stats.value?.titles ?? [])
        .filter((x) => x.track === tr.id && x.level === String(lv))
        .reduce((a, b) => a + b.n, 0)
      if (n > 0) list.push({ trackId: tr.id, level: lv, nameKey: tr.nameKey, labelKey: level.labelKey, icon: tr.icon, n })
    }
  }
  return list.sort((a, b) => b.n - a.n)
})

const dateText = computed(() => {
  if (!stats.value) return ''
  try {
    return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(stats.value.generatedAt),
    )
  } catch {
    return stats.value.generatedAt
  }
})
const dayLabel = (day: string) => day.slice(5) // MM-DD
</script>

<template>
  <section class="card stats">
    <h2 class="head"><BarChart3 class="ic" :size="22" /> {{ t('stats.title') }}</h2>
    <p class="muted lead">{{ t('stats.lead') }}</p>

    <p v-if="loading" class="muted center">{{ t('stats.loading') }}</p>
    <p v-else-if="unavailable" class="muted center" role="alert">{{ t('stats.unavailable') }}</p>

    <template v-else>
      <p class="muted small meta">
        {{ t('stats.generatedAt', { at: dateText }) }} · {{ t('stats.cachedHint') }}
        <button class="link refresh" type="button" :disabled="refreshing" @click="reload">
          {{ refreshing ? t('stats.refreshing') : t('stats.refresh') }}
        </button>
      </p>

      <!-- 数字卡：访客 / 会话 / 轮次 / 答题数 / 浏览 / 海报 / 反馈 -->
      <h3 class="sec"><Trophy class="ic" :size="16" /> {{ t('stats.sectionVisitors') }}</h3>
      <div class="cards">
        <div v-for="c in cards" :key="c.key" class="card-item">
          <span class="num">{{ valueOf(c.event) }}</span>
          <span class="cap">{{ t(`stats.${c.key}`) }}</span>
          <span v-if="c.key === 'uniqueVisitors'" class="hint muted">{{ t('stats.uniqueVisitorsNote') }}</span>
          <span v-else-if="c.key === 'sessions'" class="hint muted">{{ t('stats.sessionsNote') }}</span>
        </div>
      </div>

      <!-- 近 N 日完成轮次（对数刻度） -->
      <h3 class="sec">{{ t('stats.sectionActivity') }}</h3>
      <p class="chartMeta muted small">
        <span>{{ rangeText }}</span>
        <span v-if="roundBars.length" class="logNote">{{ t('stats.logScale') }}</span>
      </p>
      <p v-if="!roundBars.length" class="muted small">{{ t('stats.noActivity') }}</p>
      <div
        v-else
        class="plot"
        :class="{ dense: roundBars.length > 16 }"
        role="img"
        :aria-label="`${t('stats.rounds')} · ${rangeText} · ${t('stats.logScale')}`"
      >
        <!-- 纵轴：1 / 10 / 100 / 1k …（虚线网格 + 左侧刻度） -->
        <div class="grid" aria-hidden="true">
          <span v-for="tick in yTicks" :key="tick.v" class="gridLine" :style="{ bottom: tick.pct + '%' }">
            <i class="tickLabel">{{ tick.label }}</i>
          </span>
        </div>
        <ol class="bars">
          <li v-for="d in roundBars" :key="d.day" :title="`${d.day} · ${d.n}`">
            <span class="cell">
              <template v-if="d.n > 0">
                <span class="bar" :style="{ height: barPct(d.n) + '%' }" />
                <span class="bar-n" :style="{ bottom: barPct(d.n) + '%' }">{{ d.n }}</span>
              </template>
            </span>
            <span class="bar-day muted">{{ dayLabel(d.day) }}</span>
          </li>
        </ol>
      </div>

      <!-- 徽章获取榜 -->
      <h3 class="sec">{{ t('stats.sectionBadges') }}</h3>
      <p v-if="!badgeRows.length" class="muted small">{{ t('stats.nobodyYet') }}</p>
      <ul v-else class="ranks">
        <li v-for="b in badgeRows" :key="b.id">
          <BadgeIcon class="rank-icon" :name="b.icon" :size="16" />
          <span class="rank-name">{{ t(b.labelKey) }}</span>
          <span class="rank-n">{{ t('stats.earnCount', { n: b.n }) }}</span>
        </li>
      </ul>

      <!-- 称号获取榜 -->
      <h3 class="sec">{{ t('stats.sectionTitles') }}</h3>
      <p v-if="!titleRows.length" class="muted small">{{ t('stats.nobodyYet') }}</p>
      <ul v-else class="ranks">
        <li v-for="r in titleRows" :key="`${r.trackId}-${r.level}`">
          <BadgeIcon class="rank-icon" :name="r.icon" :size="16" />
          <span class="rank-name">{{ t(r.nameKey) }} · {{ t(r.labelKey) }}</span>
          <span class="rank-n">{{ t('stats.earnCount', { n: r.n }) }}</span>
        </li>
      </ul>

      <p class="muted small foot">{{ t('stats.scopeNote') }}</p>
    </template>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.15rem;
}
.lead {
  margin-top: 6px;
}
.meta {
  margin-top: 10px;
}
.meta .refresh {
  margin-left: 8px;
  padding: 0;
  background: none;
  border: none;
  font: inherit;
  color: var(--primary, #2563eb);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.meta .refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.sec {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 18px 0 8px;
  font-size: 0.95rem;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.card-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.card-item .num {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--primary);
  line-height: 1.2;
}
.card-item .cap {
  font-size: 0.78rem;
  font-weight: 600;
}
.card-item .hint {
  font-size: 0.66rem;
  line-height: 1.35;
}
.chartMeta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 4px;
}
.logNote {
  opacity: 0.75;
}
/* 绘图区：左侧留出刻度文字的位置；顶部留白给最高柱子的数字 */
.plot {
  position: relative;
  height: 150px;
  /* 左侧给刻度文字、右侧给最后一根柱子的斜置日期（rotate(-60) 会横向溢出） */
  margin: 20px 16px 20px 34px;
}
.grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gridLine {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed var(--border);
}
.tickLabel {
  position: absolute;
  right: calc(100% + 6px);
  top: 0;
  transform: translateY(-50%);
  font-style: normal;
  font-size: 0.55rem;
  color: var(--text-light);
  white-space: nowrap;
}
.bars {
  position: relative;
  list-style: none;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 100%;
  padding: 0;
  margin: 0;
}
.bars li {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  /* 日期标签改为绝对定位（见 .bar-day）：柱高百分比必须与刻度线同一基准（= 绘图区高度），
     否则柱子会整体偏高，出现「数据 6 却顶到 10 的刻度线」的错觉 */
  position: relative;
}
/* 柱子与数字的定位容器：高度 = 绘图区高度（日期标签已绝对定位到图外，不再占位） */
.cell {
  position: relative;
  flex: 1;
  width: 100%;
}
.bar {
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: 0;
  background: var(--primary-light, var(--primary));
  border-radius: 2px 2px 0 0;
  opacity: 0.85;
}
/* 具体数值：贴在柱子顶部（0 轮不画柱子也不显示数字） */
.bar-n {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding-bottom: 1px;
  font-size: 0.48rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--text-light);
  white-space: nowrap;
}
.bar-day {
  /* 绝对定位：不再占据绘图区高度（否则柱子按"绘图区-日期行"折算，会整体偏高） */
  position: absolute;
  top: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%) rotate(-60deg);
  font-size: 0.5rem;
  white-space: nowrap;
  height: 14px;
  text-align: center;
}
/* 手机：柱子太密 → 隔一根显示数值与日期（其余仍可长按/title 查看） */
@media (max-width: 640px) {
  .plot {
    height: 130px;
    margin-left: 28px;
    margin-right: 14px;
  }
  .bars {
    gap: 2px;
  }
  .bars li:nth-child(even) .bar-day {
    visibility: hidden;
  }
  /* 柱子很多时（>16 天）数字每三根显示一个；少于这个数就全显示，别把关键数字藏掉 */
  .plot.dense .bars li .bar-n {
    visibility: hidden;
  }
  .plot.dense .bars li:nth-child(3n + 1) .bar-n {
    visibility: visible;
  }
  .bar-n {
    font-size: 0.46rem;
  }
}
.ranks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
}
.ranks li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
}
.rank-icon {
  color: var(--primary);
  flex-shrink: 0;
}
.rank-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-n {
  flex-shrink: 0;
  font-weight: 700;
  color: var(--text-light);
}
.foot {
  margin-top: 14px;
  font-size: 0.68rem;
}
.center {
  text-align: center;
  padding: 14px 0;
}
</style>
