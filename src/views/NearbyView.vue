<script setup lang="ts">
/**
 * 039 P1：按位置找附近观鸟点（`/nearby`）。
 *
 * 两档定位（docs/039 §2.1）：
 *  - **粗定位（默认，自动）**：Worker `/api/geo` 读 Cloudflare `request.cf` 的 IP 归属地，
 *    四舍五入 0.05°（≈5km）后返回；**不落库、不进日志**（坐标只在页面内存里参与算距离）。
 *  - **精定位（需点按 + 系统授权）**：`navigator.geolocation`，米级；坐标**只留在设备**（不上报）。
 *
 * 距离全部本地算（haversine，见 core/nearbySpots）：坐标不出设备、零第三方依赖、可离线（SW 缓存快照）。
 * 列表为**文本 + 距离**，不做地图（铁律 6：不引入地图/边界）。
 *
 * 数据：eBird 热点派生子集（≥50 种成熟点位 + 0.25° 网格去重，构建见 region:nearby-spots）
 * + 该点 120km 内最近 GBIF 1° 网格统计（"这一带有什么"）。署名随页展示（铁律 5）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Compass, Crosshair, Leaf, Loader, MapPin, Radio } from 'lucide-vue-next'
import { speciesName, speciesById, loadBank } from '@/core/bank'
import {
  availableCountries,
  fetchCoarseGeo,
  fetchPreciseGeo,
  loadNearbyCountry,
  loadNearbyIndex,
  nearbySpots,
  type NearbyCountryFile,
  type NearbyHit,
  type NearbyGrid,
  type NearbyIndex,
} from '@/core/nearbySpots'
import { currentLocale } from '@/i18n'
import { REGION_LABEL_KEY } from '@/core/region'

const { t } = useI18n()

type Radius = 10 | 25 | 50
const RADII: Radius[] = [10, 25, 50]

const index = ref<NearbyIndex | null>(null)
const file = ref<NearbyCountryFile | null>(null)
const loadingIndex = ref(true)
const loadingSpots = ref(false)

/** 当前坐标来源：coarse（IP 粗定位）/ precise（设备精定位）/ null（无） */
const source = ref<'coarse' | 'precise' | null>(null)
const coords = ref<{ lat: number; lng: number } | null>(null)
/** 定位失败/不可用说明键（i18n） */
const geoNote = ref<'none' | 'noCoarse' | 'noPrecise'>('none')
const preciseBusy = ref(false)

/** 使用者手动选择的国家（粗定位识别不出时用；只列有数据的国家） */
const country = ref('')
const radius = ref<Radius>(25)
const expanded = ref<string | null>(null)

const countries = computed(() => availableCountries(index.value, source.value === 'coarse' ? geoCountry.value : null))
const geoCountry = ref<string | null>(null)

onMounted(async () => {
  void loadBank().catch(() => null) // 代表鸟种本地化名（失败回退学名）
  const [idx, geo] = await Promise.all([loadNearbyIndex(), fetchCoarseGeo()])
  index.value = idx
  loadingIndex.value = false
  if (geo?.located && geo.lat != null && geo.lng != null) {
    coords.value = { lat: geo.lat, lng: geo.lng }
    source.value = 'coarse'
    geoCountry.value = geo.country ?? null
  } else {
    geoNote.value = 'noCoarse'
  }
  // 默认国家：粗定位识别的国家（有数据才用），否则第一个
  const list = countries.value
  country.value = list[0] ?? ''
  if (geoNote.value === 'noCoarse' && !list.length) geoNote.value = 'none'
})

watch(country, async (cc) => {
  file.value = null
  expanded.value = null
  if (!cc) return
  loadingSpots.value = true
  file.value = await loadNearbyCountry(cc)
  loadingSpots.value = false
})

/** 设备精定位（显式点按；拒绝/超时 → 保持粗定位） */
async function usePrecise() {
  if (preciseBusy.value) return
  preciseBusy.value = true
  try {
    const p = await fetchPreciseGeo()
    if (p) {
      coords.value = p
      source.value = 'precise'
      geoNote.value = 'none'
    } else {
      geoNote.value = 'noPrecise'
    }
  } finally {
    preciseBusy.value = false
  }
}

const hits = computed<NearbyHit[]>(() => {
  const c = coords.value
  if (!c || !file.value) return []
  return nearbySpots(file.value, c.lat, c.lng, { radiusKm: radius.value })
})

const gridOf = (h: NearbyHit): NearbyGrid | null =>
  (h.grid ? (file.value?.grids?.[h.grid] ?? null) : null)

const topName = (s: { id?: string; sci?: string }) => {
  const sp = s.id ? speciesById(s.id) : undefined
  return sp ? speciesName(sp, currentLocale()) : (s.sci ?? s.id ?? '')
}
const hotspotUrl = (id: string) => `https://ebird.org/hotspot/${id}`
const sourcesLine = computed(() => (index.value?.sources ?? []).map((s) => s.name).join(' · '))

/** ISO 3166-1 alpha-2 → 本地化地区名（港澳台走固定标注；与 /region 同一口径，铁律 6） */
function countryName(cc: string): string {
  const key = REGION_LABEL_KEY[cc]
  if (key) return t(key)
  try {
    return new Intl.DisplayNames([currentLocale()], { type: 'region' }).of(cc) ?? cc
  } catch {
    return cc
  }
}
</script>

<template>
  <section class="nearby">
    <h2><Compass class="ic" :size="22" /> {{ t('nearby.title') }}</h2>
    <p class="lead muted">{{ t('nearby.lead') }}</p>

    <p v-if="loadingIndex" class="muted center"><Loader class="ic spin" :size="15" /> {{ t('common.loading') }}</p>

    <template v-else-if="!index">
      <p class="muted">{{ t('nearby.unavailable') }}</p>
    </template>

    <template v-else>
      <!-- 定位状态与操作 -->
      <div class="geo card">
        <p class="geo-line">
          <MapPin class="ic" :size="15" />
          <template v-if="coords && source === 'coarse'">
            {{ t('nearby.usingCoarse', { deg: index.cellDeg }) }}
          </template>
          <template v-else-if="coords">
            {{ t('nearby.usingPrecise') }}
          </template>
          <template v-else>
            {{ t('nearby.noCoords') }}
          </template>
        </p>
        <button class="btn btn-secondary" type="button" :disabled="preciseBusy" @click="usePrecise">
          <Crosshair class="ic" :size="14" />
          {{ preciseBusy ? t('nearby.locating') : t('nearby.usePrecise') }}
        </button>
        <p v-if="geoNote === 'noPrecise'" class="muted small">{{ t('nearby.preciseDenied') }}</p>
        <p v-if="!coords" class="muted small">{{ t('nearby.manualHint') }}</p>
        <p class="muted tiny">{{ t('nearby.privacy') }}</p>
      </div>

      <!-- 国家：粗定位识别不出 / 想换地方看时手选（只列有数据的国家） -->
      <div v-if="countries.length > 1" class="filters">
        <span class="lab">{{ t('nearby.country') }}</span>
        <select v-model="country" class="sel" :aria-label="t('nearby.country')">
          <option v-for="cc in countries" :key="cc" :value="cc">{{ countryName(cc) }}（{{ cc }}）</option>
        </select>
      </div>

      <!-- 半径 -->
      <div class="filters">
        <span class="lab">{{ t('nearby.radius') }}</span>
        <button
          v-for="r in RADII"
          :key="r"
          type="button"
          class="pill"
          :class="{ on: radius === r }"
          @click="radius = r"
        >
          {{ t('nearby.radiusKm', { n: r }) }}
        </button>
      </div>

      <p v-if="loadingSpots" class="muted center"><Loader class="ic spin" :size="15" /> {{ t('common.loading') }}</p>

      <template v-else>
        <p v-if="!coords" class="muted">{{ t('nearby.needCoords') }}</p>
        <p v-else-if="!hits.length" class="muted">
          {{ t('nearby.empty', { n: radius }) }}
        </p>
        <ol v-else class="list">
          <li v-for="h in hits" :key="h.i" class="spot">
            <button class="spot-btn" type="button" :aria-expanded="expanded === h.i" @click="expanded = expanded === h.i ? null : h.i">
              <span class="spot-name">{{ h.n || `${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}` }}</span>
              <span class="spot-meta muted">
                <Radio class="ic" :size="12" /> {{ t('nearby.km', { n: h.distanceKm }) }}
                <template v-if="h.p"> · {{ t('nearby.speciesN', { n: h.p }) }}</template>
                <template v-if="h.o"> · {{ t('nearby.latest', { d: h.o }) }}</template>
              </span>
            </button>
            <div v-if="expanded === h.i" class="spot-detail">
              <p v-if="h.sub" class="muted small">{{ t('nearby.province', { code: h.sub }) }}</p>
              <!-- 这一带有什么：最近的 GBIF 1° 网格统计（明示是"周边网格"，不是本点记录） -->
              <template v-if="gridOf(h)">
                <p class="muted small">
                  {{ t('nearby.gridNearby', { km: h.km ?? 0, r: gridOf(h)!.r, s: gridOf(h)!.s }) }}
                </p>
                <ul v-if="gridOf(h)!.top?.length" class="tops">
                  <li v-for="(s, i) in gridOf(h)!.top" :key="i">
                    <RouterLink v-if="s.id && speciesById(s.id)" :to="`/species/${s.id}`">{{ topName(s) }}</RouterLink>
                    <span v-else>{{ topName(s) }}</span>
                  </li>
                </ul>
              </template>
              <a class="ext" :href="hotspotUrl(h.i)" target="_blank" rel="noopener noreferrer">
                <Leaf class="ic" :size="12" /> {{ t('nearby.onEbird') }}
              </a>
            </div>
          </li>
        </ol>
      </template>

      <p class="muted tiny src">{{ t('nearby.source', { sources: sourcesLine }) }}</p>
      <p class="muted tiny src">{{ t('nearby.method', { min: index.minSpecies, cell: index.cellDeg, km: Math.round(index.cellDeg * 111) }) }}</p>
    </template>
  </section>
</template>

<style scoped>
.nearby {
  padding: 4px 0 24px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
}
.lead {
  margin: 0 0 14px;
  line-height: 1.7;
  font-size: 0.88rem;
}
.geo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.geo-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
}
.filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.lab {
  font-size: 0.8rem;
  color: var(--text-light);
}
.sel {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
  max-width: 60vw;
}
.pill {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-light);
  cursor: pointer;
}
.pill.on {
  background: var(--grad);
  border-color: transparent;
  color: #fff;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.spot {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  overflow: hidden;
}
.spot-btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.spot-name {
  font-weight: 700;
  font-size: 0.9rem;
}
.spot-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.76rem;
}
.spot-detail {
  padding: 0 12px 12px;
  border-top: 1px dashed var(--border);
  margin-top: 2px;
  padding-top: 10px;
}
.tops {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  padding: 6px 0 0;
  margin: 0;
  font-size: 0.8rem;
}
.ext {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 0.76rem;
}
.src {
  margin-top: 12px;
}
.tiny {
  font-size: 0.72rem;
  line-height: 1.6;
}
.small {
  font-size: 0.78rem;
}
.center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
