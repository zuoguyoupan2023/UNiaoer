<script setup lang="ts">
/**
 * 029 数据透明度:全量名录目录（/catalog）。
 * 按目 → 科 → 种（学名）组织，列出学名/英文名/中文名（有则给）与图/音可得性标记。
 * 数据源 public/data/catalog.json（构建期产物，懒加载 ~1.3MB）。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AudioLines, ChevronRight, ImageOff, Image as ImageIcon, Library, VolumeX } from 'lucide-vue-next'

const { t } = useI18n()

interface CatalogSpecies {
  id: string
  sci: string
  en?: string
  zh?: string
  image: boolean
  audio: boolean
  extinct?: boolean
}
interface CatalogFamily {
  sci: string
  species: CatalogSpecies[]
}
interface CatalogOrder {
  sci: string
  zh?: string
  families: CatalogFamily[]
}
interface CatalogData {
  generatedAt: string
  counts: { total: number; withImage: number; withAudio: number; orders: number; families: number }
  orders: CatalogOrder[]
}

const data = ref<CatalogData | null>(null)
const failed = ref(false)
/** 展开的目（默认全收起；点击展开，减少首屏 DOM 量） */
const openOrders = ref<Set<string>>(new Set())
/** 科级展开（目展开后科仍收起，避免一次渲染上万行） */
const openFamilies = ref<Set<string>>(new Set())
const query = ref('')

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`)
    if (!res.ok) throw new Error(String(res.status))
    data.value = (await res.json()) as CatalogData
  } catch {
    failed.value = true
  }
})

const counts = computed(() => data.value?.counts ?? null)

/** 搜索：命中则自动展开相关目与科，并只显示命中的种 */
const matched = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!data.value) return null
  if (!q) return null
  const orders: CatalogOrder[] = []
  for (const o of data.value.orders) {
    const families: CatalogFamily[] = []
    for (const f of o.families) {
      const species = f.species.filter(
        (s) =>
          s.sci.toLowerCase().includes(q) ||
          s.zh?.toLowerCase().includes(q) ||
          s.en?.toLowerCase().includes(q),
      )
      if (species.length) families.push({ ...f, species })
    }
    if (families.length) orders.push({ ...o, families })
  }
  return { orders, total: orders.reduce((n, o) => n + o.families.reduce((m, f) => m + f.species.length, 0), 0) }
})

const visibleOrders = computed(() => (matched.value ? matched.value.orders : (data.value?.orders ?? [])))

function toggleOrder(sci: string) {
  const s = new Set(openOrders.value)
  if (s.has(sci)) s.delete(sci)
  else s.add(sci)
  openOrders.value = s
}
function toggleFamily(orderSci: string, familySci: string) {
  const key = `${orderSci}|${familySci}`
  const s = new Set(openFamilies.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  openFamilies.value = s
}
const isOrderOpen = (sci: string) => !!matched.value || openOrders.value.has(sci)
const isFamilyOpen = (orderSci: string, familySci: string) =>
  !!matched.value || openFamilies.value.has(`${orderSci}|${familySci}`)

const orderLabel = (o: CatalogOrder) => (o.zh ? `${o.zh} ${o.sci}` : o.sci)
const speciesLabel = (s: CatalogSpecies) => s.zh || s.en || s.sci
const hasAny = (s: CatalogSpecies) => s.image || s.audio
</script>

<template>
  <section class="card catalog">
    <h2 class="cat-head"><Library class="ic" :size="22" /> {{ t('catalog.title') }}</h2>
    <p class="muted lead">{{ t('catalog.lead') }}</p>

    <p v-if="counts" class="count">
      {{ t('catalog.counts', { total: counts.total, orders: counts.orders, families: counts.families }) }}
      ·
      {{ t('catalog.mediaCounts', { image: counts.withImage, audio: counts.withAudio }) }}
    </p>

    <input
      v-if="data"
      v-model="query"
      class="cat-search"
      type="search"
      :placeholder="t('catalog.search')"
      :aria-label="t('catalog.search')"
    />
    <p v-if="query" class="cat-hit">
      {{ t('catalog.hits', { n: matched?.total ?? 0 }) }}
    </p>

    <div v-if="data" class="cat-tree">
      <details
        v-for="o in visibleOrders"
        :key="o.sci"
        class="cat-order"
        :open="isOrderOpen(o.sci)"
      >
        <summary class="cat-order-sum" @click.prevent="toggleOrder(o.sci)">
          <ChevronRight class="cat-caret" :size="16" />
          <span class="cat-order-name">{{ orderLabel(o) }}</span>
          <span class="cat-n muted">{{ o.families.reduce((n, f) => n + f.species.length, 0) }}</span>
        </summary>
        <div class="cat-families">
          <details
            v-for="f in o.families"
            :key="o.sci + f.sci"
            class="cat-family"
            :open="isFamilyOpen(o.sci, f.sci)"
          >
            <summary class="cat-family-sum" @click.prevent="toggleFamily(o.sci, f.sci)">
              <ChevronRight class="cat-caret" :size="14" />
              <span class="cat-family-name">{{ f.sci }}</span>
              <span class="cat-n muted">{{ f.species.length }}</span>
            </summary>
            <ul class="cat-species">
              <li v-for="s in f.species" :key="s.id" class="cat-sp" :class="{ 'flags-empty': !hasAny(s) }">
                <RouterLink class="cat-sp-link" :to="`/species/${s.id}`">
                  <span class="cat-sp-names">
                    <span class="cat-sp-main">{{ speciesLabel(s) }}</span>
                    <span v-if="s.zh && s.en" class="cat-sp-alt">{{ s.en }}</span>
                    <span class="cat-sp-sci">{{ s.sci }}</span>
                  </span>
                  <span
                    class="cat-sp-flags"
                    :class="{ 'no-any': !hasAny(s) }"
                    :aria-label="t('catalog.flags')"
                  >
                    <ImageIcon v-if="s.image" class="fl ok" :size="13" />
                    <ImageOff v-else class="fl no" :size="13" />
                    <AudioLines v-if="s.audio" class="fl ok" :size="13" />
                    <VolumeX v-else class="fl no" :size="13" />
                  </span>
                </RouterLink>
              </li>
            </ul>
          </details>
        </div>
      </details>
    </div>

    <p v-else-if="failed" class="muted empty">{{ t('errors.unknown') }}</p>
    <p v-else class="muted empty">{{ t('catalog.loading') }}</p>

    <p class="cat-foot muted">{{ t('catalog.footnote') }}</p>
  </section>
</template>

<style scoped>
.catalog {
  text-align: center;
}
.cat-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.cat-head .ic {
  color: var(--primary);
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 10px;
}
.count {
  font-size: 0.78rem;
  color: var(--primary);
  background: #eaf4ef;
  border-radius: 10px;
  padding: 5px 12px;
  display: inline-block;
  margin-bottom: 14px;
}
.cat-search {
  width: 100%;
  max-width: 420px;
  padding: 8px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  margin-bottom: 10px;
}
.cat-hit {
  font-size: 0.78rem;
  color: var(--text-light);
  margin-bottom: 8px;
}
.cat-tree {
  text-align: left;
  max-width: 720px;
  margin: 0 auto;
}
.cat-order,
.cat-family {
  border-top: 1px solid var(--border);
}
.cat-order > summary,
.cat-family > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  cursor: pointer;
  list-style: none;
}
.cat-order > summary::-webkit-details-marker,
.cat-family > summary::-webkit-details-marker {
  display: none;
}
.cat-order-sum {
  font-weight: 700;
  font-size: 0.92rem;
}
.cat-family-sum {
  font-weight: 600;
  font-size: 0.84rem;
  color: var(--text-light);
  padding-left: 14px !important;
}
.cat-caret {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
details[open] > summary .cat-caret {
  transform: rotate(90deg);
}
.cat-n {
  margin-left: auto;
  font-size: 0.74rem;
}
.cat-species {
  list-style: none;
  padding: 2px 0 8px 26px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cat-sp-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 7px;
  color: var(--text);
  font-size: 0.82rem;
}
.cat-sp-link:hover {
  background: #f2f7f4;
  text-decoration: none;
}
.cat-sp-names {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.cat-sp-main {
  font-weight: 600;
}
.cat-sp-alt {
  font-size: 0.76rem;
  color: var(--text-light);
}
.cat-sp-sci {
  font-size: 0.74rem;
  font-style: italic;
  color: var(--text-light);
}
.cat-sp-flags {
  margin-left: auto;
  display: inline-flex;
  gap: 3px;
  flex-shrink: 0;
}
.fl.ok {
  color: var(--primary);
}
.fl.no {
  color: #c9d3cd;
}
/* 既无图也无音的种（极少数）：整行弱化,提示不可玩 */
.cat-sp.flags-empty .cat-sp-names,
.cat-sp.flags-empty .cat-sp-sci {
  opacity: 0.7;
}
.cat-foot {
  max-width: 640px;
  margin: 16px auto 0;
  font-size: 0.76rem;
  line-height: 1.6;
  text-align: left;
}
.empty {
  margin: 14px 0;
}
</style>
