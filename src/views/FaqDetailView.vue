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
import { currentLocale } from '@/i18n'
import AttributionLine from '@/components/AttributionLine.vue'
import SpeciesFacts from '@/components/SpeciesFacts.vue'
import SpeciesGallery from '@/components/SpeciesGallery.vue'

const route = useRoute()
const { t } = useI18n()
const bank = ref<Manifest | null>(null)

async function ensureBank() {
  if (bank.value) return
  try {
    bank.value = await loadBank()
  } catch {
    /* 保持 null → 走 notFound */
  }
}
onMounted(ensureBank)
watch(() => route.params.speciesId, ensureBank)

const species = computed<BankSpecies | undefined>(() =>
  bank.value?.species.find((sp) => sp.id === route.params.speciesId),
)
const note = computed(() => speciesNoteText(species.value?.notes, currentLocale()))
const name = computed(() => (species.value ? speciesName(species.value, currentLocale()) : ''))

/** 029 M1:完整素材按需从 assets 分片加载(core 只带首图首音);未就绪先用 core 值 */
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
</script>

<template>
  <section class="card faq-detail">
    <RouterLink class="back" to="/faq">
      <ArrowLeft class="ic" :size="15" /> {{ t('faq.back') }}
    </RouterLink>

    <template v-if="species && note">
      <h2 class="name">
        {{ name }}<span class="sci">{{ species.nameSci }}</span>
      </h2>

      <img
        v-if="hero"
        class="hero"
        :src="hero.xlUrl || hero.url"
        alt=""
        decoding="async"
        loading="lazy"
      />

      <section class="note">
        <h3>{{ note.title }}</h3>
        <p class="body">{{ note.body }}</p>
      </section>

      <SpeciesFacts class="facts-block" :profile="species.profile" :species-id="species.id" />

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

    <p v-else class="muted not-found">
      {{ t('faq.notFound') }}
      <RouterLink to="/faq">{{ t('faq.back') }}</RouterLink>
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
  border-radius: 12px;
  background: #f0f4f2;
  margin: 12px 0;
}
.note {
  text-align: left;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f7faf8;
  border: 1px dashed var(--border);
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
.not-found {
  margin-top: 8px;
}
</style>
