<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Languages, Settings } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { ambiencePlayer, loadBirdTracks, type AmbienceTrack } from '@/core/ambience'
import { clearReports, countReports, pendingReportCount } from '@/core/reportStore'
import { syncPendingReports } from '@/core/reportSync'
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

/** G1：清空本地报错记录 */
async function clearLocalReports() {
  try {
    await clearReports()
    reportsMsg.value = t('settings.reportsCleared')
    await refreshReportCounts()
  } catch {
    reportsMsg.value = t('errors.unknown')
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
      <label class="switch">
        <input v-model="settings.metricsEnabled" type="checkbox" />
        <span>{{ t('settings.metricsSwitch') }}</span>
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
        <button class="btn btn-secondary" :disabled="!reportCount" @click="clearLocalReports">
          {{ t('settings.clearReports') }}
        </button>
      </div>
      <p v-if="reportsMsg" class="muted" role="status" style="margin-top: 8px">{{ reportsMsg }}</p>
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
