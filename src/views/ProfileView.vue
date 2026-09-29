<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, Award, Download, History, Sparkles, Upload, User } from 'lucide-vue-next'
import {
  clearAll,
  exportAll,
  getBadges,
  getStats,
  importBackup,
  isBackupFile,
  listRounds,
  type EarnedBadge,
  type RoundRecord,
  type Stats,
} from '@/core/historyDb'
import { ALL_SPECIES_TOTAL, BADGES, type BadgeSeries } from '@/core/badges'
import { evaluateTitles, TITLE_TRACKS, type EarnedTitle, type TitleText } from '@/core/titles'
import { useSettingsStore } from '@/stores/settings'
import BadgeIcon from '@/components/BadgeIcon.vue'
import StatsCharts from '@/components/StatsCharts.vue'
import WrongBookView from './WrongBookView.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const stats = ref<Stats | null>(null)
const earned = ref<Set<string>>(new Set())
const loading = ref(true)
const backupMsg = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const rounds = ref<RoundRecord[]>([])
const pickerOpen = ref(false)
const badgePickerOpen = ref(false)

// 锚点导航（R31）：sticky 标签，点击滚动 / 滚动高亮
const SECTIONS = [
  { id: 'data', labelKey: 'profile.tabData' },
  { id: 'titles', labelKey: 'profile.tabTitles' },
  { id: 'badges', labelKey: 'profile.tabBadges' },
  { id: 'wrong', labelKey: 'profile.tabWrong' },
] as const
const activeSection = ref<string>('data')
let sectionObserver: IntersectionObserver | null = null

function setupSectionObserver() {
  sectionObserver?.disconnect()
  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) activeSection.value = e.target.id.replace('sec-', '')
      }
    },
    { rootMargin: '-20% 0px -65% 0px' },
  )
  for (const s of SECTIONS) {
    const el = document.getElementById(`sec-${s.id}`)
    if (el) sectionObserver.observe(el)
  }
}

function scrollToSection(id: string) {
  document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeSection.value = id
}

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
const earnedBadgeDefs = computed(() => BADGES.filter((b) => earned.value.has(b.id)))
function wearBadge(id: string | null) {
  settings.wornBadge = id
  badgePickerOpen.value = false
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

async function refresh() {
  loading.value = true
  const [s, b, r] = await Promise.all([getStats(), getBadges(), listRounds()])
  stats.value = s
  earned.value = new Set((b as EarnedBadge[]).map((x) => x.id))
  rounds.value = r
  loading.value = false
}

onMounted(async () => {
  await refresh()
  setupSectionObserver()
})
onUnmounted(() => sectionObserver?.disconnect())

// ---- 用户昵称（R33）：2–12 字符，存本地，用于「我的」页与海报 ----
const editingNickname = ref(false)
const nicknameDraft = ref('')
const nicknameMsg = ref('')

function startNickname() {
  nicknameDraft.value = settings.nickname
  nicknameMsg.value = ''
  editingNickname.value = true
}

function saveNickname() {
  const v = nicknameDraft.value.trim()
  if (!v) {
    nicknameMsg.value = t('profile.nicknameEmpty')
    return
  }
  if (v.length < 2) {
    nicknameMsg.value = t('profile.nicknameShort')
    return
  }
  settings.nickname = v
  editingNickname.value = false
}

async function reset() {
  if (!confirm(t('profile.resetConfirm'))) return
  await clearAll()
  await refresh()
}

/** E2 导出：下载 JSON 备份 */
async function exportJson() {
  backupMsg.value = ''
  const data = await exportAll()
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uniaoer-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  backupMsg.value = t('profile.exportDone', {
    rounds: data.rounds.length,
    wrong: data.wrong.length,
    badges: data.badges.length,
  })
}

function pickFile() {
  backupMsg.value = ''
  fileInput.value?.click()
}

/** E2 导入：按 id 合并（不覆盖现有），轮次/错题/徽章 */
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
  try {
    const parsed: unknown = JSON.parse(await file.text())
    if (!isBackupFile(parsed)) {
      backupMsg.value = t('profile.importInvalid')
      return
    }
    const ok = confirm(
      t('profile.importConfirm', {
        rounds: parsed.rounds.length,
        wrong: parsed.wrong.length,
        badges: parsed.badges.length,
      }),
    )
    if (!ok) return
    const r = await importBackup(parsed)
    backupMsg.value = t('profile.importDone', { rounds: r.rounds, wrong: r.wrong, badges: r.badges })
    await refresh()
  } catch {
    backupMsg.value = t('profile.importParseFailed')
  }
}
</script>

<template>
  <div class="profile-page">
    <!-- 锚点导航（R31）：sticky 固定顶部，点击快速滚动 -->
    <div class="section-tabs">
      <button
        v-for="s in SECTIONS"
        :key="s.id"
        :class="{ on: activeSection === s.id }"
        @click="scrollToSection(s.id)"
      >
        {{ t(s.labelKey) }}
      </button>
    </div>

    <!-- 数据 -->
    <section class="card" id="sec-data">
      <h2 class="sec"><User class="ic" :size="20" /> {{ t('nav.profile') }}</h2>
      <div class="nickname-row">
        <template v-if="editingNickname">
          <input
            v-model="nicknameDraft"
            class="nickname-input"
            maxlength="12"
            :placeholder="t('profile.nicknamePlaceholder')"
            @keyup.enter="saveNickname"
          />
          <button class="btn btn-primary btn-sm" @click="saveNickname">{{ t('common.save') }}</button>
          <button class="btn btn-secondary btn-sm" @click="editingNickname = false">
            {{ t('common.cancel') }}
          </button>
        </template>
        <template v-else>
          <span class="nickname-chip">
            <User class="ic" :size="13" />
            {{ settings.nickname || t('profile.noNickname') }}
          </span>
          <button class="btn btn-secondary btn-sm" @click="startNickname">
            {{ settings.nickname ? t('common.edit') : t('profile.setNickname') }}
          </button>
        </template>
        <span v-if="nicknameMsg" class="nickname-msg">{{ nicknameMsg }}</span>
      </div>
      <h3 class="block-title"><Activity class="ic" :size="17" /> {{ t('profile.tabData') }}</h3>
      <p v-if="loading" class="muted">{{ t('common.loading') }}</p>

      <template v-else-if="stats">
        <div class="stat-grid">
          <div class="stat"><span class="n">{{ stats.rounds }}</span><span class="l">{{ t('profile.statRounds') }}</span></div>
          <div class="stat"><span class="n">{{ stats.totalQuestions }}</span><span class="l">{{ t('profile.statQuestions') }}</span></div>
          <div class="stat"><span class="n">{{ stats.bestAccuracy }}%</span><span class="l">{{ t('profile.statBestAccuracy') }}</span></div>
          <div class="stat"><span class="n">{{ stats.perfectRounds }}</span><span class="l">{{ t('profile.statPerfectRounds') }}</span></div>
          <div class="stat"><span class="n">{{ stats.distinctSpecies }}</span><span class="l">{{ t('profile.statSpecies') }}</span></div>
          <div class="stat"><span class="n">{{ stats.bestStreak }}</span><span class="l">{{ t('profile.statBestStreak') }}</span></div>
        </div>

        <StatsCharts :rounds="rounds" />

        <div class="actions">
          <RouterLink class="btn btn-secondary" to="/history">
            <History class="ic" :size="16" /> {{ t('profile.historyBtn') }}
          </RouterLink>
          <button class="btn btn-secondary" @click="exportJson">
            <Download class="ic" :size="16" /> {{ t('profile.exportData') }}
          </button>
          <button class="btn btn-secondary" @click="pickFile">
            <Upload class="ic" :size="16" /> {{ t('profile.importData') }}
          </button>
          <button class="btn btn-secondary" @click="reset">{{ t('profile.clearData') }}</button>
        </div>
        <p v-if="backupMsg" class="backup-msg">{{ backupMsg }}</p>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden-input"
          @change="onFile"
        />
      </template>
    </section>

    <!-- 佩戴区（R32）：当前佩戴的称号与徽章，各自更换 -->
    <section class="card wear-card">
      <h3 class="block-title">{{ t('profile.wearTitle') }}</h3>
      <div class="wear-grid">
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

    <!-- 称号 -->
    <section class="card" id="sec-titles">
      <h3 class="block-title">
        <Sparkles class="ic" :size="17" />
        {{ t('profile.titlesCount', { earned: titleWall.filter((x) => x.earned).length, total: titleWall.length }) }}
      </h3>
      <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
      <div v-else class="badge-grid">
        <div v-for="x in titleWall" :key="x.id" class="badge" :class="{ locked: !x.earned }">
          <BadgeIcon class="badge-icon" :name="x.icon" :size="26" />
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
    </section>

    <!-- 徽章 -->
    <section class="card" id="sec-badges">
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

    <!-- 错题本 -->
    <div id="sec-wrong"><WrongBookView /></div>
  </div>
</template>

<style scoped>
/* ---- 锚点导航（R31）：sticky 固定顶部 ---- */
.profile-page {
  display: flex;
  flex-direction: column;
}
.section-tabs {
  position: sticky;
  /* 顶栏已全局吸顶（top 8px + 高≈48px，移动端两行≈84px），标签停靠其下 */
  top: 60px;
  z-index: 6;
  display: flex;
  gap: 8px;
  padding: 10px 4px;
  margin-bottom: 10px;
  overflow-x: auto;
  background: rgba(244, 251, 247, 0.95);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 0 0 14px 14px;
}
.section-tabs button {
  flex-shrink: 0;
  padding: 7px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  color: var(--text-light);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.section-tabs button.on {
  background: var(--grad);
  color: #fff;
  border-color: transparent;
}
#sec-data,
#sec-titles,
#sec-badges,
#sec-wrong {
  scroll-margin-top: 112px;
}
@media (max-width: 640px) {
  .section-tabs {
    top: 92px;
  }
  #sec-data,
  #sec-titles,
  #sec-badges,
  #sec-wrong {
    scroll-margin-top: 144px;
  }
}
h2.sec {
  font-size: 1.15rem;
  margin-bottom: 14px;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
  color: var(--primary);
  margin-bottom: 12px;
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
}
.wear-line .ic {
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
/* ---- 昵称（R33） ---- */
.nickname-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.nickname-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: 2px solid var(--primary-light);
  border-radius: 16px;
  background: #f3fbf7;
  color: var(--primary-dark);
  font-size: 0.9rem;
  font-weight: 700;
}
.nickname-chip .ic {
  color: var(--primary);
}
.nickname-input {
  width: 200px;
  padding: 8px 12px;
  border: 2px solid var(--primary-light);
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.9rem;
}
.nickname-msg {
  font-size: 0.78rem;
  color: var(--wrong);
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
  border-radius: 9px;
}
.wear-line {
  padding-right: 72px; /* 给右上角按钮让位 */
}
.wear-line .ic {
  width: 26px;
  height: 26px;
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
/* ---- 数据 ---- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
@media (max-width: 480px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.stat {
  background: #f3fbf7;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 10px;
  text-align: center;
}
.stat .n {
  display: block;
  font-size: 1.4rem;
  font-weight: 800;
  color: var(--primary);
}
.stat .l {
  font-size: 0.72rem;
  color: var(--text-light);
}
/* ---- 称号 / 徽章佩戴 ---- */
.title-card {
  margin-bottom: 6px;
  padding: 14px 16px;
  border: 2px solid var(--primary-light);
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #f3fbf7, #eaf4ef);
}
.title-worn {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title-worn-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.title-worn-text strong {
  font-size: 1.15rem;
  color: var(--primary-dark);
}
.title-worn .btn-sm {
  padding: 6px 14px;
  font-size: 0.78rem;
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
  border-radius: 10px;
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
.title-hint {
  margin-top: 10px;
  font-size: 0.72rem;
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
.badge .desc.next {
  color: var(--primary);
}
.badge .remain {
  margin-left: 4px;
  font-weight: 700;
}
/* 移动端：数字换到第三行 */
@media (max-width: 480px) {
  .badge .remain {
    display: block;
    margin-left: 0;
  }
}
.badge.locked {
  opacity: 0.45;
  filter: grayscale(0.7);
}
/* ---- 数据操作 ---- */
.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.backup-msg {
  margin-top: 10px;
  font-size: 0.82rem;
  color: var(--primary);
}
.hidden-input {
  display: none;
}
</style>
