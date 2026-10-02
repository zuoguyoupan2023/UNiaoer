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
  provincesOf,
  speciesInProvince,
  type ProvinceData,
} from '@/core/provinces'
import { currentLocale } from '@/i18n'

const { t, locale } = useI18n()
const bank = ref<Manifest | null>(null)
const bySpecies = ref<Record<string, string[]> | null>(null)
const provinceData = ref<ProvinceData | null>(null)
const failed = ref(false)
const query = ref('')
/** 先亚洲、默认中国（017：先中国） */
const continent = ref<Continent>('asia')
const selected = ref('CN')
/** 已选省级 code（空 = 国家级） */
const province = ref('')
/** 选中国家的省级二级列表是否展开（点击已选国家切换） */
const expanded = ref(true)
/** 移动端「选择地区」面板是否展开（桌面端始终显示，见 style 媒体查询） */
const pickerOpen = ref(false)

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
  } catch {
    failed.value = true
  }
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

const stats = computed(() => (bySpecies.value ? countryStats(bySpecies.value) : []))
const continents = computed(() => presentContinents(stats.value))
const continentStats = computed(() => countriesInContinent(stats.value, continent.value))
const filtered = computed(() => filterCountries(continentStats.value, query.value, countryName))
const index = computed(() => (bySpecies.value ? buildCountryIndex(bySpecies.value) : {}))
const provinces = computed(() =>
  provincesOf(provinceData.value, selected.value, locale.value),
)
const provinceName = computed(
  () => provinces.value.find((p) => p.code === province.value)?.name ?? '',
)
const provinceSet = computed(() =>
  province.value ? speciesInProvince(provinceData.value, selected.value, province.value) : null,
)
const species = computed<BankSpecies[]>(() =>
  (index.value[selected.value] ?? [])
    .filter((id) => !provinceSet.value || provinceSet.value.has(id))
    .map((id) => speciesById(id))
    .filter((sp): sp is BankSpecies => !!sp),
)
const nameOf = (sp: BankSpecies) => speciesName(sp, currentLocale())
const countInProvince = (sp: BankSpecies) =>
  province.value ? provinceCount(provinceData.value, sp.id, selected.value, province.value) : 0
const provinceSources = computed(() =>
  (provinceData.value?.sources ?? []).map((s) => s.name).join(' · '),
)

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

/** 切换国家：省级筛选重置并展开二级列表 */
watch(selected, () => {
  province.value = ''
  expanded.value = true
})

/** 点击国家：已选则折叠/展开省级；未选则选中并展开 */
function selectCountry(code: string) {
  if (code === selected.value) expanded.value = !expanded.value
  else selected.value = code
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
            <p class="col-title">{{ t('region.countries') }}</p>
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
                <!-- 二级：省级行政区（无数据则不出；点击国家展开/折叠，见 021 M2/M3） -->
                <ul v-if="s.code === selected && expanded && provinces.length" class="prov-list">
                  <li>
                    <button
                      type="button"
                      class="prov-btn"
                      :class="{ active: !province }"
                      :aria-pressed="!province"
                      :data-prov="''"
                      @click="pickProvince('')"
                    >
                      {{ t('region.allProvinces') }}
                    </button>
                  </li>
                  <li v-for="p in provinces" :key="p.code">
                    <button
                      type="button"
                      class="prov-btn"
                      :class="{ active: p.code === province }"
                      :aria-pressed="p.code === province"
                      :data-prov="p.code"
                      @click="pickProvince(p.code)"
                    >
                      {{ p.name }}
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
            <li v-for="sp in species" :key="sp.id">
              <RouterLink class="species-card" :to="`/species/${sp.id}`">
                <img
                  v-if="sp.images?.length"
                  class="thumb"
                  :src="sp.images[0]!.thumbUrl || sp.images[0]!.url"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span class="sp-text">
                  <span class="sp-name">{{ nameOf(sp) }}</span>
                  <span class="sp-sci">{{ sp.nameSci }}</span>
                  <span v-if="province" class="sp-count muted">
                    {{ t('region.provinceRecords', { n: countInProvince(sp) }) }}
                  </span>
                </span>
              </RouterLink>
            </li>
          </ul>

          <p v-if="provinces.length" class="prov-source muted">
            {{ t('region.provinceSource', { sources: provinceSources }) }}
          </p>
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
.prov-source {
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
