<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Activity, Download, Flag, History, Upload } from 'lucide-vue-next'
import {
  clearAll,
  exportAllArchives,
  exportCurrentArchive,
  getStats,
  importBackup,
  isBackupFile,
  listRounds,
  summarizeBackup,
  type RoundRecord,
  type Stats,
} from '@/core/historyDb'
import { applyRemoteStatuses, listReports, type ReportEntry } from '@/core/reportStore'
import { syncPendingReports } from '@/core/reportSync'
import { getClientId } from '@/core/anonymousId'
import { listMyReports } from '@/core/reportsApi'
import {
  matchReportMedia,
  resolveMyReportStatus,
  type MyReportDisplay,
  type ReportMediaMatch,
} from '@/core/reportStatus'
import StatsCharts from '@/components/StatsCharts.vue'

const { t } = useI18n()
const stats = ref<Stats | null>(null)
const rounds = ref<RoundRecord[]>([])
const loading = ref(true)
const backupMsg = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
/** 由 ProfileView provide：导入可能新建档案，重载档案列表/活动档 */
const reloadProfile = inject<() => void | Promise<void>>('reloadProfile', () => {})

// ---- 064 我的报错：本地报错 + 远端处理状态 + 素材比对自动闭环 ----
const myReports = ref<ReportEntry[]>([])
const matches = ref<Record<string, ReportMediaMatch>>({})
const myReportsMsg = ref('')
/** 状态拉取节流：进入「我的」太频繁时不重复打接口 */
const STATUS_FETCH_THROTTLE_MS = 10 * 60_000
let lastStatusFetchAt = 0

function displayOf(r: ReportEntry): MyReportDisplay {
  return resolveMyReportStatus(r, matches.value[r.id])
}
/** 已处理/已调整的条目给出「看新素材」的物种链接 */
function isResolved(d: MyReportDisplay): boolean {
  return d === 'fixed' || d === 'resolved-media' || d === 'resolved-species'
}

function dateOf(at: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(at))
  } catch {
    return new Date(at).toLocaleDateString()
  }
}

async function refreshMyReports() {
  try {
    let list = await listReports()
    if (!list.length) {
      myReports.value = []
      return
    }
    // 先补传未上传的（复用 B6 补传），再拉远端状态（节流）
    try {
      await syncPendingReports()
    } catch {
      /* 离线：继续尝试拉状态 */
    }
    if (Date.now() - lastStatusFetchAt > STATUS_FETCH_THROTTLE_MS) {
      lastStatusFetchAt = Date.now()
      const rows = await listMyReports(getClientId())
      await applyRemoteStatuses(
        rows.map((r) => ({ id: r.id, status: r.status, updatedAt: r.updated_at })),
      )
    }
    list = await listReports()
    myReports.value = list
    // 素材比对：只对尚未被远端明确「已修正」的条目（fixed 优先，无需推断）
    const todo = list.filter((r) => r.remoteStatus !== 'fixed' && r.mediaUrl)
    const results = await Promise.all(
      todo.map((r) =>
        matchReportMedia(r.speciesId, r.questionType, r.mediaUrl).catch(
          (): ReportMediaMatch => ({ state: 'unknown' }),
        ),
      ),
    )
    const map: Record<string, ReportMediaMatch> = {}
    todo.forEach((r, i) => {
      const m = results[i]
      if (m) map[r.id] = m
    })
    matches.value = map
  } catch {
    myReportsMsg.value = t('profile.myReportsUnavailable')
  }
}

async function refresh() {
  loading.value = true
  const [s, r] = await Promise.all([getStats(), listRounds()])
  stats.value = s
  rounds.value = r
  loading.value = false
  void refreshMyReports()
}

onMounted(refresh)

async function reset() {
  if (!confirm(t('profile.resetConfirm'))) return
  await clearAll()
  await refresh()
}

function download(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 导出当前档案（013-A4：v2 档案级备份） */
async function exportJson() {
  backupMsg.value = ''
  const data = await exportCurrentArchive()
  const stamp = new Date().toISOString().slice(0, 10)
  download(data, `uniaoer-backup-${stamp}.json`)
  const s = summarizeBackup(data)
  backupMsg.value = t('profile.exportDone', {
    name: data.archive.name,
    rounds: s.rounds,
    wrong: s.wrong,
    badges: s.badges,
  })
}

/** 导出全部档案（013-A4：v2 scope=all） */
async function exportAllJson() {
  backupMsg.value = ''
  const data = await exportAllArchives()
  const stamp = new Date().toISOString().slice(0, 10)
  download(data, `uniaoer-backup-all-${stamp}.json`)
  const s = summarizeBackup(data)
  backupMsg.value = t('profile.exportAllDone', { archives: s.archives, rounds: s.rounds })
}

function pickFile() {
  backupMsg.value = ''
  fileInput.value?.click()
}

/** 导入（013-A4）：同档 id 合并，异档作为新档案加入当前用户；兼容 v1 */
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
    if (!confirm(t('profile.importConfirm', { ...summarizeBackup(parsed) }))) return
    const r = await importBackup(parsed, { newArchiveName: t('profile.importArchiveName') })
    backupMsg.value = t('profile.importDone', {
      created: r.archivesCreated,
      merged: r.archivesMerged,
      rounds: r.rounds,
      wrong: r.wrong,
      badges: r.badges,
    })
    await reloadProfile() // 新建档案可能改变档案列表
    await refresh()
  } catch {
    backupMsg.value = t('profile.importParseFailed')
  }
}
</script>

<template>
  <section class="card">
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
        <RouterLink class="btn btn-secondary" to="/profile/history">
          <History class="ic" :size="16" /> {{ t('profile.historyBtn') }}
        </RouterLink>
        <button class="btn btn-secondary" @click="exportJson">
          <Download class="ic" :size="16" /> {{ t('profile.exportData') }}
        </button>
        <button class="btn btn-secondary" @click="exportAllJson">
          <Download class="ic" :size="16" /> {{ t('profile.exportAllData') }}
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

  <!-- 064 我的报错：提交过的报错与处理进度（无报错时整卡不出现） -->
  <section v-if="myReports.length" class="card">
    <h3 class="block-title"><Flag class="ic" :size="17" /> {{ t('profile.myReportsTitle') }}</h3>
    <p class="muted my-reports-desc">{{ t('profile.myReportsDesc') }}</p>
    <p v-if="myReportsMsg" class="muted" role="status">{{ myReportsMsg }}</p>
    <ul class="rp-list">
      <li v-for="r in myReports" :key="r.id" class="rp-item">
        <div class="rp-line1">
          <RouterLink v-if="r.speciesId" class="rp-name" :to="`/species/${r.speciesId}`">
            {{ r.speciesName }}
          </RouterLink>
          <span v-else class="rp-name">{{ r.speciesName }}</span>
          <span class="rp-type">
            {{ r.questionType === 'audio' ? t('profile.reportTypeAudio') : t('profile.reportTypeImage') }}
          </span>
          <span class="rp-reason">{{ t(`report.reasons.${r.reason}`) }}</span>
          <span class="rp-status" :class="`s-${displayOf(r)}`">{{ t(`profile.rpStatus.${displayOf(r)}`) }}</span>
        </div>
        <p v-if="r.note" class="rp-note">{{ r.note }}</p>
        <div class="rp-line2">
          <span class="rp-date">{{ dateOf(r.at) }}</span>
          <RouterLink
            v-if="isResolved(displayOf(r)) && r.speciesId"
            class="rp-view"
            :to="`/species/${r.speciesId}`"
          >
            {{ t('profile.rpViewSpecies') }}
          </RouterLink>
        </div>
      </li>
    </ul>
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
/* ---- 064 我的报错 ---- */
.my-reports-desc {
  font-size: 0.78rem;
  margin-bottom: 10px;
}
.rp-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.rp-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  background: #fff;
}
.rp-line1 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.rp-name {
  font-weight: 700;
  font-size: 0.92rem;
  color: var(--text);
}
.rp-name:hover {
  color: var(--primary);
}
.rp-type {
  font-size: 0.7rem;
  padding: 1px 7px;
  border-radius: var(--radius-xs);
  background: #eef2f0;
  color: var(--text-light);
}
.rp-reason {
  font-size: 0.7rem;
  padding: 1px 7px;
  border-radius: var(--radius-xs);
  background: #fdf3d8;
  color: #8a6d00;
}
.rp-status {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: var(--radius-xs);
}
.rp-status.s-local {
  background: #eef2f0;
  color: var(--text-light);
}
.rp-status.s-open {
  background: #e8f0fb;
  color: #2b5ba8;
}
.rp-status.s-published {
  background: #fdf3d8;
  color: #8a6d00;
}
.rp-status.s-fixed,
.rp-status.s-resolved-media,
.rp-status.s-resolved-species {
  background: #eaf4ef;
  color: var(--primary);
}
.rp-status.s-rejected {
  background: #fdecee;
  color: var(--wrong);
}
.rp-note {
  margin-top: 5px;
  font-size: 0.8rem;
  color: var(--text);
}
.rp-line2 {
  margin-top: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rp-date {
  font-size: 0.72rem;
  color: var(--text-light);
}
.rp-view {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--primary);
}
</style>
