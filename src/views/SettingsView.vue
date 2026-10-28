<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Languages, Settings } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import type { AutoNextDelaySec } from '@/types'
import { ambiencePlayer, loadBirdTracks, type AmbienceTrack } from '@/core/ambience'
import {
  applyRemoteStatuses,
  clearReports,
  countReports,
  importReports,
  listReports,
  pendingReportCount,
} from '@/core/reportStore'
import { syncPendingReports } from '@/core/reportSync'
import { getClientId } from '@/core/anonymousId'
import { createReportClaim, listMyReports } from '@/core/reportsApi'
import { exportAllArchives, importBackup, isBackupFile, summarizeBackup } from '@/core/historyDb'
import {
  fullBackupFilename,
  isFullBackup,
  isReportsBackup,
  sanitizeImportedReport,
  type FullBackup,
} from '@/core/reportExport'
import { pendingShareCount } from '@/core/shareQueue'
import { syncPendingShares } from '@/core/shareSync'
import type { AutoNextMode } from '@/types'

const { t } = useI18n()
const settings = useSettingsStore()
const cacheMsg = ref('')
const reportCount = ref(0)
const pendingCount = ref(0)
const reportsMsg = ref('')
const syncing = ref(false)
/** 064 清空前的导出提醒（二次确认面板） */
const clearWarn = ref(false)
const reportsImportInput = ref<HTMLInputElement | null>(null)
/** 035 离线补传（2026-10-09） */
const shareQueueCount = ref(0)
const shareSyncing = ref(false)
const shareMsg = ref('')

// 环境鸟鸣音轨目录（懒加载，默认全部勾选）
const tracks = ref<AmbienceTrack[] | null>(null)
const tracksError = ref(false)

onMounted(async () => {
  try {
    tracks.value = await loadBirdTracks()
  } catch {
    tracksError.value = true
  }
  await refreshReportCounts()
})

async function refreshReportCounts() {
  try {
    reportCount.value = await countReports()
    pendingCount.value = await pendingReportCount()
  } catch {
    /* IndexedDB 不可用：保持 0 */
  }
  try {
    shareQueueCount.value = pendingShareCount()
  } catch {
    shareQueueCount.value = 0
  }
}

/** 035 离线补传：逐条补传待传分享（成功即出队并写入令牌台账，可撤回） */
async function syncShares() {
  if (shareSyncing.value) return
  shareSyncing.value = true
  shareMsg.value = ''
  try {
    const r = await syncPendingShares()
    shareMsg.value = r.synced
      ? t('share.retryDone', { n: r.synced })
      : r.failed
        ? t('share.retryFailed')
        : ''
  } catch {
    shareMsg.value = t('errors.unknown')
  } finally {
    shareSyncing.value = false
    await refreshReportCounts()
  }
}

/** G1：清空本地报错记录（064：先经导出提醒面板确认） */
async function clearLocalReports() {
  try {
    await clearReports()
    reportsMsg.value = t('settings.reportsCleared')
    clearWarn.value = false
    await refreshReportCounts()
  } catch {
    reportsMsg.value = t('errors.unknown')
  }
}

/**
 * 064 导出个人数据备份（2026-10-29 用户定：**全部个人数据**）：
 * 档案全量（v2：轮次/错题/徽章/昵称）+ 全部报错 + 归户验证码。
 * 验证码由服务端签发（只存哈希，明文仅在此文件里）；离线/签发失败降级为
 * 无验证码导出（本地恢复不受影响，只是未来无法归入账号）。
 */
async function exportLocalReports() {
  reportsMsg.value = ''
  try {
    const [archives, reports] = await Promise.all([exportAllArchives(), listReports()])
    let claimToken: string | undefined
    try {
      claimToken = await createReportClaim(getClientId())
    } catch {
      /* 离线/限流：无验证码导出 */
    }
    const backup: FullBackup = {
      app: 'uniaoer',
      kind: 'full-backup',
      version: 1,
      exportedAt: Date.now(),
      claimToken,
      archives,
      reports,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fullBackupFilename()
    a.click()
    URL.revokeObjectURL(url)
    reportsMsg.value = claimToken
      ? t('settings.reportsExported', { n: reports.length })
      : t('settings.reportsExportedNoClaim', { n: reports.length })
  } catch {
    reportsMsg.value = t('errors.unknown')
  }
}

function pickReportsFile() {
  reportsMsg.value = ''
  reportsImportInput.value?.click()
}

/**
 * 064 导入个人数据备份：本地文件直接恢复（无需联网）。
 * 接受三类文件：全量备份（档案+报错）/ 纯档案备份 / 纯报错备份（兼容期）。
 * 报错状态稍后进入「我的」时自动对齐。
 */
async function onReportsFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
  try {
    const parsed: unknown = JSON.parse(await file.text())
    // 纯档案备份 → 走档案导入
    if (!isFullBackup(parsed) && !isReportsBackup(parsed) && isBackupFile(parsed)) {
      const s = summarizeBackup(parsed)
      if (!confirm(t('profile.importConfirm', { ...s }))) return
      const r = await importBackup(parsed, { newArchiveName: t('profile.importArchiveName') })
      reportsMsg.value = t('settings.reportsImportDone', {
        imported: 0,
        skipped: 0,
        created: r.archivesCreated,
        merged: r.archivesMerged,
      })
      await refreshReportCounts()
      return
    }
    if (isFullBackup(parsed) || isReportsBackup(parsed)) {
      // 报错：白名单清洗 + 去重导入
      const clean = parsed.reports.map(sanitizeImportedReport).filter((r) => r !== null)
      const r = await importReports(clean)
      // 档案（仅全量备份有；内容为空时跳过，避免弹无意义的确认框）
      let created = 0
      let merged = 0
      if (isFullBackup(parsed) && parsed.archives) {
        const s = summarizeBackup(parsed.archives)
        if (s.rounds + s.wrong + s.badges > 0 && confirm(t('profile.importConfirm', { ...s }))) {
          const ar = await importBackup(parsed.archives, {
            newArchiveName: t('profile.importArchiveName'),
          })
          created = ar.archivesCreated
          merged = ar.archivesMerged
        }
      }
      reportsMsg.value = t('settings.reportsImportDone', {
        imported: r.imported,
        skipped: r.skipped,
        created,
        merged,
      })
      await refreshReportCounts()
      void refreshRemoteStatusesQuietly()
      return
    }
    reportsMsg.value = t('settings.reportsImportInvalid')
  } catch {
    reportsMsg.value = t('settings.reportsImportInvalid')
  }
}

/** 064：导入后顺手拉一次状态（可失败——只是让新导入的条目尽快带上远端状态） */
async function refreshRemoteStatusesQuietly() {
  try {
    const rows = await listMyReports(getClientId())
    await applyRemoteStatuses(rows.map((r) => ({ id: r.id, status: r.status, updatedAt: r.updated_at })))
  } catch {
    /* 静默：进入「我的」时会再拉 */
  }
}

/** B6：把未上传的本地报错补传到后端 */
async function syncReports() {
  if (syncing.value) return
  syncing.value = true
  reportsMsg.value = ''
  try {
    const r = await syncPendingReports()
    reportsMsg.value = t('settings.reportsSynced', { n: r.synced, failed: r.failed })
  } catch {
    reportsMsg.value = t('errors.unknown')
  } finally {
    syncing.value = false
    await refreshReportCounts()
  }
}

function isTrackChecked(id: string): boolean {
  return !settings.ambienceExcluded.includes(id)
}

/** 环境鸟鸣总开关（R36）：开 = 立即播放；关 = 停止并记住（不再自动播放） */
function toggleAmbienceEnabled(e: Event) {
  const on = (e.target as HTMLInputElement).checked
  settings.ambienceEnabled = on
  if (on) void ambiencePlayer.start().catch(() => {})
  else ambiencePlayer.stop()
}

function toggleTrack(id: string, checked: boolean) {
  settings.ambienceExcluded = checked
    ? settings.ambienceExcluded.filter((x) => x !== id)
    : [...settings.ambienceExcluded, id]
  ambiencePlayer.syncExclusions() // 正在播放的音轨被取消勾选时自动切下一首
}

async function clearMediaCache() {
  if (!('caches' in window)) {
    cacheMsg.value = t('settings.cacheUnsupported')
    return
  }
  const keys = await caches.keys()
  const targets = keys.filter((k) => k.startsWith('uniaoer-'))
  await Promise.all(targets.map((k) => caches.delete(k)))
  cacheMsg.value = targets.length ? t('settings.cacheCleared', { n: targets.length }) : t('settings.cacheNone')
}

/** 音轨名主/副位随 locale 切换（015 #3） */
const isEn = computed(() => settings.locale === 'en')

/** 072-h：答对后等待档位（0 秒已取消：看不到对错反馈，逻辑不统一） */
const delayOptions: { value: AutoNextDelaySec; labelKey: string }[] = [
  { value: 0.5, labelKey: 'settings.autoNextDelay.fast' },
  { value: 1, labelKey: 'settings.autoNextDelay.s1' },
  { value: 2, labelKey: 'settings.autoNextDelay.s2' },
  { value: 3, labelKey: 'settings.autoNextDelay.s3' },
]

const autoNextOptions: { value: AutoNextMode; labelKey: string; hintKey: string }[] = [
  { value: 'correct', labelKey: 'settings.autoNext.correct.label', hintKey: 'settings.autoNext.correct.hint' },
  { value: 'all', labelKey: 'settings.autoNext.all.label', hintKey: 'settings.autoNext.all.hint' },
  { value: 'manual', labelKey: 'settings.autoNext.manual.label', hintKey: 'settings.autoNext.manual.hint' },
]
</script>

<template>
  <section class="card">
    <h2 class="sec"><Settings class="ic" :size="20" /> {{ t('settings.title') }}</h2>

    <div class="setting">
      <h3><Languages class="ic lang-ic" :size="17" /> {{ t('settings.languageTitle') }}</h3>
      <div class="lang-choices" role="group" :aria-label="t('settings.languageTitle')">
        <button
          class="choice"
          :class="{ on: settings.locale === 'zh-CN' }"
          :aria-pressed="settings.locale === 'zh-CN'"
          @click="settings.locale = 'zh-CN'"
        >
          <strong>中文</strong>
          <span>简体中文</span>
        </button>
        <button
          class="choice"
          :class="{ on: settings.locale === 'en' }"
          :aria-pressed="settings.locale === 'en'"
          @click="settings.locale = 'en'"
        >
          <strong>English</strong>
          <span>English (US)</span>
        </button>
      </div>
    </div>

    <div class="setting">
      <h3>{{ t('settings.autoplayTitle') }}</h3>
      <label class="switch">
        <input v-model="settings.autoplayAudio" type="checkbox" />
        <span>{{ t('settings.autoplaySwitch') }}</span>
      </label>

      <label class="delay">
        {{ t('settings.delay') }}
        <input
          v-model.number="settings.autoplayDelayMs"
          type="number"
          min="1000"
          max="3000"
          step="500"
        />
        ms
      </label>
    </div>

    <p class="muted" style="margin-top: 8px">{{ t('settings.autoplayNote') }}</p>

    <div class="setting">
      <h3>{{ t('settings.autoNextTitle') }}</h3>
      <p class="muted">{{ t('settings.autoNextDesc') }}</p>
      <div class="choices" role="group" :aria-label="t('settings.autoNextTitle')">
        <button
          v-for="o in autoNextOptions"
          :key="o.value"
          class="choice"
          :class="{ on: settings.autoNext === o.value }"
          :aria-pressed="settings.autoNext === o.value"
          @click="settings.autoNext = o.value"
        >
          <strong>{{ t(o.labelKey) }}</strong>
          <span>{{ t(o.hintKey) }}</span>
        </button>
      </div>
      <!-- 072-h：答对后的等待时长（自动模式才有意义；手动模式隐藏） -->
      <template v-if="settings.autoNext !== 'manual'">
        <p class="muted" style="margin-top: 12px">{{ t('settings.autoNextDelayDesc') }}</p>
        <div class="choices" role="group" :aria-label="t('settings.autoNextDelayDesc')">
          <button
            v-for="o in delayOptions"
            :key="o.value"
            class="choice"
            :class="{ on: settings.autoNextDelaySec === o.value }"
            :aria-pressed="settings.autoNextDelaySec === o.value"
            @click="settings.autoNextDelaySec = o.value"
          >
            <strong>{{ t(o.labelKey) }}</strong>
          </button>
        </div>
      </template>
    </div>

    <div class="setting">
      <h3>{{ t('settings.adaptiveTitle') }}</h3>
      <label class="switch">
        <input v-model="settings.adaptiveTier" type="checkbox" />
        <span>{{ t('settings.adaptiveSwitch') }}</span>
      </label>
      <p class="muted" style="margin-top: 8px">{{ t('settings.adaptiveHint') }}</p>
    </div>

    <div class="setting">
      <h3>{{ t('settings.ambienceTitle') }}</h3>
      <label class="switch">
        <input
          type="checkbox"
          :checked="settings.ambienceEnabled"
          @change="toggleAmbienceEnabled"
        />
        <span>{{ t('settings.ambienceSwitch') }}</span>
      </label>
      <p class="muted" style="margin-top: 8px">{{ t('settings.ambienceHint') }}</p>
      <p v-if="tracksError" class="muted">{{ t('settings.tracksError') }}</p>
      <p v-else-if="!tracks" class="muted">{{ t('settings.tracksLoading') }}</p>
      <div v-else class="track-list">
        <label v-for="tr in tracks" :key="tr.id" class="track">
          <input
            type="checkbox"
            :checked="isTrackChecked(tr.id)"
            @change="toggleTrack(tr.id, ($event.target as HTMLInputElement).checked)"
          />
          <!-- 音轨名随 locale 切换（015 #3）：主位显示当前语言，副位灰色显示另一语言 -->
          <span :class="isEn ? 'alt' : 'main'">{{ tr.labelZh }}</span>
          <span :class="isEn ? 'main' : 'alt'">{{ tr.labelEn }}</span>
        </label>
      </div>
    </div>

    <div class="setting">
      <h3>{{ t('settings.cacheTitle') }}</h3>
      <p class="muted">{{ t('settings.cacheDesc') }}</p>
      <button class="btn btn-secondary" style="margin-top: 10px" @click="clearMediaCache">
        {{ t('settings.clearCache') }}
      </button>
      <p v-if="cacheMsg" class="muted" role="status" style="margin-top: 8px">{{ cacheMsg }}</p>
    </div>

    <div class="setting">
      <h3>{{ t('settings.metricsTitle') }}</h3>
      <p class="muted">{{ t('settings.metricsDesc') }}</p>
      <!-- 076：公开说明「收集什么 / 为什么 / 不收集什么」（昵称浮窗只留一句） -->
      <ul class="metrics-list">
        <li>
          <strong>{{ t('settings.metricsWhatTitle') }}</strong>
          <span class="muted">{{ t('settings.metricsWhat') }}</span>
        </li>
        <li>
          <strong>{{ t('settings.metricsWhyTitle') }}</strong>
          <span class="muted">{{ t('settings.metricsWhy') }}</span>
        </li>
        <li>
          <strong>{{ t('settings.metricsNotTitle') }}</strong>
          <span class="muted">{{ t('settings.metricsNot') }}</span>
        </li>
      </ul>
      <label class="switch">
        <input v-model="settings.metricsEnabled" type="checkbox" />
        <span>{{ t('settings.metricsSwitch') }}</span>
      </label>
      <!-- 076：省级归属地统计（默认关；只取省级、不存 IP；省际统计用） -->
      <p class="muted" style="margin-top: 14px">{{ t('settings.metricsGeoDesc') }}</p>
      <label class="switch">
        <input v-model="settings.metricsGeo" type="checkbox" :disabled="!settings.metricsEnabled" />
        <span>{{ t('settings.metricsGeoSwitch') }}</span>
      </label>
    </div>

    <!-- 035 离线补传（2026-10-09）：分享创建失败时草稿入队，网络恢复后在此补传 -->
    <div class="setting">
      <h3>{{ t('share.shareQueueTitle') }}</h3>
      <p class="muted">{{ t('share.shareQueueDesc', { n: shareQueueCount }) }}</p>
      <button
        class="btn btn-secondary"
        style="margin-top: 10px"
        :disabled="shareSyncing || !shareQueueCount"
        @click="syncShares"
      >
        {{ shareSyncing ? t('settings.syncing') : t('share.shareQueueSync') }}
      </button>
      <p v-if="shareMsg" class="muted" role="status" style="margin-top: 8px">{{ shareMsg }}</p>
    </div>

    <div class="setting">
      <h3>{{ t('settings.reportsTitle') }}</h3>
      <p class="muted">{{ t('settings.reportsDesc', { n: reportCount }) }}</p>
      <p class="muted">{{ t('settings.reportsPending', { n: pendingCount }) }}</p>
      <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap">
        <button class="btn btn-secondary" :disabled="syncing || !pendingCount" @click="syncReports">
          {{ syncing ? t('settings.syncing') : t('settings.syncReports') }}
        </button>
        <button class="btn btn-secondary" @click="exportLocalReports">
          {{ t('settings.exportAllData') }}
        </button>
        <button class="btn btn-secondary" @click="pickReportsFile">
          {{ t('settings.importReports') }}
        </button>
        <button v-if="!clearWarn" class="btn btn-secondary" :disabled="!reportCount" @click="clearWarn = true">
          {{ t('settings.clearReports') }}
        </button>
      </div>
      <!-- 064 清空二次确认：清空不可恢复，先提醒导出（导出文件含归户验证码） -->
      <div v-if="clearWarn" class="clear-warn" role="alertdialog" :aria-label="t('settings.clearWarnTitle')">
        <p class="warn-title">{{ t('settings.clearWarnTitle') }}</p>
        <p class="muted">{{ t('settings.clearWarnDesc') }}</p>
        <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap">
          <button class="btn btn-primary" @click="exportLocalReports">
            {{ t('settings.clearExportFirst') }}
          </button>
          <button class="btn btn-secondary" @click="clearLocalReports">
            {{ t('settings.clearConfirm') }}
          </button>
          <button class="btn btn-secondary" @click="clearWarn = false">
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
      <p v-if="reportsMsg" class="muted" role="status" style="margin-top: 8px">{{ reportsMsg }}</p>
      <input
        ref="reportsImportInput"
        type="file"
        accept=".json,application/json"
        style="display: none"
        @change="onReportsFile"
      />
    </div>
  </section>
</template>

<style scoped>
h2.sec {
  font-size: 1.1rem;
  margin-bottom: 16px;
}
.setting {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
/* 064 清空前的导出提醒面板 */
.clear-warn {
  margin-top: 12px;
  padding: 12px 14px;
  border: 2px solid #f0d9a8;
  border-radius: var(--radius-sm);
  background: #fdf8ee;
}
.clear-warn .warn-title {
  font-weight: 700;
  font-size: 0.88rem;
  color: #8a6d00;
  margin-bottom: 4px;
}
.setting:last-of-type {
  border-bottom: none;
}
.setting h3 {
  font-size: 0.95rem;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.lang-ic {
  color: var(--primary);
}
.lang-choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}
.choices {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  text-align: left;
  padding: 12px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  transition: all 0.18s ease;
}
.choice:hover {
  border-color: var(--primary-light);
}
.choice.on {
  border-color: var(--primary);
  background: #f3fbf7;
}
.choice strong {
  font-size: 0.9rem;
}
.choice span {
  font-size: 0.76rem;
  color: var(--text-light);
}
.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 0.85rem;
  cursor: pointer;
}
/* 028/076：匿名统计的「收集什么 / 为什么 / 不收集什么」说明 */
.metrics-list {
  margin: 8px 0 0 18px;
  padding: 0;
  font-size: 0.76rem;
  line-height: 1.5;
}
.metrics-list li {
  margin-bottom: 4px;
}
.metrics-list strong {
  margin-right: 6px;
  color: var(--primary-dark);
}
.delay {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 0.85rem;
}
.delay input {
  width: 90px;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
}
.track-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.track {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  font-size: 0.88rem;
  transition: all 0.18s ease;
}
.track:hover {
  border-color: var(--primary-light);
}
.track input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary);
}
.track .main {
  font-weight: 600;
}
.track .alt {
  margin-left: auto;
  font-size: 0.74rem;
  color: var(--text-light);
}
</style>
