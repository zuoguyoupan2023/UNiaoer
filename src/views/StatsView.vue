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
import { currentLocale } from '@/i18n'

const { t } = useI18n()

const stats = ref<PublicStats | null>(null)
const loading = ref(true)
const unavailable = ref(false)

onMounted(async () => {
  const s = await fetchPublicStats(30)
  stats.value = s
  unavailable.value = !s
  loading.value = false
})

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

/** 近 30 日"完成轮次"逐日条形（用相对高度画，不引入图表库） */
const roundBars = computed(() => dailySeries(stats.value, 'quiz_complete'))
const maxRound = computed(() => Math.max(1, ...roundBars.value.map((d) => d.n)))

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

      <!-- 近 30 日完成轮次 -->
      <h3 class="sec">{{ t('stats.sectionActivity') }}</h3>
      <p class="muted small">{{ t('stats.days', { n: stats?.days ?? 30 }) }}</p>
      <ol class="bars" :aria-label="t('stats.rounds')">
        <li v-for="d in roundBars" :key="d.day" :title="`${d.day} · ${d.n}`">
          <span class="bar" :style="{ height: `${Math.max(4, (d.n / maxRound) * 100)}%` }" />
          <span class="bar-day muted">{{ dayLabel(d.day) }}</span>
        </li>
      </ol>

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
.bars {
  list-style: none;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 96px;
  padding: 0;
  margin: 6px 0 2px;
}
.bars li {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
  min-width: 0;
}
.bar {
  width: 100%;
  background: var(--primary-light, var(--primary));
  border-radius: 2px 2px 0 0;
  opacity: 0.85;
}
.bar-day {
  font-size: 0.5rem;
  transform: rotate(-60deg);
  white-space: nowrap;
  margin-top: 2px;
  height: 14px;
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
