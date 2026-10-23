<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCheck, RefreshCw, ShieldCheck, ShieldOff, Undo2, X } from 'lucide-vue-next'
import { loadBank, speciesById, speciesName } from '@/core/bank'
import { fetchRegionAccuracy, type RegionAccuracy } from '@/core/adminRegionStats'
import { fetchProvinceStats, type ProvinceStats } from '@/core/adminProvinceStats'
import { fetchSpeciesStats, type SpeciesStats } from '@/core/adminSpeciesStats'
import { groupRegions } from '@/core/regionGroup'
import { regionLabel } from '@/core/region'
import { loadProvincesIndex, provincesOf, type ProvinceIndex } from '@/core/provinces'
import {
  AdminAuthError,
  listAdminReports,
  type QuarantineItem,
  listQuarantine,
  patchReportStatus,
  quarantineReportMedia,
  unquarantine,
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
/** M2：排序（仅「已发布」下才可选按票） */
const sort = ref<'recent' | 'votes' | 'controversial'>('recent')
/** M2：只看填了「建议答案」的条目 */
const onlyWithAnswer = ref(false)

/**
 * M2（063 §2.1）：**票数只对「已发布」条目有意义**。
 * 提交后是 `open`（不公开，`/reports` 公开页只展示 `published`）→ 没人能投票 → `up/down` 恒为 0。
 * 所以非 `published` 时**禁用**按票排序（用户 2026-10-19 拍板），并在旁边说明原因。
 */
const votesSortable = computed(() => filter.value === 'published')

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
    reports.value = await listAdminReports(key.value, {
      status: filter.value,
      limit: 100,
      sort: votesSortable.value ? sort.value : 'recent',
      hasAnswer: onlyWithAnswer.value,
    })
    void refreshQuarantine()
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

/** 029 M3：隔离台账键（与 Worker 端一致：`<species_id>|<type>|<url>`） */
const quarantinedKeys = ref<Set<string>>(new Set())
const quarantineItems = ref<QuarantineItem[]>([])
const mediaKeyOf = (r: AdminReport) =>
  `${r.species_id ?? ''}|${r.question_type === 'audio' ? 'audio' : 'image'}|${r.media_url ?? ''}`

async function refreshQuarantine() {
  try {
    const items = await listQuarantine(key.value)
    quarantineItems.value = items
    quarantinedKeys.value = new Set(items.filter((x) => !x.resolved_at).map((x) => x.media_key))
  } catch {
    /* 管理端拉取失败不阻塞主流程 */
  }
}

async function quarantine(r: AdminReport) {
  busy.value = { ...busy.value, [r.id]: true }
  savedMsg.value = ''
  try {
    await quarantineReportMedia(r.id, key.value, {
      speciesId: r.species_id ?? undefined,
      mediaType: r.question_type === 'audio' ? 'audio' : 'image',
      mediaUrl: r.media_url ?? undefined,
    })
    savedMsg.value = t('admin.quarantinedMsg')
    await refreshQuarantine()
  } catch {
    savedMsg.value = t('admin.saveFailed')
  } finally {
    busy.value = { ...busy.value, [r.id]: false }
  }
}

/**
 * M1：解除隔离。
 * ⚠️ 这个 API（Worker `{action:'unquarantine'}` + 前端 `unquarantine()`）**早就实现了，
 * 只是一直没有 UI 入口** —— 误封的素材只能手敲 curl 恢复。媒体名可能有前后空格，
 * 我们对 speciesId/url 做 trim，避免因为尾部空白拼出不同的 media_key。
 */
async function release(mediaKey: string) {
  busy.value = { ...busy.value, [mediaKey]: true }
  savedMsg.value = ''
  const adminKey = key.value
  try {
    // media_key = `<species_id>|<type>|<url>` → 反解出原报错 id（沿用报错记录的 report_id）
    const item = quarantineItems.value.find((x) => x.media_key === mediaKey)
    const sid = mediaKey.split('|')[0]?.trim() || ''
    const type = mediaKey.split('|')[1]?.trim() === 'audio' ? 'audio' : 'image'
    const url = mediaKey.split('|').slice(2).join('|').trim()
    await unquarantine(adminKey, mediaKey, item?.report_id || 'manual')
    quarantineItems.value = quarantineItems.value.map((x) =>
      x.media_key === mediaKey ? { ...x, resolved_at: Date.now() } : x,
    )
    quarantinedKeys.value = new Set(
      quarantineItems.value.filter((x) => !x.resolved_at).map((x) => x.media_key),
    )
    // 让列表里对应的报错也显示为「已解除」
    reports.value = reports.value.map((r) =>
      r.species_id === sid && r.media_url === url && (r.question_type || 'image') === type
        ? { ...r, media_url: r.media_url }
        : r,
    )
    savedMsg.value = t('admin.releasedMsg')
  } catch (e) {
    if (e instanceof AdminAuthError) authError.value = true
    else savedMsg.value = t('admin.saveFailed')
  } finally {
    busy.value = { ...busy.value, [mediaKey]: false }
  }
}

const activeQuarantine = computed(() => quarantineItems.value.filter((x) => !x.resolved_at))

// ---- 073 P0：地区正确率（管理端观察期；口径 A = 用户自选地区） ----
const regionStats = ref<RegionAccuracy | null>(null)
const regionLoading = ref(false)
const regionError = ref('')
async function loadRegionStats() {
  if (!key.value || regionLoading.value) return
  regionLoading.value = true
  regionError.value = ''
  try {
    await ensureProvinces()
    regionStats.value = await fetchRegionAccuracy(key.value, 30)
  } catch (e) {
    regionError.value = e instanceof Error ? e.message : 'failed'
  } finally {
    regionLoading.value = false
  }
}
/** 省名需要一次懒加载（与观鸟页同一份产物；失败就退回显示省码） */
const provinceData = ref<ProvinceIndex | null>(null)
async function ensureProvinces() {
  if (provinceData.value) return
  provinceData.value = await loadProvincesIndex().catch(() => null)
}
/** 073：扁平行 → 国家榜 + 同国省级榜（港澳台归中国、做省级；不做最小轮数剔除） */
const groupedRegionStats = computed(() => (regionStats.value ? groupRegions(regionStats.value.byRegion) : null))
/** 日期范围显示：同一天只显示一个日期（2026-10-22 / 10-22~10-24 简写） */
function daySpan(from?: string, to?: string): string {
  if (!from) return ''
  if (!to || to === from) return from
  return `${from} ~ ${to}`
}

/** 地区码 → 可读名（CN-11 → 中国 · 北京；HK → 中国香港；ALL → 全球） */
function regionLabelOf(code: string): string {
  if (!code || code === 'ALL') return t('admin.regionAll')
  const [cc = '', ...rest] = code.split('-')
  const country = regionLabel(cc, t, currentLocale())
  if (!rest.length) return country
  const prov = provincesOf(provinceData.value, cc, currentLocale()).find((p) => p.code === code)
  return prov ? `${country} · ${prov.name}` : `${country} · ${code}`
}

// ---- 076：省际统计（管理端观察期；口径 = IP 省级归属地，仅统计已同意用户） ----
const provinceStats = ref<ProvinceStats | null>(null)
const provinceLoading = ref(false)
const provinceError = ref('')
async function loadProvinceStats() {
  if (!key.value || provinceLoading.value) return
  provinceLoading.value = true
  provinceError.value = ''
  try {
    await ensureProvinces()
    provinceStats.value = await fetchProvinceStats(key.value, 30)
  } catch (e) {
    provinceError.value = e instanceof Error ? e.message : 'failed'
  } finally {
    provinceLoading.value = false
  }
}
// ---- 077：鸟种级错误率（管理端观察期；T+1；不含用户/省份） ----
const speciesStats = ref<SpeciesStats | null>(null)
const speciesLoading = ref(false)
const speciesError = ref('')
async function loadSpeciesStats() {
  if (!key.value || speciesLoading.value) return
  speciesLoading.value = true
  speciesError.value = ''
  try {
    await loadBank()
    speciesStats.value = await fetchSpeciesStats(key.value, 30)
  } catch (e) {
    speciesError.value = e instanceof Error ? e.message : 'failed'
  } finally {
    speciesLoading.value = false
  }
}
/** 物种 id → 当前语言俗名（查不到就显示 id） */
function speciesLabel(id: string): string {
  const sp = speciesById(id)
  return sp ? speciesName(sp, currentLocale()) : id
}

/** 归属地展示名：港澳台一律「中国香港／中国澳门／中国台湾」（铁律 6） */
function provLabel(code: string): string {
  if (code === 'CN-91') return regionLabel('HK', t, currentLocale())
  if (code === 'CN-92') return regionLabel('MO', t, currentLocale())
  if (code === 'CN-71') return regionLabel('TW', t, currentLocale())
  return regionLabelOf(code)
}

async function setStatus(r: AdminReport, status: ReportStatus) {  busy.value = { ...busy.value, [r.id]: true }
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

/** 切换状态筛选：若新筛选下「按票排序」无意义，把排序复位到「最近」 */
function onFilterChange() {
  if (!votesSortable.value && sort.value !== 'recent') sort.value = 'recent'
  void load()
}

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
          <select v-model="filter" @change="onFilterChange">
            <option v-for="o in filterOptions" :key="o.value" :value="o.value">
              {{ t(o.key) }}
            </option>
          </select>
        </label>

        <!-- M2：排序。按票排序只在「已发布」下有意义（open 不公开 → 没人投票 → 票恒为 0） -->
        <label class="filter">
          <span>{{ t('admin.sort') }}</span>
          <select v-model="sort" :disabled="!votesSortable" @change="load">
            <option value="recent">{{ t('admin.sortRecent') }}</option>
            <option value="votes">{{ t('admin.sortVotes') }}</option>
            <option value="controversial">{{ t('admin.sortControversial') }}</option>
          </select>
        </label>
        <label class="check">
          <input v-model="onlyWithAnswer" type="checkbox" @change="load" />
          <span>{{ t('admin.onlyWithAnswer') }}</span>
        </label>
        <span v-if="!votesSortable" class="hint">{{ t('admin.votesHint') }}</span>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="loading" @click="load">
          <RefreshCw class="ic" :size="13" /> {{ t('admin.refresh') }}
        </button>
        <button class="btn btn-secondary btn-sm" type="button" @click="logout">
          {{ t('admin.logout') }}
        </button>
        <span class="count">{{ t('admin.reportCount', { n: count }) }}</span>
        <span v-if="savedMsg" class="saved" role="status">{{ savedMsg }}</span>
      </div>

      <details v-if="activeQuarantine.length || quarantineItems.length" class="ledger">
        <summary>{{ t('admin.quarantineList') }} · {{ activeQuarantine.length }}</summary>
        <p v-if="!activeQuarantine.length" class="muted empty">{{ t('admin.noQuarantine') }}</p>
        <ul v-else class="qlist">
          <li v-for="q in activeQuarantine" :key="q.media_key" class="qitem">
            <span class="qspecies">{{ q.species_id }} · {{ q.media_type }}</span>
            <a class="qurl" :href="q.media_url" target="_blank" rel="noopener">{{
              q.media_url.length > 72 ? q.media_url.slice(0, 72) + '…' : q.media_url
            }}</a>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="busy[q.media_key]"
              @click="release(q.media_key)"
            >
              <Undo2 class="ic" :size="13" /> {{ t('admin.release') }}
            </button>
          </li>
        </ul>
      </details>

      <!-- 073 P0：地区正确率（观察期，仅管理端可见；口径 = 用户自选地区，不是 IP） -->
      <details class="ledger">
        <summary>{{ t('admin.regionStatsTitle') }}</summary>
        <p class="muted small">{{ t('admin.regionStatsNote') }}</p>
        <div class="toolbar" style="margin: 8px 0">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="regionLoading" @click="loadRegionStats">
            <RefreshCw class="ic" :size="13" /> {{ t('admin.regionStatsLoad') }}
          </button>
        </div>
        <p v-if="regionError" class="err" role="alert">{{ regionError }}</p>
        <template v-else-if="regionStats">
          <p class="muted small">
            {{ t('admin.regionStatsMetaExact', {
              from: regionStats.regionFirstDay ?? regionStats.metricFirstDay ?? '—',
              to: regionStats.metricLastDay ?? '—',
              window: regionStats.since,
              total: regionStats.total,
            }) }}
            · {{ t('admin.regionStatsMissing', { n: regionStats.missingRegion }) }}
          </p>
          <!-- 逐日明细：核对"哪天的数据被算进来了"，避免以后把窗口起点当数据起点 -->
          <details v-if="regionStats.byDay.length" class="ledger">
            <summary>{{ t('admin.regionStatsByDay', { n: regionStats.byDay.length }) }}</summary>
            <ul class="ranks">
              <li v-for="d in regionStats.byDay" :key="d.day">
                <span class="rank-name">{{ d.day }}</span>
                <span class="rank-n">{{ t('admin.regionStatsCell', { mean: d.mean, n: d.n }) }}</span>
              </li>
            </ul>
          </details>
          <p v-if="!groupedRegionStats?.countries.length" class="muted small">
            {{ t('admin.regionStatsEmpty') }}
          </p>
          <template v-else>
            <!-- 073：三个总口径 —— 全部 / 未指定 / 各国；再往下是「仅国家」与省级 -->
            <ul class="ranks">
              <li>
                <span class="rank-name strong">{{ t('admin.regionStatsTotal') }}</span>
                <span class="rank-n">
                  {{ t('admin.regionStatsCell', { mean: groupedRegionStats.total.mean, n: groupedRegionStats.total.n }) }}
                </span>
              </li>
              <li v-if="groupedRegionStats.unspecified">
                <span class="rank-name">{{ t('admin.regionStatsUnspecifiedLabel') }}</span>
                <span class="rank-n">
                  {{ t('admin.regionStatsCell', {
                    mean: groupedRegionStats.unspecified.mean,
                    n: groupedRegionStats.unspecified.n,
                  }) }}
                </span>
              </li>
            </ul>

            <p class="muted small">{{ t('admin.regionStatsCountryHint') }}</p>
            <ul class="ranks">
              <li v-for="c in groupedRegionStats.countries" :key="c.code" class="country-row">
                <div class="country-head">
                  <span class="rank-name">
                    {{ regionLabelOf(c.code) }}
                    <span v-if="c.firstDay" class="span-days">（{{ daySpan(c.firstDay, c.lastDay) }}）</span>
                  </span>
                  <span class="rank-n">{{ t('admin.regionStatsCell', { mean: c.mean, n: c.n }) }}</span>
                </div>
                <!-- 「仅国家（未细分）」与「国家+具体地区」分开显示；省级排行只在同国内部 -->
                <ul v-if="c.countryOnly || c.provinces.length" class="ranks sub-ranks">
                  <li v-if="c.countryOnly">
                    <span class="rank-name sub">{{ t('admin.regionStatsCountryOnly') }}</span>
                    <span class="rank-n">
                      {{ t('admin.regionStatsCell', { mean: c.countryOnly.mean, n: c.countryOnly.n }) }}
                    </span>
                  </li>
                  <li v-for="p in c.provinces" :key="p.code">
                    <span class="rank-name sub">
                      {{ regionLabelOf(p.code) }}
                      <span v-if="p.firstDay" class="span-days">（{{ daySpan(p.firstDay, p.lastDay) }}）</span>
                    </span>
                    <span class="rank-n">{{ t('admin.regionStatsCell', { mean: p.mean, n: p.n }) }}</span>
                  </li>
                </ul>
              </li>
            </ul>
          </template>
        </template>
      </details>

      <!-- 076：省际统计（观察期，仅管理端可见；口径 = IP 省级归属地，非用户自选地区） -->
      <details class="ledger">
        <summary>{{ t('admin.provinceStatsTitle') }}</summary>
        <p class="muted small">{{ t('admin.provinceStatsNote') }}</p>
        <div class="toolbar" style="margin: 8px 0">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="provinceLoading" @click="loadProvinceStats">
            <RefreshCw class="ic" :size="13" /> {{ t('admin.provinceStatsLoad') }}
          </button>
        </div>
        <p v-if="provinceError" class="err" role="alert">{{ provinceError }}</p>
        <template v-else-if="provinceStats">
          <p class="muted small">
            {{ t('admin.provinceStatsMeta', { window: provinceStats.since, n: provinceStats.provinces.length }) }}
          </p>
          <p v-if="!provinceStats.provinces.length" class="muted small">{{ t('admin.provinceStatsEmpty') }}</p>
          <ul v-else class="ranks">
            <li v-for="p in provinceStats.provinces" :key="p.prov">
              <span class="rank-name">{{ provLabel(p.prov) }}</span>
              <span class="rank-n">
                {{ t('admin.provinceStatsCell', { users: p.users, visits: p.visits, rounds: p.rounds }) }}
                <template v-if="p.accuracy">
                  · {{ t('admin.provinceStatsAcc', { mean: p.accuracy.mean, n: p.accuracy.n }) }}
                  <template v-if="p.accuracy.small">（{{ t('admin.provinceStatsSmall') }}）</template>
                </template>
              </span>
            </li>
          </ul>

          <details v-if="provinceStats.matrix.length" class="ledger">
            <summary>{{ t('admin.provinceMatrixTitle', { n: provinceStats.matrix.length }) }}</summary>
            <p class="muted small">{{ t('admin.provinceMatrixNote') }}</p>
            <ul class="ranks">
              <li v-for="m in provinceStats.matrix" :key="`${m.uprov}-${m.region}-${m.tier}`">
                <span class="rank-name">
                  {{ provLabel(m.uprov) }} →
                  {{ m.region === 'ALL' ? t('admin.regionAll') : provLabel(m.region) }} · L{{ m.tier }}
                </span>
                <span class="rank-n">
                  {{ t('admin.regionStatsCell', { mean: m.mean, n: m.n }) }}
                  <template v-if="m.small">（{{ t('admin.provinceStatsSmall') }}）</template>
                </span>
              </li>
            </ul>
          </details>
          <p v-if="provinceStats.notes?.consent" class="muted small">{{ provinceStats.notes.consent }}</p>
        </template>
      </details>

      <!-- 077：鸟种错误率 + 被错认组合（T+1；管理端观察期） -->
      <details class="ledger">
        <summary>{{ t('admin.speciesStatsTitle') }}</summary>
        <p class="muted small">{{ t('admin.speciesStatsNote') }}</p>
        <div class="toolbar" style="margin: 8px 0">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="speciesLoading" @click="loadSpeciesStats">
            <RefreshCw class="ic" :size="13" /> {{ t('admin.speciesStatsLoad') }}
          </button>
        </div>
        <p v-if="speciesError" class="err" role="alert">{{ speciesError }}</p>
        <template v-else-if="speciesStats">
          <p class="muted small">
            {{ t('admin.speciesStatsMeta', {
              window: speciesStats.since,
              until: speciesStats.until,
              answers: speciesStats.totals.answers,
              species: speciesStats.totals.species,
            }) }}
          </p>
          <p v-if="!speciesStats.species.length" class="muted small">{{ t('admin.speciesStatsEmpty') }}</p>
          <ul v-else class="ranks">
            <li v-for="sp in speciesStats.species" :key="sp.species">
              <span class="rank-name">{{ speciesLabel(sp.species) }}</span>
              <span class="rank-n">
                {{ t('admin.speciesStatsRate', { wrong: sp.wrong, answers: sp.answers, rate: sp.rate }) }}
                <template v-if="sp.small">（{{ t('admin.provinceStatsSmall') }}）</template>
              </span>
            </li>
          </ul>

          <details v-if="speciesStats.pairs.length" class="ledger">
            <summary>{{ t('admin.speciesPairsTitle', { n: speciesStats.pairs.length }) }}</summary>
            <ul class="ranks">
              <li v-for="pair in speciesStats.pairs" :key="`${pair.species}>${pair.chosen}`">
                <span class="rank-name">
                  {{ speciesLabel(pair.species) }} → {{ speciesLabel(pair.chosen) }}
                </span>
                <span class="rank-n">
                  {{ t('admin.speciesPairsCell', { n: pair.n }) }}
                  <template v-if="pair.small">（{{ t('admin.provinceStatsSmall') }}）</template>
                </span>
              </li>
            </ul>
          </details>
        </template>
      </details>

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
            <!-- M2：把「建议答案」提到第 2 行并加重——这是最该先看的信号 -->
            <p v-if="r.suggested_answer" class="suggest">
              {{ t('admin.suggestedAnswer', { name: r.suggested_answer }) }}
            </p>
            <p v-if="r.note" class="note">{{ r.note }}</p>
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
            <!-- 029 M3：质量隔离（素材不适合当考题；有替补换替补，无替补降级为仅展示） -->
            <button
              v-if="r.media_url && !quarantinedKeys.has(mediaKeyOf(r))"
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="busy[r.id]"
              :title="t('admin.quarantineHint')"
              @click="quarantine(r)"
            >
              <ShieldOff class="ic" :size="13" /> {{ t('admin.quarantine') }}
            </button>
            <template v-else-if="r.media_url">
              <span class="quar">✓ {{ t('admin.quarantined') }}</span>
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                :disabled="busy[mediaKeyOf(r)]"
                @click="release(mediaKeyOf(r))"
              >
                <Undo2 class="ic" :size="13" /> {{ t('admin.release') }}
              </button>
            </template>
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
/* 073：地区榜基础排版（本页此前没有 .ranks 样式，StatsView 里那份是 scoped 的） */
.ranks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
}
.ranks li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
}
.ranks .rank-name {
  flex: 1;
  min-width: 0;
}
.ranks .rank-n {
  color: var(--text-light);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 073：国家榜 + 同国省级（缩进 + 弱色，避免和国家级混在一起读）。
   注意用 `.ranks .country-row`（0,2,0）压过 `.ranks li`（0,1,1）的 align-items:center，
   否则国家行会收缩成内容宽并居中。 */
.ranks .country-row {
  flex-direction: column;
  align-items: stretch;
}
.country-row + .country-row {
  margin-top: 6px;
}
.country-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  text-align: left;
}
.country-head .rank-name {
  font-weight: 600;
}
.ranks .rank-name.strong {
  font-weight: 700;
}
.span-days {
  color: var(--text-light);
  font-size: 0.92em;
  font-weight: 400;
}
.sub-ranks {
  margin: 2px 0 0 14px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
}
.sub-ranks .rank-name.sub {
  font-size: 0.85em;
  color: var(--text-light);
}

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
/* M2：勾选框与「票数只对已发布有意义」提示 */
.check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: var(--text-light);
  cursor: pointer;
}
.hint {
  flex-basis: 100%;
  font-size: 0.74rem;
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
  border-radius: var(--radius-xs);
  background: #fdf3d8;
  color: #8a6d00;
}
/* 029 M3：隔离态标记 */
.quar {
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--primary);
  align-self: center;
  padding: 0 4px;
}
/* M1：隔离台账面板 */
.ledger {
  margin: 0 0 14px;
  text-align: left;
  font-size: 0.8rem;
}
.ledger summary {
  cursor: pointer;
  color: var(--primary);
  font-weight: 600;
}
.qlist {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qitem {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: #fff;
}
.qspecies {
  font-weight: 600;
  white-space: nowrap;
}
.qurl {
  flex: 1;
  min-width: 0;
  font-size: 0.72rem;
  color: var(--text-light);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  font-size: 0.7rem;
  padding: 1px 8px;
  border-radius: var(--radius-xs);
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
/* M2：建议答案是第 2 行、最该先看 → 加粗 + 主色 */
.suggest {
  margin-top: 3px;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--primary);
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
