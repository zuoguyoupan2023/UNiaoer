<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Activity, Award, Download, Sparkles, Upload, User } from 'lucide-vue-next'
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
import { BADGES, type BadgeSeries } from '@/core/badges'
import { evaluateTitles, type EarnedTitle } from '@/core/titles'
import { useSettingsStore } from '@/stores/settings'
import BadgeIcon from '@/components/BadgeIcon.vue'
import StatsCharts from '@/components/StatsCharts.vue'
import WrongBookView from './WrongBookView.vue'

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
  { id: 'data', label: '数据' },
  { id: 'titles', label: '称号' },
  { id: 'badges', label: '徽章' },
  { id: 'wrong', label: '错题本' },
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

// 称号（009）：由本地数据实时派生；佩戴位存 settings
const titles = computed<EarnedTitle[]>(() =>
  stats.value ? evaluateTitles(stats.value, rounds.value) : [],
)
const wornLabel = computed(
  () => titles.value.find((t) => t.trackId === settings.wornTitle)?.label ?? '',
)
/** 手动选择佩戴即转为手动模式（不再自动换新的，R31） */
function wearTitle(trackId: string | null) {
  settings.wornTitle = trackId
  settings.titleAutoWear = false
  pickerOpen.value = false
}

/** 佩戴徽章（R31） */
const wornBadgeLabel = computed(() => BADGES.find((b) => b.id === settings.wornBadge)?.label ?? '')
const earnedBadgeDefs = computed(() => BADGES.filter((b) => earned.value.has(b.id)))
function wearBadge(id: string | null) {
  settings.wornBadge = id
  settings.badgeAutoWear = false
  badgePickerOpen.value = false
}

const SERIES_ORDER: BadgeSeries[] = ['入门', '进阶', '大师', '隐藏']
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

async function reset() {
  if (!confirm('确定清空全部本地数据（记录 / 错题本 / 徽章）吗？此操作不可恢复。')) return
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
  backupMsg.value = `已导出 ${data.rounds.length} 轮记录、${data.wrong.length} 条错题、${data.badges.length} 枚徽章。`
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
      backupMsg.value = '导入失败：不是有效的 UNiaoer 备份文件。'
      return
    }
    const ok = confirm(
      `将合并导入 ${parsed.rounds.length} 轮记录、${parsed.wrong.length} 条错题、${parsed.badges.length} 枚徽章（相同记录以现有/更全的为准，不会删除现有数据）。继续吗？`,
    )
    if (!ok) return
    const r = await importBackup(parsed)
    backupMsg.value = `导入完成：新增/更新 ${r.rounds} 轮、${r.wrong} 条错题、${r.badges} 枚徽章。`
    await refresh()
  } catch {
    backupMsg.value = '导入失败：文件无法解析。'
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
        {{ s.label }}
      </button>
    </div>

    <!-- 数据 -->
    <section class="card" id="sec-data">
      <h2 class="sec"><User class="ic" :size="20" /> 我的</h2>
      <h3 class="block-title"><Activity class="ic" :size="17" /> 数据</h3>
      <p v-if="loading" class="muted">加载中…</p>

      <template v-else-if="stats">
        <div class="stat-grid">
          <div class="stat"><span class="n">{{ stats.rounds }}</span><span class="l">轮次</span></div>
          <div class="stat"><span class="n">{{ stats.totalQuestions }}</span><span class="l">累计题数</span></div>
          <div class="stat"><span class="n">{{ stats.bestAccuracy }}%</span><span class="l">最佳正确率</span></div>
          <div class="stat"><span class="n">{{ stats.perfectRounds }}</span><span class="l">满分轮次</span></div>
          <div class="stat"><span class="n">{{ stats.distinctSpecies }}</span><span class="l">认识物种</span></div>
          <div class="stat"><span class="n">{{ stats.bestStreak }}</span><span class="l">最长连对</span></div>
        </div>

        <StatsCharts :rounds="rounds" />

        <div class="actions">
          <button class="btn btn-secondary" @click="exportJson">
            <Download class="ic" :size="16" /> 导出数据
          </button>
          <button class="btn btn-secondary" @click="pickFile">
            <Upload class="ic" :size="16" /> 导入数据
          </button>
          <button class="btn btn-secondary" @click="reset">清空我的数据</button>
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

    <!-- 称号 -->
    <section class="card" id="sec-titles">
      <h3 class="block-title"><Sparkles class="ic" :size="17" /> 称号</h3>
      <p v-if="loading" class="muted">加载中…</p>
      <template v-else>
        <div class="title-card">
          <div class="title-worn">
            <div class="title-worn-text">
              <span class="muted">佩戴中</span>
              <strong>{{ wornLabel || '未佩戴' }}</strong>
            </div>
            <button class="btn btn-secondary btn-sm" @click="pickerOpen = !pickerOpen">
              {{ pickerOpen ? '收起' : '更换' }}
            </button>
          </div>
          <div v-if="pickerOpen" class="title-options">
            <button
              class="title-opt"
              :class="{ on: settings.wornTitle === null }"
              @click="wearTitle(null)"
            >
              不佩戴
            </button>
            <button
              v-for="t in titles"
              :key="t.trackId"
              class="title-opt"
              :class="{ on: settings.wornTitle === t.trackId }"
              @click="wearTitle(t.trackId)"
            >
              <strong>{{ t.label }}</strong>
              <span class="muted">{{ t.trackName }} · Lv.{{ t.level }}</span>
            </button>
          </div>
          <label class="auto-wear">
            <input v-model="settings.titleAutoWear" type="checkbox" />
            新解锁称号自动佩戴
          </label>
          <p class="muted title-hint">
            轨道：题量 · 物种图谱 · 连对 · 满分轮 · 听音 · 地狱 · 水平段位 · 物种之友
          </p>
        </div>
      </template>
    </section>

    <!-- 徽章 -->
    <section class="card" id="sec-badges">
      <h3 class="block-title"><Award class="ic" :size="17" /> 徽章（{{ earned.size }} / {{ BADGES.length }}）</h3>
      <p v-if="loading" class="muted">加载中…</p>
      <template v-else>
        <div class="title-card">
          <div class="title-worn">
            <div class="title-worn-text">
              <span class="muted">佩戴中</span>
              <strong>{{ wornBadgeLabel || '未佩戴' }}</strong>
            </div>
            <button class="btn btn-secondary btn-sm" @click="badgePickerOpen = !badgePickerOpen">
              {{ badgePickerOpen ? '收起' : '更换' }}
            </button>
          </div>
          <div v-if="badgePickerOpen" class="title-options">
            <button
              class="title-opt"
              :class="{ on: settings.wornBadge === null }"
              @click="wearBadge(null)"
            >
              不佩戴
            </button>
            <button
              v-for="b in earnedBadgeDefs"
              :key="b.id"
              class="title-opt"
              :class="{ on: settings.wornBadge === b.id }"
              @click="wearBadge(b.id)"
            >
              <strong>{{ b.label }}</strong>
              <span class="muted">{{ b.series }}</span>
            </button>
          </div>
          <label class="auto-wear">
            <input v-model="settings.badgeAutoWear" type="checkbox" />
            新解锁徽章自动佩戴
          </label>
        </div>

        <template v-for="series in SERIES_ORDER" :key="series">
          <h4 class="series-title">
            {{ series }}
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
                <span class="desc">隐藏徽章 · 继续探索</span>
              </template>
              <template v-else>
                <BadgeIcon class="badge-icon" :name="b.icon" :size="28" />
                <span class="label">{{ b.label }}</span>
                <span class="desc">{{ b.desc }}</span>
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
  top: 0;
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
  scroll-margin-top: 58px;
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
  font-size: 1.02rem;
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
.auto-wear {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 0.78rem;
  color: var(--text-light);
  cursor: pointer;
}
.auto-wear input {
  accent-color: var(--primary);
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
