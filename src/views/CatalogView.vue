<script setup lang="ts">
/**
 * 029 数据透明度:全量名录目录（/catalog）。
 * 按目 → 科 → 种（学名）组织，列出学名/英文名/中文名（有则给）与图/音可得性标记。
 * 数据源 public/data/catalog.json（构建期产物，懒加载 ~1.3MB）。
 *
 * 031 D-031-2:三种排序视图——
 *   分类序（默认）:AviList 目 → 科 → 学名,构建期已是此序,零成本;
 *   拼音:直接用构建期预计算的 s.py 键排序（无中文名回退英文名,再无则学名）,
 *        并在底部给出 A–Z 首字母跳转;
 *   常见度:按 s.cm（1 最常见 … 5 稀有）升序,无值者排末位。
 * 排序只重排**目内**的科与种（并显示目级提示）,不重组层级——大目录下用户仍能借搜索定位。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AudioLines, ChevronRight, ImageOff, Image as ImageIcon, Library, VolumeX } from 'lucide-vue-next'
import {
  letterAnchors,
  sortCatalogOrders,
  type CatalogData,
  type CatalogFamily,
  type CatalogOrder,
  type CatalogSortMode,
  type CatalogSpecies,
} from '@/core/catalog'

const { t } = useI18n()

const data = ref<CatalogData | null>(null)
const failed = ref(false)
/** 展开的目（默认全收起；点击展开，减少首屏 DOM 量） */
const openOrders = ref<Set<string>>(new Set())
/** 科级展开（目展开后科仍收起，避免一次渲染上万行） */
const openFamilies = ref<Set<string>>(new Set())
const query = ref('')
const sortMode = ref<CatalogSortMode>('taxo')

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
          s.en?.toLowerCase().includes(q) ||
          s.py?.includes(q),
      )
      if (species.length) families.push({ ...f, species })
    }
    if (families.length) orders.push({ ...o, families })
  }
  return { orders, total: orders.reduce((n, o) => n + o.families.reduce((m, f) => m + f.species.length, 0), 0) }
})

const visibleOrders = computed(() => {
  const orders = matched.value ? matched.value.orders : (data.value?.orders ?? [])
  // 搜索命中时保持分类序（结果集小、层级已自动展开，重排反而破坏定位感）
  return sortCatalogOrders(orders, matched.value ? 'taxo' : sortMode.value)
})

/** A–Z 首字母跳转锚点（仅拼音视图显示） */
const letterIndex = computed(() =>
  !data.value || sortMode.value !== 'pinyin' || matched.value ? [] : letterAnchors(visibleOrders.value),
)

/** 跳到字母锚点：展开该种所在的目与科，并滚动到行 */
function jumpTo(letter: string) {
  const anchor = letterIndex.value.find(([l]) => l === letter)?.[1]
  if (!anchor) return
  for (const o of visibleOrders.value) {
    for (const f of o.families) {
      if (f.species.some((s) => s.id === anchor)) {
        const os = new Set(openOrders.value)
        os.add(o.sci)
        openOrders.value = os
        const fs = new Set(openFamilies.value)
        fs.add(`${o.sci}|${f.sci}`)
        openFamilies.value = fs
        requestAnimationFrame(() => {
          document.getElementById(`cat-sp-${anchor}`)?.scrollIntoView({ block: 'center' })
        })
        return
      }
    }
  }
}

const sortOptions: { mode: CatalogSortMode; label: () => string }[] = [
  { mode: 'taxo', label: () => t('catalog.sortTaxo') },
  { mode: 'pinyin', label: () => t('catalog.sortPinyin') },
  { mode: 'common', label: () => t('catalog.sortCommon') },
]

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

    <div v-if="data" class="cat-toolbar">
      <input
        v-model="query"
        class="cat-search"
        type="search"
        :placeholder="t('catalog.search')"
        :aria-label="t('catalog.search')"
      />
      <div class="sort" role="group" :aria-label="t('catalog.sortLabel')">
        <button
          v-for="opt in sortOptions"
          :key="opt.mode"
          type="button"
          class="sort-btn"
          :class="{ active: sortMode === opt.mode }"
          :aria-pressed="sortMode === opt.mode"
          @click="sortMode = opt.mode"
        >
          {{ opt.label() }}
        </button>
      </div>
    </div>
    <p v-if="query" class="cat-hit">
      {{ t('catalog.hits', { n: matched?.total ?? 0 }) }}
    </p>
    <p v-else-if="sortMode !== 'taxo'" class="cat-hit">
      {{ sortMode === 'pinyin' ? t('catalog.sortPinyinHint') : t('catalog.sortCommonHint') }}
    </p>

    <div v-if="letterIndex.length" class="letter-bar" role="group" :aria-label="t('catalog.jumpLabel')">
      <button
        v-for="[letter] in letterIndex"
        :key="letter"
        type="button"
        class="letter-btn"
        @click="jumpTo(letter)"
      >
        {{ letter }}
      </button>
    </div>

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
              <li
                v-for="s in f.species"
                :id="`cat-sp-${s.id}`"
                :key="s.id"
                class="cat-sp"
                :class="{ 'flags-empty': !hasAny(s) }"
              >
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
  border-radius: var(--radius-sm);
  padding: 5px 12px;
  display: inline-block;
  margin-bottom: 14px;
}
.cat-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-search {
  width: 100%;
  max-width: 420px;
  padding: 8px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
}
/* 排序切换:与 /region 的胶囊按钮同形制 */
.sort {
  display: inline-flex;
  border: 2px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
}
.sort-btn {
  padding: 6px 12px;
  border: none;
  background: #fff;
  color: var(--text-light);
  font-size: 0.76rem;
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
.cat-hit {
  font-size: 0.78rem;
  color: var(--text-light);
  margin-bottom: 8px;
}
.letter-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px;
  margin-bottom: 10px;
}
.letter-btn {
  min-width: 24px;
  padding: 2px 4px;
  border: none;
  border-radius: var(--radius-xs);
  background: #f2f7f4;
  color: var(--text-light);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}
.letter-btn:hover {
  background: var(--primary);
  color: #fff;
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
  border-radius: var(--radius-xs);
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
