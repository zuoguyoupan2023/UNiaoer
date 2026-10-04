<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Globe2, Search } from 'lucide-vue-next'
import { loadBank, speciesById, speciesName, type BankSpecies, type Manifest } from '@/core/bank'
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
  hotspotsOf,
  loadHotspots,
  type HotspotData,
  type HotspotTopSpecies,
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
const bank = ref<Manifest | null>(null)
const bySpecies = ref<Record<string, string[]> | null>(null)
const provinceData = ref<ProvinceData | null>(null)
const hotspotData = ref<HotspotData | null>(null)
const hotspotsOpen = ref(false)
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
/** 选中国家的省级二级列表是否展开（点击已选国家切换） */
const expanded = ref(true)
/** 移动端「选择地区」面板是否展开（桌面端始终显示，见 style 媒体查询） */
const pickerOpen = ref(false)
/** 目录排序：名称（zh 拼音 / en 首字母）或鸟种数；一级二级共用 */
const sortMode = ref<'name' | 'count'>('name')

onMounted(async () => {
  try {
    bank.value = await loadBank()
    const res = await fetch(`${import.meta.env.BASE_URL}data/distribution.json`)
    const data = res.ok
      ? ((await res.json()) as { bySpecies?: Record<string, string[]> })
      : { bySpecies: {} }
    bySpecies.value = data.bySpecies ?? {}
    // 省级层：缺失则整层不显示（021 §2.5 薄数据回退国家层）
    provinceData.value = await loadProvinces()
    // 观鸟点（021 M4 腿 B）：缺失则整块不显示
    hotspotData.value = await loadHotspots()
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
      items.push({
        slug: sp ? sp.id : slugifySci(e!.nameSci),
        name: sp ? nameOf(sp) : entryDisplayName(e!, currentLocale()),
        nameSci: sp?.nameSci ?? e!.nameSci,
        playable: !!sp,
        thumb: sp?.images?.[0]?.thumbUrl || sp?.images?.[0]?.url || null,
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

/** 该国观鸟点（腿 B 网格聚合；缺失/无数据则为空，整块隐藏） */
const hotspotList = computed(() => hotspotsOf(hotspotData.value, selected.value))
const hotspotSources = computed(() =>
  (hotspotData.value?.sources ?? []).map((s) => s.name).join(' · '),
)
function toggleHotspot(id: string) {
  expandedHotspot.value = expandedHotspot.value === id ? '' : id
}
/** 代表鸟种显示名：有 manifest id 用本地化名，否则回退学名 */
function topSpeciesName(s: HotspotTopSpecies): string {
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
  <section class="card region">
    <h2 class="region-head"><Globe2 class="ic" :size="22" /> {{ t('region.title') }}</h2>
    <p class="muted lead">{{ t('region.lead') }}</p>

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

          <!-- 观鸟点（021 M4 腿 B）：默认收起，展开后列表 + 就地详情 -->
          <div v-if="hotspotList.length" class="hotspots">
            <button
              type="button"
              class="hotspots-toggle"
              :aria-expanded="hotspotsOpen"
              @click="hotspotsOpen = !hotspotsOpen"
            >
              <span>{{ t('region.hotspotTitle') }}</span>
              <span class="hotspot-badge">{{ hotspotList.length }}</span>
            </button>
            <div v-if="hotspotsOpen" class="hotspot-body">
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
                      {{ t('region.hotspotRecords', { n: h.recordCount }) }}
                    </span>
                  </button>
                  <div v-if="expandedHotspot === h.id" class="hotspot-detail">
                    <p class="hotspot-meta muted">
                      {{ t('region.hotspotSpeciesN', { n: h.speciesCount }) }} ·
                      {{ t('region.hotspotObservers', { n: h.observerCount }) }}
                    </p>
                    <p class="hotspot-sub">{{ t('region.hotspotTopSpecies') }}</p>
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
                {{ t('region.hotspotSource', { sources: hotspotSources }) }}
              </p>
            </div>
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
.hotspots {
  margin-top: 14px;
}
.hotspots-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f7faf8;
  color: var(--text);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}
.hotspots-toggle:hover {
  border-color: var(--primary-light);
}
.hotspot-badge {
  background: var(--primary);
  color: #fff;
  border-radius: 999px;
  font-size: 0.68rem;
  padding: 1px 7px;
}
.hotspot-body {
  margin-top: 10px;
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
  border-radius: 8px;
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
