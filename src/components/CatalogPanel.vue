<script setup lang="ts">
/**
 * 029 数据透明度:全量名录目录的**内容面板**（原 /catalog 页主体）。
 * 2026-11-23（docs/137 §4.4-a）：/birding 的「名录」标签已移除，本面板只由 /catalog 页使用。
 * 按目 → 科 → 种（学名）组织，列出学名/英文名/中文名（有则给）。
 *
 * 2026-11-23（docs/137 B 线）：**就地显示图1 + 音1**，不再整页跳详情；
 * 「查看详情」仍是唯一跳转入口。原来行尾的两个「有图/有音」状态图标已删除——
 * 状态改为用真实素材说话（展开即见图、点一下即播），无素材的种在卡里明确说明。
 *
 * 2026-11-23（第二轮，用户定）：
 *   ① **宽屏两栏**：≥720px 时行左侧放名字、右侧放图/音/署名/详情按钮；窄屏竖排（与原来一致）；
 *   ② **搜索不跨科 或 手动展开某个科** → 该批种全部自动展开素材，不再逐个点开；
 *      数量大时走**渐进加载**（IntersectionObserver：滚到哪条才展开哪条）。
 *      实测科的中位 11 种、p75 55、p90 136、最大 441（霸鹟科），所以不能一次性铺开；
 *   ③ 「查看详情」升级为主按钮（大、显眼），放在名字下方。
 *
 * 媒体加载策略（实测数据见 docs/137 §4.3-a / 本轮对话）：
 *   · 缩略图与首音 URL 来自 `data/thumbs.json`（836 KB / gzip 148 KB，一次索引全库），
 *     展开瞬间即可显示，无需等 assets 分片；
 *   · 署名（作者/许可证）只能从 assets 分片取 → 展开时才拉该种所在桶（中位 gzip 5.4 KB）；
 *   · 预取只在「确定不会过量」时发生：命中 ≤24 种且跨 ≤6 桶（约 ≤35 KB）才预热，
 *     否则点哪只拉哪只（搜 a 会命中 11,026 种 / 649 桶 ≈ 全库 5.8 MB，绝不能预取）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Volume2, VolumeX } from 'lucide-vue-next'
import {
  letterAnchors,
  sortCatalogOrders,
  type CatalogData,
  type CatalogFamily,
  type CatalogOrder,
  type CatalogSortMode,
  type CatalogSpecies,
} from '@/core/catalog'
import { loadBank, loadSpeciesAssets, prefetchSpeciesAssets } from '@/core/bank'
import { audioUrlOf, loadThumbs, thumbUrlOf, type ThumbsIndex } from '@/core/thumbs'
import { isPlaying, stopSharedAudio, toggleSharedAudio } from '@/core/audioPlayer'
import AttributionLine from '@/components/AttributionLine.vue'
import type { MediaAsset } from '@/types'

const { t } = useI18n()

/** A1（docs/137）：11k 只读对象不需要深度响应式——shallowRef 免掉全部 Proxy 建立与穿透开销 */
const data = shallowRef<CatalogData | null>(null)
const failed = ref(false)
/** 展开的目（默认全收起；点击展开，减少首屏 DOM 量） */
const openOrders = ref<Set<string>>(new Set())
/** 科级展开（目展开后科仍收起，避免一次渲染上万行） */
const openFamilies = ref<Set<string>>(new Set())
const query = ref('')
/** A3：防抖后的查询串（输入过程不触发全量遍历；中文单字搜索保留，不设最短长度） */
const debouncedQuery = ref('')
const sortMode = ref<CatalogSortMode>('taxo')
/**
 * 就地展开的种集合。
 * 2026-11-23 第二轮：从「一次只开一张」改为**多张并存**——搜索不跨科、或手动展开某个科时
 * 会成批自动展开；用户也可能想同时比较几只（原话「有可能用户就是想多比较几个」）。
 */
const expandedIds = ref<Set<string>>(new Set())
/** 每个种已取到的素材（含作者/许可证——署名只能从这里拿）；键 = species id */
const assetsById = ref<Map<string, { images?: MediaAsset[]; audios?: MediaAsset[] } | null>>(new Map())
/** 正在等 assets 分片的种（缩略图已由 thumbs 索引先显示，所以只是署名未就绪） */
const loadingIds = ref<Set<string>>(new Set())
/**
 * 已排队「到视口再展开」的种（渐进加载用）。
 * 大科（霸鹟科 441 种）一次铺开会有 441 张图 + 441 个音频源同时入队，
 * 所以超阈值时**只登记候选**，由 IntersectionObserver 在滚到时再真正展开。
 */
const pendingIds = ref<Set<string>>(new Set())
/** 首图/首音索引（全库一次加载，展开瞬间即有 URL） */
const thumbs = ref<ThumbsIndex | null>(null)

/** 预取上限：命中种数超过这个数就不预热（避免「搜 a」把全库拉下来） */
const MAX_PREFETCH_SPECIES = 24
/** 预取上限：跨桶数超过这个数就整体放弃（一桶中位 gzip 5.4 KB，6 桶 ≈ 35 KB） */
const MAX_PREFETCH_BUCKETS = 6
/**
 * 成批自动展开的上限（用户 2026-11-23 定）：
 * ≤ 此数 → 立刻全部展开（科的中位 11 种、p75 55 种里大多数落在这一侧）；
 * > 此数 → 进入**渐进展开**：滚到哪条展开哪条（霸鹟科 441 种、裸鼻雀科 388 种）。
 * 24 是「一屏大约能看到的行数」量级，超过它继续一次性铺开只会拖慢首屏。
 */
const AUTO_EXPAND_EAGER_MAX = 24

onMounted(async () => {
  void loadThumbs().then((idx) => {
    thumbs.value = idx
  })
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`)
    if (!res.ok) throw new Error(String(res.status))
    data.value = (await res.json()) as CatalogData
  } catch {
    failed.value = true
  }
})

let queryTimer: number | undefined
watch(query, (q) => {
  clearTimeout(queryTimer)
  queryTimer = window.setTimeout(() => {
    debouncedQuery.value = q
  }, 250)
})
onUnmounted(() => {
  clearTimeout(queryTimer)
  stopSharedAudio()
})

const counts = computed(() => data.value?.counts ?? null)

/** 搜索：命中则自动展开相关目与科，并只显示命中的种（读防抖后的串） */
const matched = computed(() => {
  const q = debouncedQuery.value.trim().toLowerCase()
  if (!data.value) return null
  if (!q) return null
  const orders: CatalogOrder[] = []
  for (const o of data.value.orders) {
    const families: CatalogFamily[] = []
    for (const f of o.families) {
      // 科名命中（中/拉丁）时整科列出，否则按种过滤
      const familyHit =
        f.sci.toLowerCase().includes(q) || (f.zh ? f.zh.toLowerCase().includes(q) : false)
      const species = familyHit
        ? f.species
        : f.species.filter(
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

/**
 * 限量预取：种数超限直接不发请求（桶数超限由 prefetchSpeciesAssets 内部再挡一次）。
 * 必须先 `loadBank()`——`bucketNameFor` 的桶名清单来自名单层（`manifest-meta.buckets`），
 * 没加载过名单层时它会返回空串，`loadSpeciesAssets` 静默返回 null（表现为「图有了、署名没了」）。
 * 名单层由 index.html preload 且 `loadMeta` 有进程内缓存，这里 await 不会重复下载。
 */
function prefetchQuietly(ids: readonly string[]) {
  if (!ids.length || ids.length > MAX_PREFETCH_SPECIES) return
  void loadBank()
    .then(() => prefetchSpeciesAssets(ids, MAX_PREFETCH_BUCKETS))
    .catch(() => {
      /* 名单层不可用：不预取，点开时再试 */
    })
}

/**
 * 成批展开一批种（搜索命中 / 手动展开某个科都用它）。
 *
 * 分两档（用户 2026-11-23 定）：
 *   · ≤AUTO_EXPAND_EAGER_MAX：直接全部展开——科的 p75 是 55 种，这里覆盖绝大多数科；
 *   · 更多：进入**渐进展开**，只把候选登记到 pendingIds，由 IntersectionObserver
 *     在行滚进视口时才展开该行（霸鹟科 441 种不会一次塞 441 张图进 DOM）。
 *
 * @param ids 待展开的种
 * @param opts.eager 允许无视阈值立即全展开（用于「用户在搜索框里明确要这批结果」）
 */
function expandBatch(ids: readonly string[], opts: { eager?: boolean } = {}) {
  if (!ids.length) return
  const eager = opts.eager || ids.length <= AUTO_EXPAND_EAGER_MAX
  if (eager) {
    const nextExpanded = new Set(expandedIds.value)
    for (const id of ids) nextExpanded.add(id)
    expandedIds.value = nextExpanded
    for (const id of ids) void ensureAssets(id)
    return
  }
  // 渐进：先只登记，滚动到才展开（观感上「下面的鸟逐渐加载」）
  const nextPending = new Set(pendingIds.value)
  for (const id of ids) if (!expandedIds.value.has(id)) nextPending.add(id)
  pendingIds.value = nextPending
  scheduleObserve()
}

/**
 * 渐进展开的观察器：观察所有「待展开」的行，进入视口（提前 200px）时才真正展开。
 * 每处理一条就从 pending 里移除并 unobserve，避免重复触发。
 */
let observer: IntersectionObserver | null = null

function ensureObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer
  observer = new IntersectionObserver(
    (entries) => {
      const toExpand: string[] = []
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target as HTMLElement
        const id = el.dataset.catSpId
        if (id) toExpand.push(id)
        observer?.unobserve(e.target)
      }
      if (!toExpand.length) return
      const nextExpanded = new Set(expandedIds.value)
      const nextPending = new Set(pendingIds.value)
      for (const id of toExpand) {
        nextExpanded.add(id)
        nextPending.delete(id)
      }
      expandedIds.value = nextExpanded
      pendingIds.value = nextPending
      for (const id of toExpand) void ensureAssets(id)
    },
    // rootMargin 底部提前 200px：滚到接近时就先准备好，滚动过程不出现空白
    { rootMargin: '0px 0px 200px 0px' },
  )
  return observer
}

/** 把当前 pending 集合同步到观察器（新增的行观察起来，已展开的移出） */
function scheduleObserve() {
  void nextTick(() => {
    const obs = ensureObserver()
    if (!obs) {
      // 无 IntersectionObserver（极老环境）：退化为一次性全展开，保证功能不丢
      const all = pendingIds.value
      pendingIds.value = new Set()
      expandBatch([...all], { eager: true })
      return
    }
    for (const id of pendingIds.value) {
      const el = document.querySelector<HTMLElement>(`[data-cat-sp-id="${CSS.escape(id)}"]`)
      if (el) obs.observe(el)
    }
  })
}

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})

/**
 * 搜索落定后：预热命中项的桶（只在结果不多时），并成批展开。
 * 判据（用户 2026-11-23 定）：**结果不跨科**才自动展开；跨科说明在扫多个类群，
 * 一次性铺开既费流量也难读 → 保持「点哪个开哪个」。
 * 「喜鹊」实测 8 种 / 1 科 → 全展开；「xi」1,194 种 / 多科 → 不展开。
 */
watch(debouncedQuery, () => {
  const m = matched.value
  const ids: string[] = []
  let familyCount = 0
  if (m) {
    for (const o of m.orders) {
      for (const f of o.families) {
        familyCount++
        for (const s of f.species) ids.push(s.id)
      }
    }
  }
  prefetchQuietly(ids)
  if (!debouncedQuery.value.trim()) return
  if (familyCount !== 1) return
  expandBatch(ids)
})

/**
 * 手动展开某个科：该科下的种成批展开（用户 2026-11-23 定：
 * 「手动展开某个科的时候，也应该是所有的该科下的鸟也都加载」）。
 * 科的规模实测中位 11、p75 55、p90 136、最大 441 → 超过 AUTO_EXPAND_EAGER_MAX
 * 自动转为渐进加载（滚到哪条展开哪条）。
 * 同时预热该科的桶（≤上限才发；超过就点开时再拉）。
 */
watch(openFamilies, (next, prev) => {
  for (const key of next) {
    if (prev?.has(key)) continue
    const [orderSci, familySci] = key.split('|')
    const fam = data.value?.orders
      .find((o) => o.sci === orderSci)
      ?.families.find((f) => f.sci === familySci)
    if (!fam) continue
    const ids = fam.species.map((s) => s.id)
    prefetchQuietly(ids)
    expandBatch(ids)
  }
})

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

/**
 * 拉某个种的 assets 分片（只为了署名；图/音 URL 已由 thumbs 索引给出）。
 * 幂等：已加载 / 正在加载的种直接返回，所以自动展开 24 个种时不会重复请求。
 * 必须先 `loadBank()`——桶名清单来自名单层（`manifest-meta.buckets`），
 * 没加载过名单层时 `bucketNameFor` 返回空串、`loadSpeciesAssets` 静默返回 null
 * （表现为「图有了、署名没了」）。名单层由 index.html preload 且进程内缓存，不重复下载。
 */
async function ensureAssets(id: string): Promise<void> {
  if (assetsById.value.has(id) || loadingIds.value.has(id)) return
  const nextLoading = new Set(loadingIds.value)
  nextLoading.add(id)
  loadingIds.value = nextLoading
  try {
    await loadBank()
  } catch {
    /* 名单层不可用：素材与署名都取不到，模板按「未就绪」处理 */
  }
  const a = await loadSpeciesAssets(id)
  const nextAssets = new Map(assetsById.value)
  nextAssets.set(id, a)
  assetsById.value = nextAssets
  const doneLoading = new Set(loadingIds.value)
  doneLoading.delete(id)
  loadingIds.value = doneLoading
}

/**
 * 点击某行：就地展开/收起该种的素材卡（不跳转）。多张卡可同时存在
 * （搜索不跨科时还会自动全开，见 autoExpand）。
 */
function toggleSpecies(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) {
    next.delete(id)
    expandedIds.value = next
    // 收起后若正在播这条音，停掉——避免「看不到的音频还在响」
    const url = audioFor(id)
    if (url && isPlaying(url)) stopSharedAudio()
    return
  }
  next.add(id)
  expandedIds.value = next
  void ensureAssets(id)
}

/** 该种是否已展开 */
const isExpanded = (id: string) => expandedIds.value.has(id)

/** 该种的素材（未加载 = undefined；加载失败/无素材 = null） */
const assetsFor = (id: string) => assetsById.value.get(id) ?? undefined
const isLoadingAssets = (id: string) => loadingIds.value.has(id)

/** 卡片首图：assets 分片优先（与详情页同源），未就绪时用 thumbs 索引秒开 */
function imageFor(id: string): string | null {
  const a = assetsFor(id)
  return a?.images?.[0]?.thumbUrl ?? a?.images?.[0]?.url ?? thumbUrlOf(thumbs.value, id)
}
/** 卡片首音：同上 */
function audioFor(id: string): string | null {
  return assetsFor(id)?.audios?.[0]?.url ?? audioUrlOf(thumbs.value, id)
}
const imageMediaFor = (id: string): MediaAsset | null => assetsFor(id)?.images?.[0] ?? null
const audioMediaFor = (id: string): MediaAsset | null => assetsFor(id)?.audios?.[0] ?? null

const isOrderOpen = (sci: string) => !!matched.value || openOrders.value.has(sci)
const isFamilyOpen = (orderSci: string, familySci: string) =>
  !!matched.value || openFamilies.value.has(`${orderSci}|${familySci}`)

const orderLabel = (o: CatalogOrder) => (o.zh ? `${o.zh} ${o.sci}` : o.sci)
/** 科：中文名 + 拉丁名（没有通行中文名的科只显示拉丁名，不硬造） */
const familyLabel = (f: CatalogFamily) => (f.zh ? `${f.zh} ${f.sci}` : f.sci)
const speciesLabel = (s: CatalogSpecies) => s.zh || s.en || s.sci
</script>

<template>
  <div class="catalog-panel">
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
    <!-- 用 query 判断（防抖生效前保持这一行不闪烁），数字随 matched（防抖后）更新 -->
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
              <span class="cat-family-name">{{ familyLabel(f) }}</span>
              <span class="cat-n muted">{{ f.species.length }}</span>
            </summary>
            <ul class="cat-species">
              <li
                v-for="s in f.species"
                :id="`cat-sp-${s.id}`"
                :key="s.id"
                :data-cat-sp-id="s.id"
                class="cat-sp"
                :class="{ open: isExpanded(s.id) }"
              >
                <!--
                  2026-11-23（用户定）：名字在左，素材在右侧。
                  左栏：中文名 / 英文名 / 拉丁名（缺哪个就少显示哪个）+「查看详情」主按钮；
                  右栏：图（上）、音（下），各自右侧是来源署名。
                  窄屏（≤719px）自动改为上下堆叠。
                -->
                <div class="cat-sp-side">
                  <button
                    type="button"
                    class="cat-sp-link"
                    :aria-expanded="isExpanded(s.id)"
                    :aria-controls="`cat-pv-${s.id}`"
                    @click="toggleSpecies(s.id)"
                  >
                    <span class="cat-sp-names">
                      <span class="cat-sp-main">{{ speciesLabel(s) }}</span>
                      <!-- 中文名存在时英文名单独一行；否则 main 就是英文名，不再重复 -->
                      <span v-if="s.zh && s.en" class="cat-sp-alt">{{ s.en }}</span>
                      <span class="cat-sp-sci">{{ s.sci }}</span>
                    </span>
                  </button>
                  <!-- 主按钮：显著的详情入口，始终可见（不必先展开素材） -->
                  <RouterLink
                    class="btn btn-primary cat-sp-detail"
                    :to="`/species/${s.id}`"
                    :aria-label="`${t('catalog.pvDetail')} · ${speciesLabel(s)}`"
                  >
                    {{ t('catalog.pvDetail') }}
                  </RouterLink>
                </div>

                <!-- 素材卡：左侧「图（上）+ 音（下）」、右侧各自来源署名 -->
                <div
                  v-if="isExpanded(s.id)"
                  :id="`cat-pv-${s.id}`"
                  class="cat-pv"
                  role="region"
                  :aria-label="speciesLabel(s)"
                >
                  <div class="cat-pv-media">
                    <div class="cat-pv-row">
                      <!-- 不做 lazy：卡是用户主动展开的那一条，展开即该图；
                           IAB/部分 WebView 在懒加载 + 动态插入时可能永不触发加载。 -->
                      <img
                        v-if="imageFor(s.id)"
                        class="cat-pv-img"
                        :src="imageFor(s.id)!"
                        alt=""
                        decoding="async"
                      />
                      <div v-else class="cat-pv-img cat-pv-img-empty muted">
                        {{ t('catalog.pvNoImage') }}
                      </div>
                      <div class="cat-pv-src">
                        <AttributionLine
                          v-if="imageMediaFor(s.id)"
                          class="cat-pv-credit"
                          compact
                          :media="imageMediaFor(s.id)!"
                        />
                        <p v-else-if="isLoadingAssets(s.id)" class="cat-pv-nomedia muted">
                          {{ t('common.loading') }}
                        </p>
                        <p v-else class="cat-pv-nomedia muted">{{ t('catalog.pvNoImage') }}</p>
                      </div>
                    </div>

                    <div class="cat-pv-row">
                      <!-- 音频播放：与观鸟页卡片同一个共享播放器（同时只响一条） -->
                      <button
                        v-if="audioFor(s.id)"
                        type="button"
                        class="cat-pv-play"
                        :class="{ playing: isPlaying(audioFor(s.id)!) }"
                        :aria-label="
                          isPlaying(audioFor(s.id)!) ? t('region.stopCall') : t('region.playCall')
                        "
                        :aria-pressed="isPlaying(audioFor(s.id)!)"
                        @click="toggleSharedAudio(audioFor(s.id)!)"
                      >
                        <VolumeX v-if="isPlaying(audioFor(s.id)!)" :size="15" aria-hidden="true" />
                        <Volume2 v-else :size="15" aria-hidden="true" />
                        {{
                          isPlaying(audioFor(s.id)!) ? t('region.stopCall') : t('region.playCall')
                        }}
                      </button>
                      <span v-else class="cat-pv-nomedia muted">{{ t('catalog.pvNoAudio') }}</span>
                      <div class="cat-pv-src">
                        <AttributionLine
                          v-if="audioMediaFor(s.id)"
                          class="cat-pv-credit"
                          compact
                          :media="audioMediaFor(s.id)!"
                        />
                        <p v-else-if="isLoadingAssets(s.id)" class="cat-pv-nomedia muted">
                          {{ t('common.loading') }}
                        </p>
                        <p v-else class="cat-pv-nomedia muted">{{ t('catalog.pvNoAudio') }}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </details>
        </div>
      </details>
    </div>

    <p v-else-if="failed" class="muted empty">{{ t('errors.unknown') }}</p>
    <p v-else class="muted empty">{{ t('catalog.loading') }}</p>

    <p class="cat-foot muted">{{ t('catalog.footnote') }}</p>
  </div>
</template>

<style scoped>
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
/* 排序切换:与 /birding 的胶囊按钮同形制 */
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
@media (hover: hover) {
.letter-btn:hover{
  background: var(--primary);
  color: #fff;
}
}.cat-tree {
  text-align: left;
  /* 2026-11-23 两栏布局：720px 放不下「名字 + 140px 图 + 署名 + 主按钮」，
     放宽到 940px（仍在 .app-main 的 1000px 内）；窄屏由 max-width:100% 兜住 */
  max-width: 940px;
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

/* 一行 = 左栏（名字 + 详情按钮）+ 右栏（素材卡）。
   窄屏（≤719px）改上下堆叠：左栏在上、素材卡在下 —— 手机竖排更省横向空间。 */
.cat-sp {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 10px;
  padding: 2px 0;
  border-top: 1px solid #eef3f0;
}
.cat-sp-side {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  /* 左栏固定一个舒适宽度：名字长短不一时右栏仍对齐成一条竖线 */
  flex: 0 0 220px;
  min-width: 0;
  padding: 4px 2px;
}
.cat-sp-link {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--text);
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .cat-sp-link:hover {
    background: #f2f7f4;
  }
}
.cat-sp.open > .cat-sp-side > .cat-sp-link {
  background: #eaf4ef;
}
/* 名字三行：中文名 / 英文名 / 拉丁名（缺哪个就不显示哪个，见模板 v-if） */
.cat-sp-names {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.cat-sp-main {
  font-weight: 700;
}
.cat-sp-alt {
  font-size: 0.76rem;
  color: var(--text-light);
}
.cat-sp-sci {
  font-size: 0.74rem;
  font-style: italic;
  color: #8b9a93;
}
/* 「查看详情」= 主按钮（用户 2026-11-23 定：要大、要显眼） */
.cat-sp-detail {
  padding: 6px 14px;
  font-size: 0.78rem;
}
.cat-sp.open > .cat-sp-side > .cat-sp-detail {
  margin-bottom: 2px;
}

/* ── 素材卡（2026-11-23）：左「图（上）+ 音（下）」，右上为各自来源 ── */
.cat-pv {
  display: flex;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
  margin: 2px 0 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fbfdfc;
}
.cat-pv-media {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
/* 每行 = 素材（图/播放键）在左 + 来源署名在右 */
.cat-pv-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.cat-pv-img {
  flex-shrink: 0;
  width: 150px;
  height: 112px;
  object-fit: cover;
  border-radius: var(--radius-xs);
  background: #eef3f0;
}
.cat-pv-img-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  text-align: center;
  line-height: 1.4;
  border: 1px dashed var(--border);
}
/* 来源署名区：占满剩余宽度，紧贴素材右侧 */
.cat-pv-src {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  padding-top: 2px;
}
.cat-pv-play {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-light);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
.cat-pv-play.playing {
  border-color: var(--primary);
  color: var(--primary);
  background: #eaf4ef;
}
.cat-pv-nomedia {
  font-size: 0.74rem;
  line-height: 1.5;
}
.cat-pv-credit {
  margin: 0 !important;
}
/* 窄屏：左栏与素材卡上下堆叠 */
@media (max-width: 719px) {
  .cat-sp {
    flex-direction: column;
    gap: 4px;
  }
  .cat-sp-side {
    flex: 0 0 auto;
    width: 100%;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cat-sp-link {
    flex: 1 1 auto;
  }
  .cat-sp-detail {
    flex: 0 0 auto;
  }
  .cat-pv {
    margin: 0 0 8px;
    width: 100%;
  }
}
/* 极窄屏：图/音各自独占一行，来源落到素材下方（避免素材被压成一条） */
@media (max-width: 480px) {
  .cat-pv-row {
    flex-wrap: wrap;
  }
  .cat-pv-img {
    width: 100%;
    height: 170px;
  }
  .cat-pv-src {
    width: 100%;
  }
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
