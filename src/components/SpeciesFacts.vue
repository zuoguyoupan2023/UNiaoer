<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe2 } from 'lucide-vue-next'
import { speciesProfileText, type SpeciesProfile } from '@/core/bank'
import { currentLocale } from '@/i18n'

const props = withDefaults(
  defineProps<{ profile?: SpeciesProfile; speciesId?: string; compact?: boolean }>(),
  { compact: false },
)
const { t } = useI18n()

/** 人工文本按 locale 取（缺英文回退中文） */
const text = computed(() => speciesProfileText(props.profile, currentLocale()))
const dist = computed(() => props.profile?.distribution)
const groupLabel = computed(() =>
  props.profile?.group ? t(`species.groups.${props.profile.group}`) : '',
)
const migrationLabel = computed(() =>
  props.profile?.migration ? t(`species.migrations.${props.profile.migration}`) : '',
)
const hasAny = computed(
  () =>
    !!(
      groupLabel.value ||
      migrationLabel.value ||
      text.value.habitat ||
      text.value.habit ||
      dist.value?.count
    ),
)

/** 国家码索引（public/data/distribution.json）按需加载一次并缓存 */
let countryIndexPromise: Promise<Record<string, string[]>> | null = null
function loadCountryIndex(): Promise<Record<string, string[]>> {
  if (!countryIndexPromise) {
    countryIndexPromise = fetch(`${import.meta.env.BASE_URL}data/distribution.json`)
      .then((r) => (r.ok ? r.json() : { bySpecies: {} }))
      .then((d: { bySpecies?: Record<string, string[]> }) => d?.bySpecies ?? {})
      .catch(() => ({}))
  }
  return countryIndexPromise
}

const countries = ref<string[] | null>(null)
const loading = ref(false)
/** 展开「国家/地区列表」时才加载（保持首屏轻量） */
async function onToggle(e: Event) {
  const el = e.target as HTMLDetailsElement
  if (!el.open || countries.value || !props.speciesId) return
  loading.value = true
  const index = await loadCountryIndex()
  countries.value = index[props.speciesId] ?? []
  loading.value = false
}

/** ISO 3166-1 alpha-2 → 本地化地区名（Intl.DisplayNames；不支持时回退代码） */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([currentLocale()], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
const countryNames = computed(() => (countries.value ?? []).map(countryName))
const countrySep = computed(() => (currentLocale() === 'en' ? ', ' : '、'))
const countryList = computed(() => countryNames.value.join(countrySep.value))
</script>

<template>
  <section v-if="hasAny" class="facts" :class="{ compact }">
    <h3 v-if="!compact" class="facts-title">{{ t('species.facts') }}</h3>
    <dl class="facts-grid">
      <template v-if="groupLabel">
        <dt>{{ t('species.group') }}</dt>
        <dd>{{ groupLabel }}</dd>
      </template>
      <template v-if="migrationLabel">
        <dt>{{ t('species.migration') }}</dt>
        <dd>{{ migrationLabel }}</dd>
      </template>
      <template v-if="!compact && text.habitat">
        <dt>{{ t('species.habitat') }}</dt>
        <dd>{{ text.habitat }}</dd>
      </template>
      <template v-if="!compact && text.habit">
        <dt>{{ t('species.habit') }}</dt>
        <dd>{{ text.habit }}</dd>
      </template>
      <template v-if="dist?.count">
        <dt>
          <Globe2 class="ic" :size="13" /> {{ t('species.distribution') }}
        </dt>
        <dd>
          {{ t('species.countries', { n: dist.count }) }}
          <span v-if="dist.category" class="iucn">{{ t('species.iucn', { code: dist.category }) }}</span>
          <details v-if="!compact" class="countries" @toggle="onToggle">
            <summary>{{ t('species.showCountries') }}</summary>
            <p v-if="loading" class="country-list">{{ t('common.loading') }}</p>
            <p v-else-if="countryNames.length" class="country-list">{{ countryList }}</p>
          </details>
        </dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.facts {
  text-align: left;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f7faf8;
  border: 1px dashed var(--border);
}
.facts-title {
  font-size: 0.9rem;
  margin-bottom: 8px;
  color: var(--primary-dark);
}
.facts-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.65;
}
.facts-grid dt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-light);
  font-weight: 700;
  white-space: nowrap;
}
.facts-grid dt .ic {
  color: var(--primary);
}
.facts-grid dd {
  margin: 0;
  color: var(--text);
  min-width: 0;
}
.iucn {
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 8px;
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 700;
}
.countries {
  margin-top: 4px;
}
.countries summary {
  cursor: pointer;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 600;
}
.country-list {
  margin: 4px 0 0;
  font-size: 0.78rem;
  color: var(--text-light);
}
/* 紧凑模式（结果页回顾）：单行、弱化边框 */
.facts.compact {
  padding: 6px 10px;
  background: transparent;
  border: none;
}
.facts.compact .facts-grid {
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  font-size: 0.76rem;
}
.facts.compact .facts-grid dt {
  font-weight: 600;
}
</style>
