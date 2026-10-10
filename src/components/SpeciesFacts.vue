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
/**
 * 三分类（waterbird/raptor/landbird，050 P0）—— **暂时隐藏**。
 *
 * 用户 2026-10-10：「三分类先隐藏，后期合适的时候删除它」+「六分类独立从零做，不要和三分类混淆，
 * 因为名称本身有重合」。`landbird`（林鸟）与六分类的 `woodland`（林鸟）同名，两套并存必然混淆；
 * 且三分类本身是"查表 + 兜底"的产物，对 1,371 种无依据者是留空、对核心库 1,299 种是历史口径，
 * 两者都不足以直接展示。**数据仍保留在产物里**（不删），只是不渲染；
 * 等六分法覆盖足够、或确实需要回看三分类时，用一个开关恢复。
 */
const groupLabel = computed(() =>
  import.meta.env.VITE_SHOW_TRI_GROUP === '1' && props.profile?.group
    ? t(`species.groups.${props.profile.group}`)
    : '',
)
/**
 * 051 S2：生活型六分法。**只渲染有出处的记录**（`profile.group6` 缺失 = 没有依据 = 不显示），
 * 不做推断、不兜底。一个科可跨类 → 用「·」并列。
 */
const group6Label = computed(() => {
  const gs = props.profile?.group6
  if (!gs || !gs.length) return ''
  return gs.map((g) => t(`species.group6.${g}`)).join(' · ')
})
const migrationLabel = computed(() =>
  props.profile?.migration ? t(`species.migrations.${props.profile.migration}`) : '',
)
const hasAny = computed(
  () =>
    !!(
      groupLabel.value ||
      group6Label.value ||
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
      <template v-if="group6Label">
        <dt>{{ t('species.group6.label') }}</dt>
        <dd>{{ group6Label }}</dd>
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-xs);
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
