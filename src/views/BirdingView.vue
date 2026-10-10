<script setup lang="ts">
/**
 * 042：「观鸟」页（合并原 `/region` 地区浏览与 `/nearby` 附近鸟点）。
 *
 * 结构：两个标签页 —— ①**观鸟点**（默认，含「附近鸟点」开关：关=按地区浏览点位，开=按定位排附近点位）
 * ②**地区浏览**（只保留鸟种网格）。
 * 地区选择器（大洲/国家/省）在页面级常驻，两个标签页共用。
 * 旧路由 `/region` / `/nearby` 由 router 重定向到本页并还原状态（见 router/index.ts）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Crosshair, Globe2, MapPin, Search } from 'lucide-vue-next'
import NearbySpotsPanel from '@/components/NearbySpotsPanel.vue'
import { loadBank, speciesById, speciesName, type BankSpecies, type Manifest } from '@/core/bank'
import { loadGlobalPool } from '@/core/globalPool'
import {
  buildCountryIndex,
  countriesInContinent,
  countryStats,
  filterCountries,
  presentContinents,
  REGION_LABEL_KEY,
  type Continent,
} from '@/core/region'
import {
  loadProvinces,
  provinceCount,
  provinceStats,
  speciesInProvince,
  type ProvinceData,
} from '@/core/provinces'
import {
  ebirdHotspotUrl,
  hotspotsInProvince,
  loadCountrySpots,
  loadHotspots,
  spotsOf,
  type HotspotIndex,
  type Hotspot,
} from '@/core/hotspots'
import { currentLocale } from '@/i18n'
import {
  entryDisplayName,
  loadSpeciesDistribution,
  loadSpeciesIndex,
  shortCodeOf,
  slugifySci,
  type SpeciesIndex,
} from '@/core/speciesIndex'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const bank = ref<Manifest | null>(null)
const bySpecies = ref<Record<string, string[]> | null>(null)
const provinceData = ref<ProvinceData | null>(null)
const hotspotData = ref<HotspotIndex | null>(null)
/** 当前所选国家的点位（懒加载；null = 加载中/无数据） */
const countrySpots = ref<Hotspot[]>([])
const expandedHotspot = ref('')
const failed = ref(false)
const query = ref('')
/** 025 M2:全球骨架与区系(懒加载,失败降级为 bank 视图) */
const speciesIdx = ref<SpeciesIndex | null>(null)
const globalByCountry = ref<Record<string, string[]> | null>(null)
/** 网格分段渲染:单国种数可达上千,每次 200 + 显示更多 */
const visibleCount = ref(200)
/** 先亚洲、默认中国（017：先中国） */
const continent = ref<Continent>('asia')
const selected = ref('CN')
/** 已选省级 code（空 = 国家级） */
const province = ref('')
/** 右侧面板标签页：观鸟点（默认）/ 地区浏览（042） */
const activeTab = ref<'spots' | 'regions'>('spots')
/** 「附近鸟点」开关（默认关；开 → 观鸟点列表改为按定位排序的附近点位） */
const nearby = ref(false)
/** 选中国家的省级二级列表是否展开（点击已选国家切换） */
const expanded = ref(true)
/** 移动端「选择地区」面板是否展开（桌面端始终显示，见 style 媒体查询） */
const pickerOpen = ref(false)
/** 与 region:nearby-spots 的 --cell-deg 一致（仅用于署名文案） */
const CELL_DEG = 0.25
/** 目录排序：名称（zh 拼音 / en 首字母）或鸟种数；一级二级共用 */
const sortMode = ref<'name' | 'count'>('name')

/** 深链还原：`/region` → tab=regions；`/nearby` → tab=spots&nearby=1 */
function applyQuery() {
  const q = route.query
  const tab = q.tab === 'regions' ? 'regions' : 'spots'
  activeTab.value = tab
  nearby.value = tab === 'spots' && q.nearby === '1'
  if (typeof q.cc === 'string' && q.cc) selected.value = q.cc.toUpperCase()
  if (typeof q.sub === 'string') province.value = q.sub
}

/** 标签/开关变化 → 写回 URL（保证刷新与分享可还原） */
function setTab(next: 'spots' | 'regions') {
  activeTab.value = next
  syncQuery()
}
function toggleNearby() {
  nearby.value = !nearby.value
  if (nearby.value) activeTab.value = 'spots'
  syncQuery()
}
function syncQuery() {
  const q: Record<string, string> = {}
  if (activeTab.value === 'regions') q.tab = 'regions'
  if (nearby.value) q.nearby = '1'
  void router.replace({ query: q })
}

onMounted(async () => {
  applyQuery()
  try {
    bank.value = await loadBank()
    const res = await fetch(`${import.meta.env.BASE_URL}data/distribution.json`)
    const data = res.ok
      ? ((await res.json()) as { bySpecies?: Record<string, string[]> })
      : { bySpecies: {} }
    bySpecies.value = data.bySpecies ?? {}
    // 省级层：缺失则整层不显示（021 §2.5 薄数据回退国家层）
    provinceData.value = await loadProvinces()
    // 观鸟点（eBird 派生点位）：索引缺失则整块不显示
    hotspotData.value = await loadHotspots()
    void loadSpotsFor(selected.value)
  } catch {
    failed.value = true
  }
  // 025 M2:全球层非致命——失败则保持现状 bank 视图
  void loadSpeciesIndex().then((idx) => (speciesIdx.value = idx))
  void loadSpeciesDistribution().then((d) => (globalByCountry.value = d?.byCountry ?? null))
})

/** ISO 3166-1 alpha-2 → 本地化地区名（Intl.DisplayNames；港澳台走特别标注；不支持时回退代码） */
function countryName(code: string): string {
  const key = REGION_LABEL_KEY[code]
  if (key) return t(key)
  try {
    return new Intl.DisplayNames([currentLocale()], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** 025 M2:全球区系 ∪ bank distribution(合并到「短码 → 国家数组」,与 bySpecies 同构;
 * countryStats/buildCountryIndex 原样可用)——骨架未加载则 null 降级 */
const mergedBySpecies = computed<Record<string, string[]> | null>(() => {
  const idx = speciesIdx.value
  if (!idx) return null
  const merged = new Map<string, Set<string>>() // shortCode → countries
  for (const [cc, codes] of Object.entries(globalByCountry.value ?? {})) {
    for (const code of codes) {
      if (!merged.has(code)) merged.set(code, new Set())
      merged.get(code)!.add(cc)
    }
  }
  for (const s of bank.value?.species ?? []) {
    if (!s.taxonKey) continue
    const code = shortCodeOf(s.taxonKey)
    if (!merged.has(code)) merged.set(code, new Set())
    for (const cc of bySpecies.value?.[s.id] ?? []) merged.get(code)!.add(cc)
  }
  return Object.fromEntries([...merged.entries()].map(([code, set]) => [code, [...set].sort()]))
})
const stats = computed(() => {
  const src = mergedBySpecies.value ?? bySpecies.value
  return src ? countryStats(src) : []
})
const continents = computed(() => presentContinents(stats.value))
const continentStats = computed(() => countriesInContinent(stats.value, continent.value))
/** 名称排序用本地化 collator：zh-CN 按拼音，en 按字母（首字母） */
const collator = computed(() => new Intl.Collator(currentLocale(), { numeric: true }))
const filtered = computed(() => {
  const list = filterCountries(continentStats.value, query.value, countryName)
  if (sortMode.value === 'count') return list // countryStats 已按鸟种数降序
  return [...list].sort((a, b) => collator.value.compare(countryName(a.code), countryName(b.code)))
})
/** 合并索引(国家 → 短码)与 bank 索引(降级路径与省级过滤用) */
const mergedIndex = computed(() => (mergedBySpecies.value ? buildCountryIndex(mergedBySpecies.value) : {}))
const index = computed(() => (bySpecies.value ? buildCountryIndex(bySpecies.value) : {}))
const provinces = computed(() => {
  const list = provinceStats(provinceData.value, selected.value, locale.value)
  if (sortMode.value === 'count') return [...list].sort((a, b) => b.count - a.count)
  return [...list].sort((a, b) => collator.value.compare(a.name, b.name))
})
const provinceName = computed(
  () => provinces.value.find((p) => p.code === province.value)?.name ?? '',
)
const provinceSet = computed(() =>
  province.value ? speciesInProvince(provinceData.value, selected.value, province.value) : null,
)
/** 统一网格条目:bank 物种(可玩,带头图)+ 全球骨架物种(未收录媒体,轻量详情) */
interface GridItem {
  slug: string
  name: string
  nameSci: string
  playable: boolean
  thumb: string | null
  bankId: string | null
}
/**
 * 029 M2:全球池懒加载(11k 可玩池,1 图 1 音/种)。
 * 「可玩」判定改用合并后的 playable——核心库或全球池任一带素材即可玩。
 */
const globalPool = ref<BankSpecies[] | null>(null)
void loadGlobalPool().then((p) => (globalPool.value = p))
/** 短码 → 全球池条目(用于徽标/缩略图;排除质量降级种) */
const poolByCode = computed<Map<string, BankSpecies>>(() => {
  const m = new Map<string, BankSpecies>()
  for (const sp of globalPool.value ?? []) {
    if (sp.taxonKey && !sp.quizExcluded) m.set(shortCodeOf(sp.taxonKey), sp)
  }
  return m
})
/** bank 物种按学名索引(骨架条目 ↔ bank 的桥;夹具 id 非 slug 形式也稳) */
const bankBySci = computed<Map<string, BankSpecies>>(() => {
  const m = new Map<string, BankSpecies>()
  for (const s of bank.value?.species ?? []) if (s.nameSci) m.set(s.nameSci.toLowerCase(), s)
  return m
})
const gridItems = computed<GridItem[]>(() => {
  const idx = speciesIdx.value
  const ps = provinceSet.value
  if (idx) {
    // bank 物种按 taxonKey 短码直查(骨架条目缺失也照常渲染;真实产物中 1299 全在骨架)
    const codeOfSp = new Map<string, BankSpecies>()
    for (const s of bank.value?.species ?? []) if (s.taxonKey) codeOfSp.set(shortCodeOf(s.taxonKey), s)
    const items: GridItem[] = []
    for (const code of mergedIndex.value[selected.value] ?? []) {
      let sp: BankSpecies | null | undefined = codeOfSp.get(code)
      const e = idx.byShortCode.get(code) ?? null
      if (!sp && e) sp = bankBySci.value.get(e.nameSci.toLowerCase()) ?? speciesById(slugifySci(e.nameSci))
      if (!e && !sp) continue
      // 全球池条目(短码直查;骨架条目缺失时也能判定可玩)
      const gp = poolByCode.value.get(code) ?? null
      const usable = sp ?? gp
      items.push({
        slug: usable ? usable.id : slugifySci(e!.nameSci),
        name: usable ? nameOf(usable) : entryDisplayName(e!, currentLocale()),
        nameSci: usable?.nameSci ?? e!.nameSci,
        playable: !!usable,
        thumb: usable?.image?.thumbUrl || usable?.image?.url || null,
        bankId: sp?.id ?? null,
      })
    }
    // 省级层仅覆盖 bank 物种:选中省份时只显示省内的 bank 种
    const list = ps ? items.filter((it) => it.bankId && ps.has(it.bankId)) : items
    return [...list].sort((a, b) => collator.value.compare(a.name, b.name))
  }
  // 降级:bank-only(现行为)
  return (index.value[selected.value] ?? [])
    .filter((id) => !ps || ps.has(id))
    .map((id) => speciesById(id))
    .filter((sp): sp is BankSpecies => !!sp)
    .map((sp) => ({
      slug: sp.id,
      name: nameOf(sp),
      nameSci: sp.nameSci,
      playable: true,
      thumb: sp.images?.[0]?.thumbUrl || sp.images?.[0]?.url || null,
      bankId: sp.id,
    }))
})
const visibleItems = computed(() => gridItems.value.slice(0, visibleCount.value))
watch([selected, province], () => {
  visibleCount.value = 200
})
const nameOf = (sp: BankSpecies) => speciesName(sp, currentLocale())
const countInProvince = (id: string) =>
  province.value ? provinceCount(provinceData.value, id, selected.value, province.value) : 0
const provinceSources = computed(() =>
  (provinceData.value?.sources ?? []).map((s) => s.name).join(' · '),
)

/** 该国观鸟点（腿 B 网格聚合；缺失/无数据则为空，整块隐藏）。
 *  2026-10-09：选中省份时**按 subnational1 过滤到省**；本省无点时回退全国并在窄条说明。 */
const hotspotResult = computed(() => {
  const placed = hotspotsInProvince(countrySpots.value, province.value)
  if (province.value && !placed.matched.length && countrySpots.value.length) {
    return { list: countrySpots.value, fallback: true }
  }
  return { list: province.value ? placed.matched : countrySpots.value, fallback: false }
})
const hotspotList = computed(() => hotspotResult.value.list)
/** 该国点位总数（用于「省份筛选 x（全国 y）」里的 y） */
const hotspotCountryCount = computed(() => countrySpots.value.length)
const hotspotSources = computed(() =>
  (hotspotData.value?.sources ?? []).map((s) => s.name).join(' · '),
)
/** 按国懒加载点位（切国时调用；失败 → 空数组，页面走空态） */
async function loadSpotsFor(cc: string) {
  if (!cc) {
    countrySpots.value = []
    return
  }
  const file = await loadCountrySpots(cc)
  countrySpots.value = spotsOf(file)
}

function toggleHotspot(id: string) {
  expandedHotspot.value = expandedHotspot.value === id ? '' : id
}
/** 代表鸟种显示名：有 manifest id 用本地化名，否则回退学名 */
function topSpeciesName(s: Hotspot['topSpecies'][number]): string {
  const sp = s.id ? speciesById(s.id) : undefined
  return sp ? nameOf(sp) : (s.sci ?? s.id ?? '')
}

/** 移动端「选择地区」按钮上的当前选择摘要 */
const selectionLabel = computed(() =>
  [t(`region.continents.${continent.value}`), countryName(selected.value), provinceName.value]
    .filter(Boolean)
    .join(' · '),
)

/** 切换大洲：搜索清空；若当前国家不属于该洲，自动选中该洲物种最多的国家并展开其省级 */
watch(continent, () => {
  query.value = ''
  if (!continentStats.value.some((s) => s.code === selected.value)) {
    selected.value = continentStats.value[0]?.code ?? ''
    expanded.value = true
  }
})

/** 切换国家：省级筛选重置并展开二级列表；观鸟点详情收起 */
watch(selected, () => {
  province.value = ''
  expanded.value = true
  expandedHotspot.value = ''
  void loadSpotsFor(selected.value)
})

/**
 * 点击国家：
 * - 未选 → 选中并展开（视为「全部」）
 * - 已选且正筛选某省 → 清除省级，回到「全部」
 * - 已选且无省级筛选 → 折叠/展开二级列表
 * 故「点击国家本身 = 全部」，二级目录不再需要「全部」项。
 */
function selectCountry(code: string) {
  if (code !== selected.value) {
    selected.value = code
    return
  }
  if (province.value) {
    province.value = ''
    expanded.value = true
  } else {
    expanded.value = !expanded.value
  }
}

/** 选择省级：移动端选完收起面板，便于直接看到下方鸟种 */
function pickProvince(code: string) {
  province.value = code
  pickerOpen.value = false
}
</script>

<template>
  <section class="card region birding">
    <h2 class="region-head"><Globe2 class="ic" :size="22" /> {{ t('birding.title') }}</h2>
    <p class="muted lead">{{ t('birding.lead') }}</p>

    <template v-if="stats.length">
      <nav class="continents" :aria-label="t('region.continentsLabel')">
        <button
          v-for="c in continents"
          :key="c"
          type="button"
          class="continent-btn"
          :class="{ active: c === continent }"
          :aria-pressed="c === continent"
          @click="continent = c"
        >
          {{ t(`region.continents.${c}`) }}
        </button>
      </nav>

      <div class="layout">
        <aside class="countries">
          <!-- 移动端：折叠式「选择地区」，避免上方列表占满屏幕 -->
          <button
            type="button"
            class="picker-toggle"
            :aria-expanded="pickerOpen"
            @click="pickerOpen = !pickerOpen"
          >
            <span class="picker-label">{{ t('region.pick') }}</span>
            <span class="picker-current">{{ selectionLabel }}</span>
            <ChevronDown class="ic" :size="16" :class="{ open: pickerOpen }" />
          </button>
          <div class="picker-body" :class="{ open: pickerOpen }">
            <label class="search">
              <Search class="ic" :size="14" />
              <input
                v-model="query"
                type="search"
                :aria-label="t('region.searchLabel')"
                :placeholder="t('region.search')"
              />
            </label>
            <div class="list-head">
              <p class="col-title">{{ t('region.countries') }}</p>
              <div class="sort" role="group" :aria-label="t('region.sortLabel')">
                <button
                  type="button"
                  class="sort-btn"
                  :class="{ active: sortMode === 'name' }"
                  :aria-pressed="sortMode === 'name'"
                  @click="sortMode = 'name'"
                >
                  {{ t('region.sortName') }}
                </button>
                <button
                  type="button"
                  class="sort-btn"
                  :class="{ active: sortMode === 'count' }"
                  :aria-pressed="sortMode === 'count'"
                  @click="sortMode = 'count'"
                >
                  {{ t('region.sortCount') }}
                </button>
              </div>
            </div>
            <ul class="country-list">
              <li v-for="s in filtered" :key="s.code">
                <button
                  type="button"
                  class="country-btn"
                  :class="{ active: s.code === selected }"
                  :aria-pressed="s.code === selected"
                  :data-code="s.code"
                  @click="selectCountry(s.code)"
                >
                  <span class="country-name">{{ countryName(s.code) }}</span>
                  <span class="country-count">{{ t('region.count', { n: s.count }) }}</span>
                </button>
                <!-- 二级：省级行政区（无数据则不出；点击国家展开/折叠；点击国家本身=全部，见 021） -->
                <ul v-if="s.code === selected && expanded && provinces.length" class="prov-list">
                  <li v-for="p in provinces" :key="p.code">
                    <button
                      type="button"
                      class="prov-btn"
                      :class="{ active: p.code === province }"
                      :aria-pressed="p.code === province"
                      :data-prov="p.code"
                      @click="pickProvince(p.code)"
                    >
                      <span class="prov-name">{{ p.name }}</span>
                      <span class="prov-count">{{ t('region.count', { n: p.count }) }}</span>
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </aside>

        <div class="species">
          <!-- 042：标签页顺序为「观鸟点」（默认）/「地区浏览」 -->
          <div class="panel-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="panel-tab"
              :class="{ active: activeTab === 'spots' }"
              :aria-selected="activeTab === 'spots'"
              @click="setTab('spots')"
            >
              {{ t('region.tabHotspots') }}
              <span class="tab-count">
                {{ nearby ? '' : hotspotList.length }}
                <template v-if="!nearby && province && !hotspotResult.fallback && hotspotCountryCount > hotspotList.length">
                  {{ t('region.hotspotOfCountry', { n: hotspotCountryCount }) }}
                </template>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              class="panel-tab"
              :class="{ active: activeTab === 'regions' }"
              :aria-selected="activeTab === 'regions'"
              @click="setTab('regions')"
            >
              {{ t('region.tabRegions') }}
              <span class="tab-count">{{ gridItems.length }}</span>
            </button>
          </div>

          <!-- ---------- 标签页 1：观鸟点（默认） ---------- -->
          <div v-show="activeTab === 'spots'" class="spots-pane">
            <!-- 附近鸟点开关：默认关；开启后本页转为按定位排序的附近点位 -->
            <div class="nearby-bar">
              <button
                type="button"
                class="nearby-toggle"
                :class="{ on: nearby }"
                :aria-pressed="nearby"
                @click="toggleNearby"
              >
                <MapPin v-if="nearby" class="ic" :size="15" />
                <Crosshair v-else class="ic" :size="15" />
                {{ nearby ? t('nearby.backToRegion') : t('nearby.open') }}
              </button>
              <p class="nearby-hint muted">
                {{ nearby ? t('nearby.on') : t('nearby.off') }}
              </p>
            </div>

            <!-- 附近模式：定位 + 半径 + 附近点位（原 /nearby 页面） -->
            <NearbySpotsPanel v-if="nearby" />

            <!-- 地区模式：按所选国家/省份的观鸟点 -->
            <div v-else class="hotspots">
              <p v-if="!hotspotList.length" class="muted">{{ t('region.hotspotEmpty') }}</p>
              <template v-else>
                <p v-if="province && hotspotResult.fallback" class="hotspot-fallback muted">
                  {{ t('region.hotspotFallback', { n: hotspotList.length }) }}
                </p>
                <p v-else-if="province" class="hotspot-scope muted">
                  {{ t('region.hotspotProvinceOnly') }}
                </p>
                <ul class="hotspot-list">
                  <li v-for="h in hotspotList" :key="h.id">
                    <button
                      type="button"
                      class="hotspot-btn"
                      :data-hot="h.id"
                      :aria-expanded="expandedHotspot === h.id"
                      @click="toggleHotspot(h.id)"
                    >
                      <span class="hotspot-name">
                        {{ h.name || `${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}` }}
                      </span>
                      <span class="hotspot-stat muted">
                        {{ t('region.hotspotSpeciesN', { n: h.speciesCount }) }}
                        <template v-if="h.latestObs"> · {{ t('region.hotspotLatest', { d: h.latestObs }) }}</template>
                      </span>
                    </button>
                    <div v-if="expandedHotspot === h.id" class="hotspot-detail">
                      <!-- 明确区分"本点"与"这一带"：本点用 eBird 鸟种数；网格是周边统计，不冒充本点 -->
                      <p v-if="h.gridRecords" class="hotspot-meta muted">
                        {{ t('region.hotspotGridNearby', { km: h.gridKm ?? 0, r: h.gridRecords }) }}
                      </p>
                      <p class="hotspot-sub">{{ t('region.hotspotTopSpecies') }}</p>
                      <a class="hotspot-ext" :href="ebirdHotspotUrl(h.id)" target="_blank" rel="noopener noreferrer">
                        {{ t('region.hotspotOnEbird') }}
                      </a>
                      <ul class="hotspot-spp">
                        <li v-for="(s, si) in h.topSpecies" :key="si">
                          <RouterLink v-if="s.id && speciesById(s.id)" :to="`/species/${s.id}`">
                            {{ topSpeciesName(s) }}
                          </RouterLink>
                          <span v-else>{{ topSpeciesName(s) }}</span>
                          <span class="muted"> ×{{ s.count }}</span>
                        </li>
                      </ul>
                    </div>
                  </li>
                </ul>
                <p class="hotspot-source muted">
                  {{ t('region.hotspotSource', { sources: hotspotSources, n: CELL_DEG }) }}
                </p>
              </template>
            </div>
          </div>

          <!-- ---------- 标签页 2：地区浏览（只保留鸟种） ---------- -->
          <div v-show="activeTab === 'regions'" class="regions-pane">
            <p class="col-title">
              {{
                province
                  ? t('region.speciesTitleProvince', { province: provinceName })
                  : t('region.speciesTitle', { country: countryName(selected) })
              }}
            </p>
            <ul class="species-grid">
              <li v-for="gi in visibleItems" :key="gi.slug">
                <RouterLink class="species-card" :class="{ 'not-in-bank': !gi.playable }" :to="`/species/${gi.slug}`">
                  <img
                    v-if="gi.thumb"
                    class="thumb"
                    :src="gi.thumb"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span class="sp-text">
                    <span class="sp-name">{{ gi.name }}</span>
                    <span class="sp-sci">{{ gi.nameSci }}</span>
                    <span v-if="province && gi.bankId" class="sp-count muted">
                      {{ t('region.provinceRecords', { n: countInProvince(gi.bankId) }) }}
                    </span>
                    <span v-else-if="!gi.playable" class="sp-badge">{{ t('region.notInBank') }}</span>
                  </span>
                </RouterLink>
              </li>
            </ul>
            <div v-if="gridItems.length > visibleItems.length" class="grid-more">
              <button class="btn btn-sm" type="button" @click="visibleCount += 200">
                {{ t('region.showMore') }}
              </button>
            </div>
            <p v-if="provinces.length" class="prov-source muted">
              {{ t('region.provinceSource', { sources: provinceSources }) }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <p v-else-if="failed" class="muted empty" role="alert">{{ t('errors.unknown') }}</p>
    <p v-else class="muted empty" role="status">{{ t('common.loading') }}</p>
  </section>
</template>

<style scoped>
.region-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.region-head .ic {
  color: var(--primary);
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 12px;
  text-align: center;
}
.continents {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-bottom: 8px;
}
.continent-btn {
  padding: 6px 16px;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.16s ease;
}
.continent-btn:hover {
  border-color: var(--primary-light);
}
.continent-btn.active {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.layout {
  display: grid;
  grid-template-columns: minmax(200px, 260px) 1fr;
  gap: 16px;
  text-align: left;
}
.search {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  background: #fff;
}
.search .ic {
  color: var(--text-light);
  flex-shrink: 0;
}
.search:focus-within {
  border-color: var(--primary-light);
}
.search input {
  border: none;
  outline: none;
  width: 100%;
  font-size: 0.85rem;
  background: transparent;
  color: var(--text);
}
.col-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
  margin: 12px 0 6px;
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.list-head .col-title {
  margin: 12px 0 6px;
}
.sort {
  display: inline-flex;
  border: 2px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.sort-btn {
  padding: 3px 10px;
  border: none;
  background: #fff;
  color: var(--text-light);
  font-size: 0.72rem;
  cursor: pointer;
}
.sort-btn + .sort-btn {
  border-left: 2px solid var(--border);
}
.sort-btn.active {
  background: var(--primary);
  color: #fff;
  font-weight: 700;
}
.country-list {
  list-style: none;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 4px;
}
.country-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  background: #f7faf8;
  color: var(--text);
  cursor: pointer;
  font-size: 0.85rem;
  text-align: left;
}
.country-btn:hover {
  border-color: var(--primary-light);
}
.country-btn.active {
  border-color: var(--primary);
  background: #eaf4ef;
  font-weight: 700;
}
.country-count {
  font-size: 0.72rem;
  color: var(--text-light);
  flex-shrink: 0;
}
.prov-list {
  list-style: none;
  margin: 4px 0 6px 12px;
  padding-left: 8px;
  border-left: 2px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* 移动端折叠式「选择地区」；桌面端始终展开 */
.picker-toggle {
  display: none;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f7faf8;
  color: var(--text);
  font-size: 0.88rem;
  cursor: pointer;
}
.picker-label {
  font-weight: 700;
  flex-shrink: 0;
}
.picker-current {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  color: var(--text-light);
  font-size: 0.8rem;
}
.picker-toggle .ic {
  flex-shrink: 0;
  color: var(--text-light);
  transition: transform 0.16s ease;
}
.picker-toggle .ic.open {
  transform: rotate(180deg);
}
.prov-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}
.prov-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-count {
  flex-shrink: 0;
  font-size: 0.68rem;
  color: var(--text-light);
}
.prov-btn:hover {
  border-color: var(--primary-light);
  background: #f7faf8;
}
.prov-btn.active {
  border-color: var(--primary);
  background: #eaf4ef;
  font-weight: 700;
}
.sp-count {
  font-size: 0.68rem;
}
.sp-badge {
  align-self: flex-start;
  font-size: 0.62rem;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-light);
}
.not-in-bank .sp-name {
  color: var(--text-light);
}
.grid-more {
  margin-top: 12px;
  text-align: center;
}
.prov-source {
  margin-top: 10px;
  font-size: 0.68rem;
}
/* 右侧面板标签页（2026-10-09：鸟种 / 观鸟点并列，替代上下堆叠） */
.panel-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  border-bottom: 2px solid var(--border);
}
.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  border-bottom: 3px solid transparent;
  background: none;
  color: var(--text-light);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: -2px;
}
.panel-tab:hover {
  color: var(--primary);
}
.panel-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.panel-tab .tab-count {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-light);
  background: #eef3f0;
  border-radius: 999px;
  padding: 1px 7px;
}
.panel-tab.active .tab-count {
  background: var(--primary);
  color: #fff;
}
.hotspot-scope,
.hotspot-fallback {
  margin: 0 0 8px;
  font-size: 0.72rem;
}
/* 042：附近鸟点开关条 */
.nearby-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
}
.nearby-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.nearby-toggle:hover {
  background: #dceee4;
}
.nearby-toggle.on {
  background: var(--grad);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 10px 20px -12px rgba(45, 106, 79, 0.9);
}
.nearby-hint {
  font-size: 0.76rem;
}
.hotspots {
  margin-top: 4px;
}
.hotspot-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hotspot-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font-size: 0.82rem;
  cursor: pointer;
  text-align: left;
}
.hotspot-btn:hover {
  border-color: var(--primary-light);
}
.hotspot-btn[aria-expanded='true'] {
  border-color: var(--primary);
  background: #eaf4ef;
}
.hotspot-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.hotspot-stat {
  flex-shrink: 0;
  font-size: 0.7rem;
}
.hotspot-detail {
  margin: 6px 0 8px 12px;
  padding: 8px 10px;
  border-left: 2px solid var(--border);
  font-size: 0.78rem;
}
.hotspot-meta {
  margin: 0 0 6px;
}
.hotspot-sub {
  margin: 0 0 4px;
  font-weight: 700;
  color: var(--text-light);
  font-size: 0.74rem;
}
.hotspot-spp {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.hotspot-spp a {
  color: var(--primary);
}
.hotspot-source {
  margin-top: 10px;
  font-size: 0.68rem;
}
.species-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.species-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  transition: all 0.18s ease;
}
.species-card:hover {
  border-color: var(--primary-light);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
}
.thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--radius-xs);
  background: #f0f4f2;
}
.sp-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.sp-name {
  font-weight: 700;
  font-size: 0.9rem;
}
.sp-sci {
  font-size: 0.72rem;
  font-style: italic;
  color: var(--text-light);
}
.empty {
  margin: 14px 0;
}

/* 移动端：折叠式选择器（置于末尾以确保覆盖上面的 display:none 基线） */
@media (max-width: 640px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .picker-toggle {
    display: flex;
  }
  .picker-body {
    display: none;
    margin-top: 8px;
  }
  .picker-body.open {
    display: block;
  }
  .country-list {
    max-height: 46vh;
  }
}
</style>
