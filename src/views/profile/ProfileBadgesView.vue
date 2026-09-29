<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Award } from 'lucide-vue-next'
import { getBadges, type EarnedBadge } from '@/core/historyDb'
import { ALL_SPECIES_TOTAL, BADGES, type BadgeSeries } from '@/core/badges'
import BadgeIcon from '@/components/BadgeIcon.vue'

const { t } = useI18n()
const earned = ref<Set<string>>(new Set())
const loading = ref(true)

onMounted(async () => {
  const b = await getBadges()
  earned.value = new Set((b as EarnedBadge[]).map((x) => x.id))
  loading.value = false
})

const SERIES_ORDER: BadgeSeries[] = ['starter', 'advanced', 'master', 'hidden']
function badgesOf(series: BadgeSeries) {
  return BADGES.filter((b) => b.series === series)
}
function earnedCount(series: BadgeSeries) {
  return badgesOf(series).filter((b) => earned.value.has(b.id)).length
}
function totalCount(series: BadgeSeries) {
  return badgesOf(series).length
}
</script>

<template>
  <section class="card">
    <h3 class="block-title">
      <Award class="ic" :size="17" />
      {{ t('profile.badgesCount', { earned: earned.size, total: BADGES.length }) }}
    </h3>
    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <template v-else>
      <template v-for="series in SERIES_ORDER" :key="series">
        <h4 class="series-title">
          {{ t(`badges.series.${series}`) }}
          <span class="series-count">{{ earnedCount(series) }}/{{ totalCount(series) }}</span>
        </h4>
        <div class="badge-grid">
          <div
            v-for="b in badgesOf(series)"
            :key="b.id"
            class="badge"
            :class="{ locked: !earned.has(b.id) }"
          >
            <template v-if="b.hidden && !earned.has(b.id)">
              <BadgeIcon class="badge-icon" name="lock" :size="28" />
              <span class="label">???</span>
              <span class="desc">{{ t('profile.hiddenBadge') }}</span>
            </template>
            <template v-else>
              <BadgeIcon class="badge-icon" :name="b.icon" :size="28" />
              <span class="label">{{ t(b.labelKey, { n: ALL_SPECIES_TOTAL }) }}</span>
              <span class="desc">{{ t(b.descKey, { n: ALL_SPECIES_TOTAL }) }}</span>
            </template>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
  color: var(--primary);
  margin-bottom: 12px;
}
.block-title .ic {
  color: var(--primary);
}
/* ---- 徽章墙 ---- */
.series-title {
  margin: 16px 0 8px;
  font-size: 0.85rem;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.series-title:first-of-type {
  margin-top: 0;
}
.series-count {
  font-size: 0.7rem;
  color: var(--text-light);
  background: #eaf4ef;
  padding: 1px 8px;
  border-radius: 8px;
}
.badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  text-align: center;
  padding: 12px 8px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.badge .badge-icon {
  color: var(--primary);
}
.badge .label {
  font-size: 0.82rem;
  font-weight: 700;
}
.badge .desc {
  font-size: 0.68rem;
  color: var(--text-light);
}
.badge.locked {
  opacity: 0.45;
  filter: grayscale(0.7);
}
</style>
