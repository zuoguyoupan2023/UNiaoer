<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Activity, Download, History, Upload } from 'lucide-vue-next'
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
import StatsCharts from '@/components/StatsCharts.vue'

const { t } = useI18n()
const stats = ref<Stats | null>(null)
const rounds = ref<RoundRecord[]>([])
const loading = ref(true)
const backupMsg = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
/** 由 ProfileView provide：导入可能新建档案，重载档案列表/活动档 */
const reloadProfile = inject<() => void | Promise<void>>('reloadProfile', () => {})

async function refresh() {
  loading.value = true
  const [s, r] = await Promise.all([getStats(), listRounds()])
  stats.value = s
  rounds.value = r
  loading.value = false
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
</style>
