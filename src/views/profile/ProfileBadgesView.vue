<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Award } from 'lucide-vue-next'
import { getBadges, type EarnedBadge } from '@/core/historyDb'
import { ALL_SPECIES_TOTAL, BADGES, type BadgeSeries } from '@/core/badges'
import { useSettingsStore } from '@/stores/settings'
import BadgeIcon from '@/components/BadgeIcon.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const earned = ref<Set<string>>(new Set())
const loading = ref(true)
const pickerOpen = ref(false)

onMounted(async () => {
  const b = await getBadges()
  earned.value = new Set((b as EarnedBadge[]).map((x) => x.id))
  loading.value = false
})

/** 佩戴徽章（R31）：佩戴/更换只在本页，与称号页分开 */
const wornBadgeLabel = computed(() => {
  const def = BADGES.find((b) => b.id === settings.wornBadge)
  return def ? t(def.labelKey, { n: ALL_SPECIES_TOTAL }) : ''
})
const earnedBadgeDefs = computed(() => BADGES.filter((b) => earned.value.has(b.id)))
function wearBadge(id: string | null) {
  settings.wornBadge = id
  pickerOpen.value = false
}

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
  <!-- 佩戴区（R31）：当前佩戴的徽章；称号佩戴在「称号」页 -->
  <section class="card wear-card">
    <h3 class="block-title">{{ t('profile.wearTitle') }}</h3>
    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <div v-else class="wear-item">
      <button class="btn btn-secondary wear-change" @click="pickerOpen = !pickerOpen">
        {{ pickerOpen ? t('common.collapse') : t('profile.change') }}
      </button>
      <div class="wear-line">
        <Award class="ic" :size="26" />
        <div class="wear-text">
          <span class="muted">{{ t('profile.badgeLabel') }}</span>
          <strong>{{ wornBadgeLabel || t('profile.notWorn') }}</strong>
        </div>
      </div>
      <div v-if="pickerOpen" class="title-options">
        <button
          class="title-opt"
          :class="{ on: settings.wornBadge === null }"
          @click="wearBadge(null)"
        >
          {{ t('profile.wearNone') }}
        </button>
        <button
          v-for="b in earnedBadgeDefs"
          :key="b.id"
          class="title-opt"
          :class="{ on: settings.wornBadge === b.id }"
          @click="wearBadge(b.id)"
        >
          <strong>{{ t(b.labelKey, { n: ALL_SPECIES_TOTAL }) }}</strong>
          <span class="muted">{{ t(`badges.series.${b.series}`) }}</span>
        </button>
      </div>
    </div>
  </section>

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
              <div class="badge-text">
                <span class="label">???</span>
                <span class="desc">{{ t('profile.hiddenBadge') }}</span>
              </div>
            </template>
            <template v-else>
              <BadgeIcon class="badge-icon" :name="b.icon" :size="28" />
              <div class="badge-text">
                <span class="label">{{ t(b.labelKey, { n: ALL_SPECIES_TOTAL }) }}</span>
                <span class="desc">{{ t(b.descKey, { n: ALL_SPECIES_TOTAL }) }}</span>
              </div>
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
/* ---- 佩戴区（与称号页同款） ---- */
.wear-card {
  margin-bottom: 14px;
}
.wear-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-right: 72px; /* 给右上角按钮让位 */
}
.wear-line .ic {
  width: 26px;
  height: 26px;
  color: var(--primary);
}
.wear-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.wear-text strong {
  font-size: 1.18rem;
  color: var(--primary-dark);
}
.wear-item {
  position: relative;
}
/* R35：更换按钮固定在佩戴区右上角 */
.wear-change {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 4px 12px;
  font-size: 0.72rem;
  border-radius: var(--radius-sm);
}
@media (max-width: 640px) {
  .wear-line {
    padding-right: 64px;
  }
  .wear-line .ic {
    width: 21px;
    height: 21px;
  }
}
.title-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.title-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 9px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.18s ease;
}
.title-opt:hover {
  border-color: var(--primary-light);
}
.title-opt.on {
  border-color: var(--primary);
  background: #f3fbf7;
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
  border-radius: var(--radius-xs);
}
.badge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}
.badge {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 10px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.badge .badge-icon {
  flex-shrink: 0;
  color: var(--primary);
}
.badge-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
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
