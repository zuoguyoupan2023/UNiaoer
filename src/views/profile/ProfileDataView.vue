<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Activity, Download, History, Upload } from 'lucide-vue-next'
import {
  clearAll,
  exportAll,
  getStats,
  importBackup,
  isBackupFile,
  listRounds,
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
