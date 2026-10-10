<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from 'lucide-vue-next'
import type { MediaAsset } from '@/types'
import {
  loadBank,
  speciesName,
  speciesNoteText,
  loadSpeciesAssets,
  type BankSpecies,
  type Manifest,
} from '@/core/bank'
import { loadMeta, metaSpecies, type MetaSpecies } from '@/core/meta'
import { globalPoolReady } from '@/core/globalPool'
import { currentLocale } from '@/i18n'
import { loadSeasonality, seasonalityOf, type SeasonalityData } from '@/core/seasonality'
import { REGION_LABEL_KEY } from '@/core/region'
import {
  loadSpeciesDistribution,
  loadSpeciesIndex,
  shortCodeOf,
  type SpeciesIndexEntry,
} from '@/core/speciesIndex'
import AttributionLine from '@/components/AttributionLine.vue'
import SpeciesFacts from '@/components/SpeciesFacts.vue'
import SpeciesGallery from '@/components/SpeciesGallery.vue'
import SpeciesSeasonality from '@/components/SpeciesSeasonality.vue'
import SpeciesProvinces from '@/components/SpeciesProvinces.vue'

const route = useRoute()
const { t } = useI18n()
const bank = ref<Manifest | null>(null)
const seasonData = ref<SeasonalityData | null>(null)
/** 050 P2：权威名录层是否就绪（null=未加载/加载失败 → 完全退回旧行为） */
const metaReadyFlag = ref(false)

async function ensureBank() {
  if (bank.value && metaReadyFlag.value) return
  // 权威层与 core 并行加载，互不阻塞：任一失败都退回旧链路（lite 详情），不白屏
  if (!bank.value) {
    try {
      bank.value = await loadBank()
    } catch {
      /* 保持 null → 走 notFound */
    }
  }
  if (!metaReadyFlag.value) {
    metaReadyFlag.value = !!(await loadMeta().catch(() => null))
  }
}
onMounted(() => {
  ensureBank()
  // 季节性数据（021 M1）：按需加载，失败/缺失则整块不显示
  void loadSeasonality().then((d) => (seasonData.value = d))
  // 050 P2：全球池（11MB 懒加载）——只有 core 未命中时才需要（详情页拿全球种的媒体）
  void loadBank()
    .then(() => import('@/core/globalPool').then((m) => m.loadGlobalPool()))
    .catch(() => null)
    .finally(() => {
      poolReady.value = true // 非响应式缓存需要一个显式触发点
    })
})
watch(() => route.params.speciesId, ensureBank)

/**
 * 050 P2：物种解析改为**三级**——core（含首图首音）→ 全球池（含首图首音）→ 权威层（元数据）。
 *
 * 效果：此前 9,545 种因只在 core 里 find 而一律落到「轻量详情」空壳页；
 * 现在它们会命中权威层的元数据，并从全球池取到自己的首图首音 → 走**完整详情模板**
 * （hero 图 / 音频 / 逐条署名 / 类群 / 分布）。
 *
 * 注意顺序：**媒体来源优先用 core 或全球池的真实条目**（它们带 image/audio），
 * 权威层刻意不含媒体，只补 profile/notes/taxonId 等元数据。
 */
const coreSpecies = computed<BankSpecies | undefined>(() =>
  bank.value?.species.find((sp) => sp.id === route.params.speciesId),
)
/** 全球池条目（9,545 种，懒加载后才有；未加载时回退 core） */
const poolSpecies = computed<BankSpecies | undefined>(() => {
  const id = String(route.params.speciesId ?? '')
  if (!poolReady.value) return coreSpecies.value
  return (globalPoolReady() ?? []).find((sp) => sp.id === id) ?? coreSpecies.value
})
/** 全球池是否已加载（模块级缓存非响应式，需一个 ref 让 computed 重算） */
const poolReady = ref(false)
/** 权威层元数据（10,844 种，唯一的名称/科目/profile/notes 口径）。
 *  `metaReadyFlag` 参与依赖：`meta.ts` 的索引是模块级 Map（非响应式），
 *  加载完成后必须靠这个 ref 触发重算，否则 computed 会一直返回缓存的 undefined。 */
const metaEntry = computed<MetaSpecies | undefined>(() =>
  metaReadyFlag.value ? metaSpecies(String(route.params.speciesId ?? '')) : undefined,
)

const species = computed<BankSpecies | undefined>(() => {
  const pool = poolSpecies.value
  const m = metaEntry.value
  if (!pool && !m) return undefined
  // 池条目带媒体；权威层带元数据 → 合并成一个对象喂给既有模板
  return { ...m, ...pool } as BankSpecies
})
const seasonEntry = computed(() =>
  seasonalityOf(seasonData.value, String(route.params.speciesId)),
)
const note = computed(() =>
  speciesNoteText(metaEntry.value?.notes ?? species.value?.notes, currentLocale()),
)
const name = computed(() => (species.value ? speciesName(species.value, currentLocale()) : ''))

/**
 * 029 M1:core 层 species 只带首图首音（image/audio）；画廊/海报需要的完整 5+5 素材
 * 从 assets 分片按需加载（按桶缓存）。未就绪时先用 core 的首图首音，不阻塞首屏。
 */
const fullAssets = ref<{ images?: MediaAsset[]; audios?: MediaAsset[] } | null>(null)
watch(
  () => species.value?.id,
  async (id) => {
    fullAssets.value = null
    if (id) fullAssets.value = await loadSpeciesAssets(id)
  },
  { immediate: true },
)
const images = computed<MediaAsset[]>(
  () =>
    fullAssets.value?.images ??
    species.value?.images ??
    (species.value?.image ? [species.value.image] : []),
)
const audios = computed<MediaAsset[]>(
  () =>
    fullAssets.value?.audios ??
    species.value?.audios ??
    (species.value?.audio ? [species.value.audio] : []),
)
const hero = computed<MediaAsset | null>(() => images.value[0] ?? null)
/** 全部素材 → 逐条署名（任何展示媒体的页面署名不可省） */
const media = computed<MediaAsset[]>(() => [...images.value, ...audios.value])

/** 025 M4:轻量详情——bank 未命中的 slug 回退骨架(全球种无媒体,有页可看) */
const liteEntry = ref<SpeciesIndexEntry | null>(null)
const liteCountries = ref<string[]>([])
const liteResolved = ref(false)

async function resolveLite(id: string) {
  liteResolved.value = false
  liteEntry.value = null
  liteCountries.value = []
  if (!id) return
  const idx = await loadSpeciesIndex()
  const entry = idx?.bySlug.get(id) ?? null
  liteEntry.value = entry
  liteResolved.value = true
  if (!entry) return
  const dist = await loadSpeciesDistribution()
  if (!dist) return
  const code = shortCodeOf(entry.taxonKey)
  const countries: string[] = []
  for (const [cc, codes] of Object.entries(dist.byCountry)) {
    if (codes.includes(code)) countries.push(cc)
  }
  liteCountries.value = countries
}

watch(
  [() => route.params.speciesId, bank, metaReadyFlag, poolReady],
  ([id]) => {
    if (species.value) {
      liteEntry.value = null
      liteResolved.value = true
      return
    }
    if (bank.value) void resolveLite(String(id ?? ''))
  },
  { immediate: true },
)

/** 国家码 → 本地化名(与 RegionView 同规则:Intl.DisplayNames + 港澳台特别标注) */
function liteCountryName(code: string): string {
  const key = REGION_LABEL_KEY[code]
  if (key) return t(key)
  try {
    return new Intl.DisplayNames([currentLocale()], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
const liteName = computed(() =>
  liteEntry.value ? (currentLocale().startsWith('zh') ? liteEntry.value.nameZh || liteEntry.value.nameEn || liteEntry.value.nameSci : liteEntry.value.nameEn || liteEntry.value.nameSci) : '',
)
const liteLinks = computed(() => {
  const e = liteEntry.value
  if (!e) return []
  const links: { label: string; url: string }[] = []
  if (e.backboneTaxonId) links.push({ label: t('species.lite.gbif'), url: `https://www.gbif.org/species/${e.backboneTaxonId}` })
  if (e.taxonKey) links.push({ label: t('species.lite.avibase'), url: `https://avibase.bsc-eoc.org/species.jsp?avibaseid=${shortCodeOf(e.taxonKey)}` })
  if (e.ebirdCode) links.push({ label: t('species.lite.ebird'), url: `https://ebird.org/species/${e.ebirdCode}` })
  if (e.nameSci) links.push({ label: t('species.lite.xc'), url: `https://xeno-canto.org/species/${e.nameSci.toLowerCase().replace(/\s+/g, '-')}` })
  if (e.inatTaxonId) links.push({ label: t('species.lite.inat'), url: `https://www.inaturalist.org/taxa/${e.inatTaxonId}` })
  return links
})
</script>

<template>
  <section class="card species-detail">
    <RouterLink class="back" to="/birding">
      <ArrowLeft class="ic" :size="15" /> {{ t('species.backToRegion') }}
    </RouterLink>

    <template v-if="species">
      <h2 class="name">
        {{ name }}<span class="sci">{{ species.nameSci }}</span>
      </h2>

      <img
        v-if="hero"
        class="hero"
        :src="hero.xlUrl || hero.url"
        :alt="name"
        decoding="async"
        loading="lazy"
      />

      <!-- 050 P2：profile 以权威层为准（全球种也有类群/分布，不再是空） -->
      <SpeciesFacts
        class="facts-block"
        :profile="metaEntry?.profile ?? species.profile"
        :species-id="species.id"
      />

      <!-- 季节性（021 M1）：出现月份直方图；无数据不显示 -->
      <SpeciesSeasonality v-if="seasonEntry" class="season-block" :entry="seasonEntry" />

      <!-- 省级出现强度（036 热力条，非地图）：无省级数据（如全球池物种）时整块不显示 -->
      <SpeciesProvinces class="prov-block" :species-id="species.id" />

      <section v-if="note" class="note">
        <h3>{{ note.title }}</h3>
        <p class="body">{{ note.body }}</p>
      </section>

      <SpeciesGallery
        :images="images"
        :audios="audios"
        mode="browse"
        :label="t('gallery.title')"
      />

      <section v-if="media.length" class="credits">
        <h4>{{ t('faq.attributionHeading') }}</h4>
        <AttributionLine v-for="m in media" :key="m.url" :media="m" />
      </section>
    </template>

    <!-- 025 M4:轻量详情(bank 未命中 → 骨架;全球种无媒体,有页可看) -->
    <template v-else-if="liteEntry">
      <h2 class="name">
        {{ liteName }}<span class="sci">{{ liteEntry.nameSci }}</span>
      </h2>
      <p v-if="liteEntry.extinct" class="lite-extinct">{{ t('species.lite.extinct') }}</p>
      <p class="lite-meta muted">
        {{ t('species.lite.order', { name: liteEntry.order }) }} ·
        {{ t('species.lite.family', { name: liteEntry.family }) }}
      </p>
      <p class="lite-note muted">{{ t('species.lite.noMedia') }}</p>

      <section v-if="liteCountries.length" class="lite-section">
        <h3>{{ t('species.lite.countries', { n: liteCountries.length }) }}</h3>
        <p class="lite-countries">
          <span v-for="cc in liteCountries" :key="cc" class="lite-cc">{{ liteCountryName(cc) }}</span>
        </p>
      </section>

      <section v-if="liteLinks.length" class="lite-section">
        <h3>{{ t('species.lite.links') }}</h3>
        <p class="lite-links">
          <a v-for="l in liteLinks" :key="l.url" :href="l.url" target="_blank" rel="noopener noreferrer">
            {{ l.label }}
          </a>
        </p>
        <p class="lite-src muted">{{ t('species.lite.source') }}</p>
      </section>
    </template>
    <p v-else class="muted not-found">
      {{ t('faq.notFound') }}
      <RouterLink to="/birding">{{ t('species.backToRegion') }}</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: var(--text-light);
  margin-bottom: 10px;
}
.back:hover {
  color: var(--primary);
}
.name {
  font-size: 1.2rem;
}
.name .sci {
  font-size: 0.82rem;
  font-style: italic;
  font-weight: 400;
  color: var(--text-light);
  margin-left: 8px;
}
.hero {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: #f0f4f2;
  margin: 12px 0;
}
.note {
  text-align: left;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: #f7faf8;
  border: 1px dashed var(--border);
  margin-top: 12px;
}
.note h3 {
  font-size: 0.95rem;
  margin-bottom: 6px;
  color: var(--primary-dark);
}
.note .body {
  font-size: 0.88rem;
  line-height: 1.75;
  color: var(--text);
  white-space: pre-line;
}
.facts-block {
  margin-top: 12px;
}
.prov-block {
  margin-top: 14px;
}
.credits {
  margin-top: 16px;
  text-align: left;
}
.credits h4 {
  font-size: 0.82rem;
  color: var(--text-light);
  margin-bottom: 4px;
}
.credits :deep(.attribution) {
  margin-top: 0;
  padding-top: 6px;
  border-top: none;
  text-align: left;
}
.lite-extinct {
  display: inline-block;
  padding: 1px 8px;
  border: 1px solid #c0392b;
  border-radius: 999px;
  color: #c0392b;
  font-size: 0.72rem;
}
.lite-meta {
  margin-top: 6px;
  font-size: 0.8rem;
}
.lite-note {
  margin-top: 8px;
  font-size: 0.78rem;
}
.lite-section {
  margin-top: 14px;
}
.lite-section h3 {
  font-size: 0.86rem;
  color: var(--primary-dark);
}
.lite-countries {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lite-cc {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.72rem;
}
.lite-links {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.lite-src {
  margin-top: 6px;
  font-size: 0.68rem;
}
.not-found {
  margin-top: 8px;
}
</style>
