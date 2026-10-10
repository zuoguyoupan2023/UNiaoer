<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Award, Sparkles } from 'lucide-vue-next'
import {
  getBadges,
  getStats,
  listRounds,
  type EarnedBadge,
  type RoundRecord,
  type Stats,
} from '@/core/historyDb'
import { ALL_SPECIES_TOTAL, BADGES } from '@/core/badges'
import { evaluateTitles, TITLE_TRACKS, type EarnedTitle, type TitleText } from '@/core/titles'
import { useSettingsStore } from '@/stores/settings'
import BadgeIcon from '@/components/BadgeIcon.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const stats = ref<Stats | null>(null)
const rounds = ref<RoundRecord[]>([])
const earned = ref<Set<string>>(new Set())
const loading = ref(true)
const pickerOpen = ref(false)
const badgePickerOpen = ref(false)

onMounted(async () => {
  const [s, r, b] = await Promise.all([getStats(), listRounds(), getBadges()])
  stats.value = s
  rounds.value = r
  earned.value = new Set((b as EarnedBadge[]).map((x) => x.id))
  loading.value = false
})

/** 称号文本 → 字符串（chips/选择器用） */
const textOf = (x: TitleText) => t(x.key, x.params ?? {})

// 称号（009）：由本地数据实时派生；佩戴位存 settings
const titles = computed<EarnedTitle[]>(() =>
  stats.value ? evaluateTitles(stats.value, rounds.value) : [],
)
const wornLabel = computed(() => {
  const cur = titles.value.find((x) => x.trackId === settings.wornTitle)
  return cur ? textOf(cur.text) : ''
})
/** 手动更换佩戴（R32 固定规则：仅首枚自动佩戴，之后手动） */
function wearTitle(trackId: string | null) {
  settings.wornTitle = trackId
  pickerOpen.value = false
}

/** 佩戴徽章（R31） */
const wornBadgeLabel = computed(() => {
  const def = BADGES.find((b) => b.id === settings.wornBadge)
  return def ? t(def.labelKey, { n: ALL_SPECIES_TOTAL }) : ''
})
const earnedBadgeDefs = computed(() => BADGES.filter((b) => earned.value.has(b.id)))
function wearBadge(id: string | null) {
  settings.wornBadge = id
  badgePickerOpen.value = false
}

/**
 * 称号墙（R32/R39）：全部轨道完整展示。
 * - 已达成：显示当前称号 + 轨道/Lv + 下一级进度；
 * - 未达成：仅灰色展示轨道名，不显示进度信息。
 */
const titleWall = computed(() => {
  const s = stats.value ?? makeEmptyStats()
  const byId = new Map(evaluateTitles(s, rounds.value).map((x) => [x.trackId, x]))
  return TITLE_TRACKS.map((track) => {
    const value = track.metric(s, rounds.value)
    const next = track.levels.find((l) => l.threshold > value) ?? null
    const got = byId.get(track.id)
    return {
      id: track.id,
      nameKey: track.nameKey,
      icon: track.icon,
      earned: !!got,
      text: got?.text ?? { key: track.nameKey },
      level: got?.level ?? 0,
      /** 距离下一级还差多少；null = 已满级 */
      remaining: next ? Math.max(1, Math.ceil(next.threshold - value)) : null,
    }
  })
})

function makeEmptyStats() {
  return {
    rounds: 0, totalQuestions: 0, totalCorrect: 0, bestAccuracy: 0, perfectRounds: 0,
    distinctSpecies: 0, audioRounds: 0, maxTier: 0, bestStreak: 0, wrongCount: 0,
    hellRounds: 0, hellQuestions: 0, hellCorrect: 0, hellPerfectRounds: 0, audioCorrect: 0,
    wrongPracticeRounds: 0, wrongPracticeCorrect: 0, imagePerfectRounds: 0, audioPerfectRounds: 0,
    maxCrossStreak: 0, distinctCorrect: 0, nightRound: false, dawnRound: false,
    escapedQuitPerfect: false,
  }
}
</script>

<template>
  <!-- 佩戴区（R32）：当前佩戴的称号与徽章，各自更换 -->
  <section class="card wear-card">
    <h3 class="block-title">{{ t('profile.wearTitle') }}</h3>
    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <div v-else class="wear-grid">
      <div class="wear-item">
        <button class="btn btn-secondary wear-change" @click="pickerOpen = !pickerOpen">
          {{ pickerOpen ? t('common.collapse') : t('profile.change') }}
        </button>
        <div class="wear-line">
          <Sparkles class="ic" :size="26" />
          <div class="wear-text">
            <span class="muted">{{ t('profile.titleLabel') }}</span>
            <strong>{{ wornLabel || t('profile.notWorn') }}</strong>
          </div>
        </div>
        <div v-if="pickerOpen" class="title-options">
          <button
            class="title-opt"
            :class="{ on: settings.wornTitle === null }"
            @click="wearTitle(null)"
          >
            {{ t('profile.wearNone') }}
          </button>
          <button
            v-for="x in titles"
            :key="x.trackId"
            class="title-opt"
            :class="{ on: settings.wornTitle === x.trackId }"
            @click="wearTitle(x.trackId)"
          >
            <strong>{{ textOf(x.text) }}</strong>
            <span class="muted">{{ t(x.trackNameKey) }} · Lv.{{ x.level }}</span>
          </button>
        </div>
      </div>
      <div class="wear-item">
        <button class="btn btn-secondary wear-change" @click="badgePickerOpen = !badgePickerOpen">
          {{ badgePickerOpen ? t('common.collapse') : t('profile.change') }}
        </button>
        <div class="wear-line">
          <Award class="ic" :size="26" />
          <div class="wear-text">
            <span class="muted">{{ t('profile.badgeLabel') }}</span>
            <strong>{{ wornBadgeLabel || t('profile.notWorn') }}</strong>
          </div>
        </div>
        <div v-if="badgePickerOpen" class="title-options">
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
    </div>
  </section>

  <!-- 称号墙 -->
  <section class="card">
    <h3 class="block-title">
      <Sparkles class="ic" :size="17" />
      {{ t('profile.titlesCount', { earned: titleWall.filter((x) => x.earned).length, total: titleWall.length }) }}
    </h3>
    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <div v-else class="badge-grid">
      <div v-for="x in titleWall" :key="x.id" class="badge" :class="{ locked: !x.earned }">
        <BadgeIcon class="badge-icon" :name="x.icon" :size="26" />
        <div class="badge-text">
          <span class="label">
            {{ textOf(x.text) }}<template v-if="x.earned"> {{ t('profile.levelTag', { n: x.level }) }}</template>
          </span>
          <span v-if="x.earned" class="desc next">
            <template v-if="x.remaining !== null">
              {{ t('profile.nextLevelLeft') }}<b class="remain">{{ x.remaining }}</b>
            </template>
            <template v-else>{{ t('profile.maxed') }}</template>
          </span>
        </div>
      </div>
    </div>
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
.wear-card {
  margin-bottom: 14px;
}
/* ---- 佩戴区（R32） ---- */
.wear-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 520px) {
  .wear-grid {
    grid-template-columns: 1fr;
  }
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
/* ---- 称号 / 徽章佩戴选择 ---- */
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
/* ---- 称号墙：图标左、文字右（移动端一行一个不浪费纵向空间） ---- */
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
.badge .desc.next {
  color: var(--primary);
}
.badge .remain {
  margin-left: 4px;
  font-weight: 700;
}
.badge.locked {
  opacity: 0.45;
  filter: grayscale(0.7);
}
</style>
