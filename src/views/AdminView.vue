<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCheck, RefreshCw, ShieldCheck, Undo2, X } from 'lucide-vue-next'
import { loadBank, speciesById, speciesName } from '@/core/bank'
import {
  AdminAuthError,
  listAdminReports,
  patchReportStatus,
  type AdminReport,
  type ReportStatus,
} from '@/core/reportsApi'
import { currentLocale } from '@/i18n'

const { t } = useI18n()
const KEY_STORE = 'uniaoer.adminKey'
const key = ref('')
const authed = ref(false)
const loading = ref(false)
const failed = ref(false)
const authError = ref(false)
const filter = ref<ReportStatus | 'all'>('open')
const reports = ref<AdminReport[]>([])
const busy = ref<Record<string, boolean>>({})
const savedMsg = ref('')

function rememberKey(v: string) {
  try {
    if (v) sessionStorage.setItem(KEY_STORE, v)
    else sessionStorage.removeItem(KEY_STORE)
  } catch {
    /* ignore */
  }
}

async function load() {
  if (!key.value) return
  loading.value = true
  authError.value = false
  failed.value = false
  try {
    await loadBank().catch(() => null)
    reports.value = await listAdminReports(key.value, { status: filter.value, limit: 100 })
    authed.value = true
    rememberKey(key.value)
  } catch (e) {
    if (e instanceof AdminAuthError) {
      authError.value = true
      authed.value = false
    } else {
      failed.value = true
    }
  } finally {
    loading.value = false
  }
}

function logout() {
  key.value = ''
  authed.value = false
  reports.value = []
  rememberKey('')
}

async function setStatus(r: AdminReport, status: ReportStatus) {
  busy.value = { ...busy.value, [r.id]: true }
  savedMsg.value = ''
  try {
    await patchReportStatus(r.id, status, key.value)
    r.status = status
    savedMsg.value = t('admin.saved')
    // 当前筛选下若状态不再匹配则移除
    if (filter.value !== 'all' && r.status !== filter.value) {
      reports.value = reports.value.filter((x) => x.id !== r.id)
    }
  } catch (e) {
    if (e instanceof AdminAuthError) authError.value = true
  } finally {
    busy.value = { ...busy.value, [r.id]: false }
  }
}

const filterOptions: { value: ReportStatus | 'all'; key: string }[] = [
  { value: 'open', key: 'admin.status.open' },
  { value: 'published', key: 'admin.status.published' },
  { value: 'fixed', key: 'admin.status.fixed' },
  { value: 'rejected', key: 'admin.status.rejected' },
  { value: 'all', key: 'admin.status.all' },
]

function displayName(r: AdminReport): string {
  const sp = r.species_id ? speciesById(r.species_id) : undefined
  return sp ? speciesName(sp, currentLocale()) : r.species_name || r.species_id || ''
}
function dateOf(at: number): string {
  try {
    return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
  } catch {
    return new Date(at).toLocaleString()
  }
}

onMounted(() => {
  try {
    key.value = sessionStorage.getItem(KEY_STORE) || ''
  } catch {
    /* ignore */
  }
  if (key.value) void load()
})

const count = computed(() => reports.value.length)
</script>

<template>
  <section class="card admin">
    <h2 class="head"><ShieldCheck class="ic" :size="22" /> {{ t('admin.title') }}</h2>

    <!-- 未解锁：输入密钥 -->
    <template v-if="!authed">
      <p class="muted lead">{{ t('admin.lead') }}</p>
      <form class="unlock" @submit.prevent="load">
        <input
          v-model="key"
          type="password"
          :aria-label="t('admin.keyLabel')"
          :placeholder="t('admin.keyPlaceholder')"
          autocomplete="off"
        />
        <button class="btn btn-primary" type="submit" :disabled="loading || !key">
          {{ t('admin.unlock') }}
        </button>
      </form>
      <p v-if="authError" class="err" role="alert">{{ t('admin.wrongKey') }}</p>
      <p v-else-if="failed" class="err" role="alert">{{ t('reports.unavailable') }}</p>
    </template>

    <!-- 已解锁 -->
    <template v-else>
      <div class="toolbar">
        <label class="filter">
          <span>{{ t('admin.filterStatus') }}</span>
          <select v-model="filter" @change="load">
            <option v-for="o in filterOptions" :key="o.value" :value="o.value">
              {{ t(o.key) }}
            </option>
          </select>
        </label>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="loading" @click="load">
          <RefreshCw class="ic" :size="13" /> {{ t('admin.refresh') }}
        </button>
        <button class="btn btn-secondary btn-sm" type="button" @click="logout">
          {{ t('admin.logout') }}
        </button>
        <span class="count">{{ t('admin.reportCount', { n: count }) }}</span>
        <span v-if="savedMsg" class="saved" role="status">{{ savedMsg }}</span>
      </div>

      <p v-if="loading" class="muted empty" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="!reports.length" class="muted empty">{{ t('admin.empty') }}</p>

      <ul v-else class="list">
        <li v-for="r in reports" :key="r.id" class="item">
          <div class="body">
            <div class="line1">
              <RouterLink v-if="r.species_id" class="name" :to="`/species/${r.species_id}`">
                {{ displayName(r) }}
              </RouterLink>
              <span v-else class="name">{{ displayName(r) }}</span>
              <span class="reason">{{ t(`report.reasons.${r.reason}`) }}</span>
              <span class="status" :class="r.status">{{ t(`admin.status.${r.status}`) }}</span>
              <span class="votes">👍 {{ r.up }} · 👎 {{ r.down }}</span>
            </div>
            <p v-if="r.note" class="note">{{ r.note }}</p>
            <p v-if="r.suggested_answer" class="suggest">
              {{ t('reports.suggested', { name: r.suggested_answer }) }}
            </p>
            <p class="meta">
              {{ dateOf(r.created_at) }}
              <a v-if="r.media_url" class="media" :href="r.media_url" target="_blank" rel="noopener">
                {{ t('admin.openMedia') }}
              </a>
            </p>
          </div>
          <div class="actions">
            <button
              v-if="r.status !== 'published'"
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="busy[r.id]"
              @click="setStatus(r, 'published')"
            >
              <CheckCheck class="ic" :size="13" /> {{ t('admin.publish') }}
            </button>
            <button
              v-if="r.status !== 'fixed'"
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="busy[r.id]"
              @click="setStatus(r, 'fixed')"
            >
              {{ t('admin.markFixed') }}
            </button>
            <button
              v-if="r.status !== 'rejected'"
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="busy[r.id]"
              @click="setStatus(r, 'rejected')"
            >
              <X class="ic" :size="13" /> {{ t('admin.reject') }}
            </button>
            <button
              v-if="r.status !== 'open'"
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="busy[r.id]"
              @click="setStatus(r, 'open')"
            >
              <Undo2 class="ic" :size="13" /> {{ t('admin.reopen') }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.admin {
  text-align: center;
}
.head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.head .ic {
  color: var(--primary);
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 14px;
}
.unlock {
  display: flex;
  gap: 8px;
  justify-content: center;
  max-width: 420px;
  margin: 0 auto;
}
.unlock input {
  flex: 1;
  padding: 8px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.9rem;
}
.err {
  margin-top: 12px;
  color: var(--wrong);
  font-size: 0.82rem;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  text-align: left;
}
.filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-light);
}
.filter select {
  padding: 5px 8px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.82rem;
}
.count {
  font-size: 0.78rem;
  color: var(--text-light);
}
.saved {
  font-size: 0.78rem;
  color: var(--primary);
}
.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}
.item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.body {
  min-width: 0;
  flex: 1;
}
.line1 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.name {
  font-weight: 700;
  font-size: 0.92rem;
  color: var(--text);
}
.reason {
  font-size: 0.7rem;
  padding: 1px 8px;
  border-radius: 8px;
  background: #fdf3d8;
  color: #8a6d00;
}
.status {
  font-size: 0.7rem;
  padding: 1px 8px;
  border-radius: 8px;
  background: #eef1f0;
  color: var(--text-light);
}
.status.open {
  background: #fdf3d8;
  color: #8a6d00;
}
.status.published {
  background: #eaf4ef;
  color: var(--primary);
}
.status.fixed {
  background: #eaf4ef;
  color: var(--primary-dark);
}
.status.rejected {
  background: #fdecee;
  color: var(--wrong);
}
.votes {
  font-size: 0.72rem;
  color: var(--text-light);
}
.note {
  margin-top: 4px;
  font-size: 0.82rem;
  color: var(--text);
}
.suggest {
  margin-top: 2px;
  font-size: 0.78rem;
  color: var(--primary-dark);
}
.meta {
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--text-light);
}
.media {
  margin-left: 8px;
  color: var(--primary);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.actions .btn {
  white-space: nowrap;
}
.empty {
  margin: 16px 0;
}
</style>
