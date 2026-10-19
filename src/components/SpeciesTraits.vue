<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { metaSpecies } from '@/core/meta'
import type { SpeciesProfile } from '@/core/bank'
import {
  habitatLabel,
  loadHabitatCodes,
  loadSpeciesTraits,
  topEntries,
  type HabitatCodeTable,
  type SpeciesTraits,
  type TraitHabitat,
  type TraitPlumageColour,
} from '@/core/traits'

const props = withDefaults(
  defineProps<{
    speciesId?: string
    taxonKey?: string
    nameSci?: string
    profile?: SpeciesProfile
    compact?: boolean
  }>(),
  { compact: false },
)
const { t, locale } = useI18n()

const resolved = computed(() => metaSpecies(props.speciesId))
const taxonKey = computed(() => props.taxonKey || resolved.value?.taxonKey)
const nameSci = computed(() => props.nameSci || resolved.value?.nameSci)
const hasTraits = computed(
  () =>
    !!(
      props.profile?.hasTraits?.diet ||
      props.profile?.hasTraits?.morph ||
      props.profile?.hasTraits?.plumage ||
      props.profile?.habitatCodes?.length
    ),
)

const codes = ref<HabitatCodeTable | null>(null)
const traits = ref<SpeciesTraits | null>(null)
const loading = ref(false)

async function load() {
  if (!hasTraits.value) return
  loading.value = true
  if (!codes.value) codes.value = await loadHabitatCodes()
  if (taxonKey.value && nameSci.value) {
    traits.value = await loadSpeciesTraits(taxonKey.value, nameSci.value)
  }
  loading.value = false
}
watch([taxonKey, nameSci, hasTraits], load, { immediate: true })

const tags = computed(() =>
  (props.profile?.habitatCodes || []).map((code) => ({
    code,
    label: habitatLabel(codes.value, code, locale.value),
  })),
)

const dietTop = computed(() => topEntries(traits.value?.diet, 1)[0])
const mass = computed(() => {
  const v = traits.value?.morph?.massG
  return typeof v === 'number' ? v : null
})
const dichromatic = computed(() => traits.value?.plumage?.dichromatism?.isDichromatic ?? null)

const capsules = computed(() => {
  const out: string[] = []
  if (dietTop.value) {
    out.push(
      t('species.traits.dietCapsule', {
        name: dietName(dietTop.value[0]),
        pct: Math.round(dietTop.value[1]),
      }),
    )
  }
  if (mass.value !== null) out.push(t('species.traits.massCapsule', { g: Math.round(mass.value) }))
  if (dichromatic.value === true) out.push(t('species.traits.dichromatic'))
  else if (dichromatic.value === false) out.push(t('species.traits.monochromatic'))
  return out
})

const habitats = computed(() => {
  const list = traits.value?.habitats || []
  return [...list].sort((a, b) => Number(b.major) - Number(a.major))
})
const dietRows = computed(() => topEntries(traits.value?.diet))
const foragingRows = computed(() => topEntries(traits.value?.foraging))
const morphRows = computed(() => {
  const m = traits.value?.morph
  if (!m) return []
  const order = ['beakCulmen', 'wing', 'tail', 'massG']
  return order
    .filter((k) => typeof m[k] === 'number')
    .map((k) => ({
      key: k,
      label: t(`species.traits.morph.${k}`),
      value: Number(m[k]),
      unit: k === 'massG' ? 'g' : 'mm',
    }))
})
const plumageRows = computed(() => {
  const colours = traits.value?.plumage?.colours
  if (!colours) return []
  return Object.entries(colours)
    .map(([key, v]) => ({ key, ...v }))
    .filter((c) => c.m > 0.0005 || c.f > 0.0005)
    .sort((a, b) => b.m + b.f - (a.m + a.f))
    .slice(0, 5)
})
const rawHasAny = computed(
  () =>
    habitats.value.length > 0 ||
    dietRows.value.length > 0 ||
    foragingRows.value.length > 0 ||
    morphRows.value.length > 0 ||
    plumageRows.value.length > 0,
)
const hasAny = computed(() => tags.value.length > 0 || capsules.value.length > 0 || rawHasAny.value)

/** 只列本次实际有数据的来源，避免“没数据也挂名” */
const sourceLinks = computed(() => {
  const out: Array<{ label: string; url: string }> = []
  if (props.profile?.habitatCodes?.length || habitats.value.length) {
    out.push({ label: 'IUCN', url: 'https://www.iucnredlist.org/' })
  }
  if (props.profile?.hasTraits?.diet) {
    out.push({ label: 'EltonTraits', url: 'https://doi.org/10.1890/13-1917.1' })
  }
  if (props.profile?.hasTraits?.morph) {
    out.push({ label: 'AVONET', url: 'https://doi.org/10.1111/ele.13898' })
  }
  if (props.profile?.hasTraits?.plumage) {
    out.push({ label: 'Dunning', url: 'https://doi.org/10.5061/dryad.jq2bvq8jg' })
  }
  return out
})

function dietName(key: string): string {
  const k = `species.traits.diet.${key}`
  const v = t(k)
  return v === k ? key : v
}
function foragingName(key: string): string {
  const k = `species.traits.foraging.${key}`
  const v = t(k)
  return v === k ? key : v
}
function colourName(key: string): string {
  const k = `species.traits.colours.${key.replace(/\./g, '_')}`
  const v = t(k)
  return v === k ? key : v
}
function seasonName(s: string): string {
  const map: Record<string, string> = {
    'Breeding Season': 'breeding',
    'Non-Breeding Season': 'nonBreeding',
    Resident: 'resident',
    Passage: 'passage',
  }
  const k = `species.traits.seasons.${map[s] || 'other'}`
  const v = t(k)
  return v === k ? s : v
}
function habitatName(h: TraitHabitat): string {
  return habitatLabel(codes.value, h.code, locale.value)
}
function pct(v: number): string {
  return `${Math.round(v)}%`
}
function colourText(c: TraitPlumageColour): string {
  const p = (v: number) => `${Math.round(v * 100)}%`
  if (Math.abs(c.m - c.f) < 0.005) return p(c.m)
  return `${t('species.traits.male')} ${p(c.m)} / ${t('species.traits.female')} ${p(c.f)}`
}
</script>

<template>
  <section v-if="hasAny" class="traits" :class="{ compact }">
    <div v-if="tags.length" class="trait-tags">
      <span v-for="tag in tags" :key="tag.code" class="trait-tag">{{ tag.label }}</span>
    </div>

    <div v-if="capsules.length" class="trait-caps">
      <span v-for="c in capsules" :key="c" class="trait-cap">{{ c }}</span>
    </div>

    <details v-if="rawHasAny" class="trait-raw">
      <summary>{{ t('species.traits.more') }}</summary>

      <div v-if="habitats.length" class="raw-block">
        <h4>{{ t('species.traits.habitat') }}</h4>
        <ul>
          <li v-for="h in habitats" :key="h.code + h.seasons?.join(',')">
            {{ habitatName(h) }}
            <span v-if="h.major" class="badge">{{ t('species.traits.major') }}</span>
            <span v-if="h.seasons?.length" class="muted">· {{ h.seasons.map(seasonName).join(' / ') }}</span>
          </li>
        </ul>
      </div>

      <div v-if="dietRows.length" class="raw-block">
        <h4>{{ t('species.traits.dietLabel') }}</h4>
        <ul>
          <li v-for="[k, v] in dietRows" :key="k">{{ dietName(k) }} · {{ pct(v) }}</li>
        </ul>
      </div>

      <div v-if="foragingRows.length" class="raw-block">
        <h4>{{ t('species.traits.foragingLabel') }}</h4>
        <ul>
          <li v-for="[k, v] in foragingRows" :key="k">{{ foragingName(k) }} · {{ pct(v) }}</li>
        </ul>
      </div>

      <div v-if="morphRows.length" class="raw-block">
        <h4>
          {{ t('species.traits.morphLabel') }}
          <span v-if="traits?.morph?.inferred" class="muted">· {{ t('species.traits.inferred') }}</span>
        </h4>
        <ul>
          <li v-for="m in morphRows" :key="m.key">{{ m.label }} · {{ m.value }}{{ m.unit }}</li>
        </ul>
      </div>

      <div v-if="plumageRows.length" class="raw-block">
        <h4>{{ t('species.traits.plumageLabel') }}</h4>
        <ul>
          <li v-for="c in plumageRows" :key="c.key">{{ colourName(c.key) }} · {{ colourText(c) }}</li>
        </ul>
        <p v-if="dichromatic === true" class="muted">{{ t('species.traits.dichromatic') }}</p>
        <p v-else-if="dichromatic === false" class="muted">{{ t('species.traits.monochromatic') }}</p>
      </div>
    </details>

    <p v-if="sourceLinks.length" class="trait-source">
      {{ t('species.traits.source') }}
      <template v-for="(s, i) in sourceLinks" :key="s.label">
        <a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.label }}</a>
        <span v-if="i < sourceLinks.length - 1"> · </span>
      </template>
    </p>
    <p v-if="loading" class="muted trait-loading">{{ t('common.loading') }}</p>
  </section>
</template>

<style scoped>
.traits {
  margin-top: 10px;
  text-align: left;
}
.trait-tags,
.trait-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.trait-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--primary-dark);
  font-size: 0.75rem;
  font-weight: 700;
}
.trait-cap {
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: #f4f7f5;
  color: var(--text-light);
  font-size: 0.75rem;
}
.trait-raw {
  margin-top: 6px;
  font-size: 0.8rem;
}
.trait-raw summary {
  cursor: pointer;
  color: var(--primary);
  font-weight: 600;
}
.raw-block h4 {
  margin: 10px 0 4px;
  font-size: 0.8rem;
  color: var(--primary-dark);
}
.raw-block ul {
  margin: 0;
  padding-left: 18px;
  color: var(--text);
  line-height: 1.7;
}
.badge {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.68rem;
  font-weight: 700;
}
.trait-source {
  margin: 8px 0 0;
  font-size: 0.72rem;
  color: var(--text-light);
  line-height: 1.6;
}
.trait-source a {
  color: var(--primary);
}
.trait-loading {
  font-size: 0.72rem;
}
.compact .trait-source,
.compact .trait-raw {
  display: none;
}
</style>
