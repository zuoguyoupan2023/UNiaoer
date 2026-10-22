<script setup lang="ts">
/**
 * 042：「观鸟」页（合并原 `/region` 地区浏览与 `/nearby` 附近鸟点）。
 *
 * 结构：两个标签页 —— ①**观鸟点**（默认，含「附近鸟点」开关：关=按地区浏览点位，开=按定位排附近点位）
 * ②**该地鸟种**（该国家/省份的鸟种网格；042 时叫「地区浏览」，2026-10-21 更名）。
 * 地区选择器（大洲/国家/省）在页面级常驻，两个标签页共用。
 * 旧路由 `/region` / `/nearby` 由 router 重定向到本页并还原状态（见 router/index.ts）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Crosshair, Globe2, MapPin, Search, X } from 'lucide-vue-next'
import NearbySpotsPanel from '@/components/NearbySpotsPanel.vue'
import { prefersReducedMotion, useDialogA11y } from '@/composables/useDialogA11y'
import { useMediaQuery } from '@/composables/useMediaQuery'
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
  provinceStats,
  speciesInProvince,
  type ProvinceData,
} from '@/core/provinces'
import {
  ebirdHotspotUrl,
  hotspotsInProvince,
  loadCountrySpots,
  loadHotspots,
  spotsOf,
  type HotspotIndex,
  type Hotspot,
} from '@/core/hotspots'
import { currentLocale } from '@/i18n'
import {
  entryDisplayName,
  loadSpeciesDistribution,
  loadSpeciesIndex,
  shortCodeOf,
  slugifySci,
  type SpeciesIndex,
} from '@/core/speciesIndex'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const bank = ref<Manifest | null>(null)
const bySpecies = ref<Record<string, string[]> | null>(null)
const provinceData = ref<ProvinceData | null>(null)
const hotspotData = ref<HotspotIndex | null>(null)
/** 当前所选国家的点位（懒加载；null = 加载中/无数据） */
const countrySpots = ref<Hotspot[]>([])
const expandedHotspot = ref('')
const failed = ref(false)
const query = ref('')
/** 025 M2:全球骨架与区系(懒加载,失败降级为 bank 视图) */
const speciesIdx = ref<SpeciesIndex | null>(null)
const globalByCountry = ref<Record<string, string[]> | null>(null)
/** 网格分段渲染:单国种数可达上千,每次 200 + 显示更多 */
const visibleCount = ref(200)
/** 先亚洲、默认中国（017：先中国） */
const continent = ref<Continent>('asia')
const selected = ref('CN')
/** 已选省级 code（空 = 国家级） */
const province = ref('')
/** 右侧面板标签页：观鸟点（默认）/ 该地鸟种（042，2026-10-21 更名） */
const activeTab = ref<'spots' | 'regions'>('spots')
/** 「附近鸟点」开关（默认关；开 → 观鸟点列表改为按定位排序的附近点位） */
const nearby = ref(false)
/** 选中国家的省级二级列表是否展开（点击已选国家切换） */
const expanded = ref(true)
/** 移动端断点（与 style 里的 @media max-width: 640px 保持一致） */
const isMobile = useMediaQuery('(max-width: 640px)')
/** 移动端「选择地区」抽屉是否展开（桌面端常驻侧栏，不使用此状态） */
const pickerOpen = ref(false)
/**
 * 抽屉无障碍：打开时焦点圈闭、ESC 关闭、锁背景滚动、关闭后焦点回到触发条
 * （`panelRef` 绑到抽屉面板上；桌面端 pickerOpen 恒为 false，不触发）
 */
const { panelRef } = useDialogA11y(pickerOpen, {
  onClose: () => {
    pickerOpen.value = false
  },
})
/** 抽屉面板 ref：useDialogA11y 的焦点圈闭/滚动锁都依赖它，模板里用函数 ref 转交给它 */
function setPanelRef(el: Element | ComponentPublicInstance | null) {
  panelRef.value = el instanceof HTMLElement ? el : null
}
/** 触发条吸附位置：顶栏（sticky top:8px）高度 + 间距；运行时测量，en/窄屏换行也准 */
const stickyTop = ref(60)
let topbarObserver: ResizeObserver | null = null
function measureStickyTop() {
  const el = document.querySelector('.app-topbar')
  if (!el) return
  stickyTop.value = Math.round(el.getBoundingClientRect().height) + 16
}
onMounted(() => {
  measureStickyTop()
  window.addEventListener('resize', measureStickyTop)
  const topbar = document.querySelector('.app-topbar')
  if (topbar && typeof ResizeObserver !== 'undefined') {
    topbarObserver = new ResizeObserver(measureStickyTop)
    topbarObserver.observe(topbar)
  }
})
onUnmounted(() => {
  window.removeEventListener('resize', measureStickyTop)
  topbarObserver?.disconnect()
})
/** 与 region:nearby-spots 的 --cell-deg 一致（仅用于署名文案） */
const CELL_DEG = 0.25
/** 目录排序：名称（zh 拼音 / en 首字母）或鸟种数；一级二级共用 */
const sortMode = ref<'name' | 'count'>('name')
/** 深链还原期间抑制「切国重置省份」的副作用（见 applyQuery） */
let applyingQuery = false

/** 深链还原：`/region` → tab=regions；`/nearby` → tab=spots&nearby=1；`?cc=&sub=` → 国家/省级 */
function applyQuery() {
  const q = route.query
  const tab = q.tab === 'regions' ? 'regions' : 'spots'
  activeTab.value = tab
  nearby.value = tab === 'spots' && q.nearby === '1'
  if (typeof q.cc === 'string' && q.cc) selected.value = q.cc.toUpperCase()
  if (typeof q.sub === 'string') province.value = q.sub
  // `watch(selected)` 会重置省份 —— 深链里 cc+sub 同时给出时必须抑制一次，
  // 否则 `?cc=US&sub=US-CA` 的省份会被清掉（刷新/分享还原残缺）。
  applyingQuery = true
  void nextTick(() => {
    applyingQuery = false
  })
}

/** 标签/开关/地区变化 → 写回 URL（保证刷新与分享可还原） */
function setTab(next: 'spots' | 'regions') {
  activeTab.value = next
  syncQuery()
}
function toggleNearby() {
  nearby.value = !nearby.value
  if (nearby.value) activeTab.value = 'spots'
  syncQuery()
}
function syncQuery() {
  const q: Record<string, string> = {}
  if (activeTab.value === 'regions') q.tab = 'regions'
  if (nearby.value) q.nearby = '1'
  // 地区也进 URL：默认国（CN）不写，保持链接干净；省份总是写
  if (selected.value && selected.value !== 'CN') q.cc = selected.value
  if (province.value) q.sub = province.value
  // 与当前 URL 相同则不触发导航（避免每次挂载都 replace 一次）
  const cur = route.query
  const same =
    Object.keys(cur).length === Object.keys(q).length && Object.keys(q).every((k) => cur[k] === q[k])
  if (same) return
  void router.replace({ query: q })
}

onMounted(async () => {
  applyQuery()
  try {
    bank.value = await loadBank()
    const res = await fetch(`${import.meta.env.BASE_URL}data/distribution.json`)
    const data = res.ok
      ? ((await res.json()) as { bySpecies?: Record<string, string[]> })
      : { bySpecies: {} }
    bySpecies.value = data.bySpecies ?? {}
    // 省级层：缺失则整层不显示（021 §2.5 薄数据回退国家层）
    provinceData.value = await loadProvinces()
    // 观鸟点（eBird 派生点位）：索引缺失则整块不显示
    hotspotData.value = await loadHotspots()
    void loadSpotsFor(selected.value)
  } catch {
    failed.value = true
  }
  // 025 M2:全球层非致命——失败则保持现状 bank 视图
  void loadSpeciesIndex().then((idx) => (speciesIdx.value = idx))
  void loadSpeciesDistribution().then((d) => (globalByCountry.value = d?.byCountry ?? null))
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

/** 025 M2:全球区系 ∪ bank distribution(合并到「短码 → 国家数组」,与 bySpecies 同构;
 * countryStats/buildCountryIndex 原样可用)——骨架未加载则 null 降级 */
const mergedBySpecies = computed<Record<string, string[]> | null>(() => {
  const idx = speciesIdx.value
  if (!idx) return null
  const merged = new Map<string, Set<string>>() // shortCode → countries
  for (const [cc, codes] of Object.entries(globalByCountry.value ?? {})) {
    for (const code of codes) {
      if (!merged.has(code)) merged.set(code, new Set())
      merged.get(code)!.add(cc)
    }
  }
  for (const s of bank.value?.species ?? []) {
    if (!s.taxonKey) continue
    const code = shortCodeOf(s.taxonKey)
    if (!merged.has(code)) merged.set(code, new Set())
    for (const cc of bySpecies.value?.[s.id] ?? []) merged.get(code)!.add(cc)
  }
  return Object.fromEntries([...merged.entries()].map(([code, set]) => [code, [...set].sort()]))
})
const stats = computed(() => {
  const src = mergedBySpecies.value ?? bySpecies.value
  return src ? countryStats(src) : []
})
const continents = computed(() => presentContinents(stats.value))
const continentStats = computed(() => countriesInContinent(stats.value, continent.value))
/** 名称排序用本地化 collator：zh-CN 按拼音，en 按字母（首字母） */
const collator = computed(() => new Intl.Collator(currentLocale(), { numeric: true }))
const filtered = computed(() => {
  const list = filterCountries(continentStats.value, query.value, countryName)
  if (sortMode.value === 'count') return list // countryStats 已按鸟种数降序
  return [...list].sort((a, b) => collator.value.compare(countryName(a.code), countryName(b.code)))
})
/** 合并索引(国家 → 短码)与 bank 索引(降级路径与省级过滤用) */
const mergedIndex = computed(() => (mergedBySpecies.value ? buildCountryIndex(mergedBySpecies.value) : {}))
const index = computed(() => (bySpecies.value ? buildCountryIndex(bySpecies.value) : {}))
const provinces = computed(() => {
  const list = provinceStats(provinceData.value, selected.value, locale.value)
  if (sortMode.value === 'count') return [...list].sort((a, b) => b.count - a.count)
  return [...list].sort((a, b) => collator.value.compare(a.name, b.name))
})
const provinceName = computed(
  () => provinces.value.find((p) => p.code === province.value)?.name ?? '',
)
const provinceSet = computed(() =>
  province.value ? speciesInProvince(provinceData.value, selected.value, province.value) : null,
)
/** 统一网格条目:bank 物种(可玩,带头图)+ 全球骨架物种(未收录媒体,轻量详情) */
interface GridItem {
  slug: string
  name: string
  nameSci: string
  playable: boolean
  thumb: string | null
  bankId: string | null
}
/**
 * S6：名单统一到 bank（权威层 meta，10,844 种，唯一源）。
 * 「可玩」判定改用合并后的 playable——名单内任一带素材即可玩。
 */
/** 短码 → 物种条目（用于徽标/缩略图；排除质量降级种） */
const poolByCode = computed<Map<string, BankSpecies>>(() => {
  const m = new Map<string, BankSpecies>()
  for (const sp of bank.value?.species ?? []) {
    if (sp.taxonKey && !sp.quizExcluded) m.set(shortCodeOf(sp.taxonKey), sp)
  }
  return m
})
/** bank 物种按学名索引(骨架条目 ↔ bank 的桥;夹具 id 非 slug 形式也稳) */
const bankBySci = computed<Map<string, BankSpecies>>(() => {
  const m = new Map<string, BankSpecies>()
  for (const s of bank.value?.species ?? []) if (s.nameSci) m.set(s.nameSci.toLowerCase(), s)
  return m
})
/** 该国全部鸟种（不含省级筛选）：既用于「该地鸟种」列表，也提供「全国 N 种」计数 */
const countryGridItems = computed<GridItem[]>(() => {
  const idx = speciesIdx.value
  if (idx) {
    // bank 物种按 taxonKey 短码直查(骨架条目缺失也照常渲染;真实产物中 1299 全在骨架)
    const codeOfSp = new Map<string, BankSpecies>()
    for (const s of bank.value?.species ?? []) if (s.taxonKey) codeOfSp.set(shortCodeOf(s.taxonKey), s)
    const items: GridItem[] = []
    for (const code of mergedIndex.value[selected.value] ?? []) {
      let sp: BankSpecies | null | undefined = codeOfSp.get(code)
      const e = idx.byShortCode.get(code) ?? null
      if (!sp && e) sp = bankBySci.value.get(e.nameSci.toLowerCase()) ?? speciesById(slugifySci(e.nameSci))
      if (!e && !sp) continue
      // 全球池条目(短码直查;骨架条目缺失时也能判定可玩)
      const gp = poolByCode.value.get(code) ?? null
      const usable = sp ?? gp
      items.push({
        slug: usable ? usable.id : slugifySci(e!.nameSci),
        name: usable ? nameOf(usable) : entryDisplayName(e!, currentLocale()),
        nameSci: usable?.nameSci ?? e!.nameSci,
        playable: !!usable,
        thumb: usable?.image?.thumbUrl || usable?.image?.url || null,
        bankId: sp?.id ?? null,
      })
    }
    return [...items].sort((a, b) => collator.value.compare(a.name, b.name))
  }
  // 降级:bank-only(现行为)
  return (index.value[selected.value] ?? [])
    .map((id) => speciesById(id))
    .filter((sp): sp is BankSpecies => !!sp)
    .map((sp) => ({
      slug: sp.id,
      name: nameOf(sp),
      nameSci: sp.nameSci,
      playable: true,
      thumb: sp.images?.[0]?.thumbUrl || sp.images?.[0]?.url || null,
      bankId: sp.id,
    }))
})
/**
 * 072-j / 074（2026-10-22→23 用户纠正）：物种网格排序。
 *
 * 第一版做的是「按常见度（`province-commonness` 的档位）」——**这个思路是错的**：
 * 档位是"份额分位五等分"（上海每档约 100 种），档位内无法再排序，前端只能退化成
 * "全局 commonness + 名称"，于是出现「暗绿绣眼鸟（2752 条）排在白头鹎（14965 条）前面」。
 * 档位适合**出题分档抽样**，不适合**展示排序**。
 *
 * 现在改为按**记录数**（`region-provinces.json` 的 `bySpecies[id][国家][省]`）降序：
 * 选省 → 该省记录数；只选国家 → 该国各省记录数之和。最多人记录过的鸟排最前。
 */
const speciesSort = ref<'name' | 'records'>('name')

/** 当前选择下「物种 id → 记录数」（一次遍历预计算，避免排序时反复求和） */
const recordCounts = computed(() => {
  const data = provinceData.value
  const cc = selected.value
  const prov = province.value
  const m = new Map<string, number>()
  if (!data?.bySpecies || !cc) return m
  for (const [id, byCc] of Object.entries(data.bySpecies)) {
    const per = byCc?.[cc]
    if (!per) continue
    if (prov) {
      const n = per[prov]
      if (n) m.set(id, n)
    } else {
      let sum = 0
      for (const n of Object.values(per)) sum += n
      if (sum) m.set(id, sum)
    }
  }
  return m
})

/** 某物种在当前选择下的记录数（0 = 无记录） */
const recordCountOf = (id: string | null | undefined) => (id ? (recordCounts.value.get(id) ?? 0) : 0)

/** 省级层仅覆盖 bank 物种:选中省份时只显示省内的 bank 种 */
const sortedGridItems = computed<GridItem[]>(() => {
  const ps = provinceSet.value
  const base = ps ? countryGridItems.value.filter((it) => it.bankId && ps.has(it.bankId)) : countryGridItems.value
  if (speciesSort.value !== 'records') return base
  // 记录数降序 → 名称兜底（保证稳定）；无记录（0）自然排在最后
  return [...base].sort(
    (a, b) =>
      recordCountOf(b.bankId) - recordCountOf(a.bankId) || collator.value.compare(a.name, b.name),
  )
})
/** 主列表（2026-10-23：P0-0 修好 taxonKey 解析缺陷后，原「异常数据」栏已删除——见 docs/075 §5） */
const gridItems = computed(() => sortedGridItems.value)
/** 该国鸟种总数（「该地鸟种 431（全国 1507 种）」里的全国数；与列表同口径） */
const countrySpeciesCount = computed(() => countryGridItems.value.length)
const visibleItems = computed(() => gridItems.value.slice(0, visibleCount.value))
watch([selected, province], () => {
  visibleCount.value = 200
})
const nameOf = (sp: BankSpecies) => speciesName(sp, currentLocale())
const provinceSources = computed(() =>
  (provinceData.value?.sources ?? []).map((s) => s.name).join(' · '),
)

/** 该国观鸟点（腿 B 网格聚合；缺失/无数据则为空，整块隐藏）。
 *  2026-10-09：选中省份时**按 subnational1 过滤到省**；本省无点时回退全国并在窄条说明。 */
const hotspotResult = computed(() => {
  const placed = hotspotsInProvince(countrySpots.value, province.value)
  if (province.value && !placed.matched.length && countrySpots.value.length) {
    return { list: countrySpots.value, fallback: true }
  }
  return { list: province.value ? placed.matched : countrySpots.value, fallback: false }
})
const hotspotList = computed(() => hotspotResult.value.list)
/** 该国点位总数（用于「省份筛选 x（全国 y）」里的 y） */
const hotspotCountryCount = computed(() => countrySpots.value.length)
const hotspotSources = computed(() =>
  (hotspotData.value?.sources ?? []).map((s) => s.name).join(' · '),
)
/** 按国懒加载点位（切国时调用；失败 → 空数组，页面走空态） */
async function loadSpotsFor(cc: string) {
  if (!cc) {
    countrySpots.value = []
    return
  }
  const file = await loadCountrySpots(cc)
  countrySpots.value = spotsOf(file)
}

function toggleHotspot(id: string) {
  expandedHotspot.value = expandedHotspot.value === id ? '' : id
}
/** 代表鸟种显示名：有 manifest id 用本地化名，否则回退学名 */
function topSpeciesName(s: Hotspot['topSpecies'][number]): string {
  const sp = s.id ? speciesById(s.id) : undefined
  return sp ? nameOf(sp) : (s.sci ?? s.id ?? '')
}

/** 移动端触发条上的当前选择摘要：只留「国家 · 省级」（大洲在抽屉里选，不重复展示） */
const selectionLabel = computed(() => {
  const parts = [selected.value ? countryName(selected.value) : '', provinceName.value]
  return parts.filter(Boolean).join(' · ') || t('region.pick')
})

/** 触发条上的结果计数：让「选择已生效」可见（观鸟点 / 鸟种随当前标签页；0 不显示） */
const barCount = computed(() => {
  const spots = activeTab.value === 'spots'
  if (spots && nearby.value) return ''
  const n = spots ? hotspotList.value.length : gridItems.value.length
  if (!n) return ''
  return spots ? t('region.barSpots', { n }) : t('region.count', { n })
})

/** 打开抽屉：并把已选国家滚进可视区（国家按名称排序，选中项可能在下半屏） */
function openPicker() {
  pickerOpen.value = true
  scrollActiveCountryIntoView()
}
function closePicker() {
  pickerOpen.value = false
}
function scrollActiveCountryIntoView() {
  void nextTick(() => {
    const list = panelRef.value?.querySelector<HTMLElement>('.country-list')
    const active = list?.querySelector<HTMLElement>('.country-btn.active')
    if (!list || !active) return
    const r = active.getBoundingClientRect()
    const lr = list.getBoundingClientRect()
    list.scrollTop += r.top - lr.top - 8
  })
}
/** 抽屉收起后把结果列表滚回视野内（否则用户看不到选择已生效） */
function scrollToResults() {
  document
    .querySelector('.birding .species')
    ?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

/** 深链 `?cc=` 可能跨洲：数据就绪后把大洲切到该国家所在洲（否则列表里看不到选中国） */
watch(stats, () => {
  if (!stats.value.length) return
  if (countriesInContinent(stats.value, continent.value).some((s) => s.code === selected.value)) return
  const found = continents.value.find((c) =>
    countriesInContinent(stats.value, c).some((s) => s.code === selected.value),
  )
  if (found) continent.value = found
})

/** 地区变化写回 URL（刷新/分享/后退都能还原） */
watch([selected, province], syncQuery)

/** 切换大洲：搜索清空；若当前国家不属于该洲，自动选中该洲物种最多的国家并展开其省级 */
watch(continent, () => {
  query.value = ''
  if (!continentStats.value.some((s) => s.code === selected.value)) {
    selected.value = continentStats.value[0]?.code ?? ''
    expanded.value = true
  }
  scrollActiveCountryIntoView()
})

/** 切换国家：省级筛选重置并展开二级列表；观鸟点详情收起 */
watch(selected, () => {
  if (!applyingQuery) province.value = ''
  expanded.value = true
  expandedHotspot.value = ''
  void loadSpotsFor(selected.value)
})

/**
 * 点击国家：
 * - 未选 → 选中（有省级细分=中间态，保持抽屉开着继续选省；无省级=终态，移动端直接收起）
 * - 已选且正筛选某省 → 清除省级，回到「全部」
 * - 已选且无省级筛选 → 折叠/展开二级列表
 * 省级列表顶部另有显式「全部」行，不再只靠"再点一次国家"这个隐性手势。
 */
function selectCountry(code: string) {
  if (code !== selected.value) {
    selected.value = code
    if (isMobile.value && !provinceStats(provinceData.value, code, locale.value).length) {
      closePicker()
      void nextTick(scrollToResults)
    }
    return
  }
  if (province.value) {
    province.value = ''
    expanded.value = true
  } else {
    expanded.value = !expanded.value
  }
}

/** 选择省级（'' = 全部省份）：移动端选完收起抽屉，并让下方结果回到视野 */
function pickProvince(code: string) {
  province.value = code
  if (!isMobile.value) return
  closePicker()
  void nextTick(scrollToResults)
}
</script>

<template>
  <!-- 移动端常驻触发条：放在卡片外（.card 的 overflow:hidden 会让内部 sticky 失效）；
       窄屏下这是**唯一**的地区入口，大洲/国家/省级都在抽屉里逐级选。 -->
  <div
    v-if="isMobile && stats.length"
    class="picker-bar-wrap"
    :style="{ top: `${stickyTop}px`, '--region-sticky-top': `${stickyTop}px` }"
  >
    <button
      type="button"
      class="picker-bar"
      aria-haspopup="dialog"
      :aria-controls="pickerOpen ? 'region-picker' : undefined"
      :aria-expanded="pickerOpen"
      :aria-label="t('region.pickCurrent', { current: selectionLabel })"
      @click="openPicker"
    >
      <Globe2 class="ic globe" :size="16" />
      <span class="picker-current">{{ selectionLabel }}</span>
      <span v-if="barCount" class="picker-count">{{ barCount }}</span>
      <ChevronDown class="ic chev" :size="16" />
    </button>
  </div>

  <section class="card region birding" :style="{ '--region-sticky-top': `${stickyTop}px` }">
    <h2 class="region-head"><Globe2 class="ic" :size="22" /> {{ t('birding.title') }}</h2>
    <p class="muted lead">{{ t('birding.lead') }}</p>

    <template v-if="stats.length">
      <!-- 桌面端：大洲胶囊常驻在双栏上方（移动端搬进抽屉，避免一个控件两个交互面） -->
      <nav v-if="!isMobile" class="continents" :aria-label="t('region.continentsLabel')">
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
        <!-- 桌面：左侧常驻国家树；移动端：同一份 DOM Teleport 到 body，变成底部抽屉 -->
        <Teleport to="body" :disabled="!isMobile">
          <template v-if="!isMobile || pickerOpen">
            <div v-if="isMobile" class="sheet-backdrop" @click="closePicker" />
            <aside
              :ref="setPanelRef"
              id="region-picker"
              class="countries"
              :class="{ sheet: isMobile }"
              :role="isMobile ? 'dialog' : undefined"
              :aria-modal="isMobile ? 'true' : undefined"
              :aria-label="isMobile ? t('region.pick') : undefined"
            >
              <div v-if="isMobile" class="sheet-head">
                <p class="sheet-title">{{ t('region.pick') }}</p>
                <button
                  type="button"
                  class="sheet-close"
                  :aria-label="t('common.close')"
                  @click="closePicker"
                >
                  <X class="ic" :size="18" />
                </button>
              </div>
              <nav
                v-if="isMobile"
                class="continents sheet-continents"
                :aria-label="t('region.continentsLabel')"
              >
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
              <label class="search">
                <Search class="ic" :size="14" />
                <input
                  v-model="query"
                  type="search"
                  :aria-label="t('region.searchLabel')"
                  :placeholder="t('region.search')"
                />
              </label>
              <div class="list-head">
                <p class="col-title">{{ t('region.countries') }}</p>
                <div class="sort" role="group" :aria-label="t('region.sortLabel')">
                  <button
                    type="button"
                    class="sort-btn"
                    :class="{ active: sortMode === 'name' }"
                    :aria-pressed="sortMode === 'name'"
                    @click="sortMode = 'name'"
                  >
                    {{ t('region.sortName') }}
                  </button>
                  <button
                    type="button"
                    class="sort-btn"
                    :class="{ active: sortMode === 'count' }"
                    :aria-pressed="sortMode === 'count'"
                    @click="sortMode = 'count'"
                  >
                    {{ t('region.sortCount') }}
                  </button>
                </div>
              </div>
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
                  <!-- 二级：省级行政区（无数据则不出；点击国家展开/折叠；点击国家本身=全部，见 021） -->
                  <ul v-if="s.code === selected && expanded && provinces.length" class="prov-list">
                    <!-- 显式「全部省份」：不再依赖"再点一次国家"这个隐性手势 -->
                    <li>
                      <button
                        type="button"
                        class="prov-btn"
                        :class="{ active: !province }"
                        :aria-pressed="!province"
                        @click="pickProvince('')"
                      >
                        <span class="prov-name">{{ t('region.allProvinces') }}</span>
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
                        <span class="prov-name">{{ p.name }}</span>
                        <span class="prov-count">{{ t('region.count', { n: p.count }) }}</span>
                      </button>
                    </li>
                  </ul>
                </li>
              </ul>
              <div v-if="isMobile" class="sheet-foot">
                <button type="button" class="btn sheet-done" @click="closePicker">
                  {{ t('region.done') }}
                </button>
              </div>
            </aside>
          </template>
        </Teleport>

        <div class="species">
          <!-- 042：标签页顺序为「观鸟点」（默认）/「该地鸟种」 -->
          <div class="panel-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="panel-tab"
              :class="{ active: activeTab === 'spots' }"
              :aria-selected="activeTab === 'spots'"
              @click="setTab('spots')"
            >
              <span class="tab-label">{{ t('region.tabHotspots') }}</span>
              <span class="tab-count">
                <span class="tab-n">{{ nearby ? '' : hotspotList.length }}</span>
                <template v-if="!nearby && province && !hotspotResult.fallback && hotspotCountryCount > hotspotList.length">
                  <span class="tab-sub">{{ t('region.hotspotOfCountry', { n: hotspotCountryCount }) }}</span>
                </template>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              class="panel-tab"
              :class="{ active: activeTab === 'regions' }"
              :aria-selected="activeTab === 'regions'"
              @click="setTab('regions')"
            >
              <span class="tab-label">{{ t('region.tabRegions') }}</span>
              <span class="tab-count">
                <span class="tab-n">{{ gridItems.length }}</span>
                <span v-if="province && countrySpeciesCount > gridItems.length" class="tab-sub">
                  {{ t('region.speciesOfCountry', { n: countrySpeciesCount }) }}
                </span>
              </span>
            </button>
          </div>

          <!-- ---------- 标签页 1：观鸟点（默认） ---------- -->
          <div v-show="activeTab === 'spots'" class="spots-pane">
            <!-- 附近鸟点开关：默认关；开启后本页转为按定位排序的附近点位 -->
            <div class="nearby-bar">
              <button
                type="button"
                class="nearby-toggle"
                :class="{ on: nearby }"
                :aria-pressed="nearby"
                @click="toggleNearby"
              >
                <MapPin v-if="nearby" class="ic" :size="15" />
                <Crosshair v-else class="ic" :size="15" />
                {{ nearby ? t('nearby.backToRegion') : t('nearby.open') }}
              </button>
              <p class="nearby-hint muted">
                {{ nearby ? t('nearby.on') : t('nearby.off') }}
              </p>
            </div>

            <!-- 附近模式：定位 + 半径 + 附近点位（原 /nearby 页面） -->
            <NearbySpotsPanel v-if="nearby" />

            <!-- 地区模式：按所选国家/省份的观鸟点 -->
            <div v-else class="hotspots">
              <p v-if="!hotspotList.length" class="muted">{{ t('region.hotspotEmpty') }}</p>
              <template v-else>
                <p v-if="province && hotspotResult.fallback" class="hotspot-fallback muted">
                  {{ t('region.hotspotFallback', { n: hotspotList.length }) }}
                </p>
                <p v-else-if="province" class="hotspot-scope muted">
                  {{ t('region.hotspotProvinceOnly') }}
                </p>
                <ul class="hotspot-list">
                  <li v-for="h in hotspotList" :key="h.id">
                    <button
                      type="button"
                      class="hotspot-btn"
                      :data-hot="h.id"
                      :aria-expanded="expandedHotspot === h.id"
                      @click="toggleHotspot(h.id)"
                    >
                      <span class="hotspot-name">
                        {{ h.name || `${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}` }}
                      </span>
                      <span class="hotspot-stat muted">
                        {{ t('region.hotspotSpeciesN', { n: h.speciesCount }) }}
                        <template v-if="h.latestObs"> · {{ t('region.hotspotLatest', { d: h.latestObs }) }}</template>
                      </span>
                    </button>
                    <div v-if="expandedHotspot === h.id" class="hotspot-detail">
                      <!-- 明确区分"本点"与"这一带"：本点用 eBird 鸟种数；网格是周边统计，不冒充本点 -->
                      <p v-if="h.gridRecords" class="hotspot-meta muted">
                        {{ t('region.hotspotGridNearby', { km: h.gridKm ?? 0, r: h.gridRecords }) }}
                      </p>
                      <p class="hotspot-sub">{{ t('region.hotspotTopSpecies') }}</p>
                      <a class="hotspot-ext" :href="ebirdHotspotUrl(h.id)" target="_blank" rel="noopener noreferrer">
                        {{ t('region.hotspotOnEbird') }}
                      </a>
                      <ul class="hotspot-spp">
                        <li v-for="(s, si) in h.topSpecies" :key="si">
                          <RouterLink v-if="s.id && speciesById(s.id)" :to="`/species/${s.id}`">
                            {{ topSpeciesName(s) }}
                          </RouterLink>
                          <span v-else>{{ topSpeciesName(s) }}</span>
                          <span class="muted"> ×{{ s.count }}</span>
                        </li>
                      </ul>
                    </div>
                  </li>
                </ul>
                <p class="hotspot-source muted">
                  {{ t('region.hotspotSource', { sources: hotspotSources, n: CELL_DEG }) }}
                </p>
              </template>
            </div>
          </div>

          <!-- ---------- 标签页 2：该地鸟种（只保留鸟种网格） ---------- -->
          <div v-show="activeTab === 'regions'" class="regions-pane">
            <p class="col-title">
              {{
                province
                  ? t('region.speciesTitleProvince', { province: provinceName })
                  : t('region.speciesTitle', { country: countryName(selected) })
              }}
            </p>

            <div class="sort" role="group" :aria-label="t('region.sortSpeciesLabel')">
              <button
                type="button"
                class="sort-btn"
                :class="{ active: speciesSort === 'name' }"
                :aria-pressed="speciesSort === 'name'"
                @click="speciesSort = 'name'"
              >
                {{ t('region.speciesSortName') }}
              </button>
              <button
                type="button"
                class="sort-btn"
                :class="{ active: speciesSort === 'records' }"
                :aria-pressed="speciesSort === 'records'"
                @click="speciesSort = 'records'"
              >
                {{ t('region.speciesSortRecords') }}
              </button>
            </div>
            <ul class="species-grid">
              <li v-for="gi in visibleItems" :key="gi.slug">
                <RouterLink class="species-card" :class="{ 'not-in-bank': !gi.playable }" :to="`/species/${gi.slug}`">
                  <img
                    v-if="gi.thumb"
                    class="thumb"
                    :src="gi.thumb"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span class="sp-text">
                    <span class="sp-name">{{ gi.name }}</span>
                    <span class="sp-sci">{{ gi.nameSci }}</span>
                    <span v-if="gi.bankId && recordCountOf(gi.bankId) > 0" class="sp-count muted">
                      {{ t('region.provinceRecords', { n: recordCountOf(gi.bankId) }) }}
                    </span>
                    <span v-else-if="!gi.playable" class="sp-badge">{{ t('region.notInBank') }}</span>
                  </span>
                </RouterLink>
              </li>
            </ul>
            <div v-if="gridItems.length > visibleItems.length" class="grid-more">
              <button class="btn btn-sm" type="button" @click="visibleCount += 200">
                {{ t('region.showMore') }}
              </button>
            </div>
            <p v-if="provinces.length" class="prov-source muted">
              {{ t('region.provinceSource', { sources: provinceSources }) }}
            </p>
          </div>
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
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.list-head .col-title {
  margin: 12px 0 6px;
}
.sort {
  display: inline-flex;
  border: 2px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.sort-btn {
  padding: 3px 10px;
  border: none;
  background: #fff;
  color: var(--text-light);
  font-size: 0.72rem;
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
/* ---------- 移动端：常驻触发条（放在卡片外，.card 的 overflow:hidden 会让内部 sticky 失效） ---------- */
.picker-bar-wrap {
  position: sticky;
  top: 60px; /* 兜底值；真实值由内联 top + --region-sticky-top（顶栏实测高度）覆盖 */
  z-index: 15;
  margin-bottom: 10px;
}
.picker-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 46px;
  padding: 9px 12px;
  border: 2px solid var(--primary-light);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(63, 122, 95, 0.1);
}
.picker-bar .globe {
  flex-shrink: 0;
  color: var(--primary);
}
.picker-current {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  color: var(--text);
  font-size: 0.88rem;
}
.picker-count {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 400;
  color: var(--text-light);
}
.picker-bar .chev {
  flex-shrink: 0;
  color: var(--text-light);
}

/* ---------- 移动端：底部抽屉（Teleport 到 body；遮罩层，不推挤文档流） ---------- */
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(16, 38, 28, 0.42);
}
.countries.sheet {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 61;
  display: flex;
  flex-direction: column;
  max-height: 88vh;
  max-height: 88dvh; /* 移动端浏览器地址栏收放时不跳动 */
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-radius: var(--radius) var(--radius) 0 0;
  background: #fff;
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.22);
  text-align: left;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sheet-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 700;
}
.sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
}
.sheet-continents {
  flex-shrink: 0;
  /* 允许换行：窄屏下 8 个大洲挤在一行会把「南极洲」顶出可视区 */
  flex-wrap: wrap;
  justify-content: flex-start;
  margin: 8px 0 4px;
}
.sheet-continents .continent-btn {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 0.78rem;
}
.countries.sheet .country-list {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  margin-top: 8px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.sheet-foot {
  flex-shrink: 0;
  padding-top: 10px;
}
.sheet-done {
  width: 100%;
}
/* 抽屉收起后 scrollIntoView 到这里：避开吸顶顶栏 + 触发条（条高 46 + 12 间距） */
.species {
  scroll-margin-top: calc(var(--region-sticky-top, 60px) + 58px);
  /* 关键：Grid 子项默认 min-width:auto，会被内部最长内容（观鸟点英文名等）撑宽，
     把「观鸟点 / 该地鸟种」两个标签一起顶出卡片 —— 必须允许收窄到容器宽度 */
  min-width: 0;
}
.prov-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
.prov-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-count {
  flex-shrink: 0;
  font-size: 0.68rem;
  color: var(--text-light);
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
.sp-badge {
  align-self: flex-start;
  font-size: 0.62rem;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-light);
}
.not-in-bank .sp-name {
  color: var(--text-light);
}
.grid-more {
  margin-top: 12px;
  text-align: center;
}
.prov-source {
  margin-top: 10px;
  font-size: 0.68rem;
}
/* 右侧面板标签页（2026-10-09：鸟种 / 观鸟点并列，替代上下堆叠） */
.panel-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  border-bottom: 2px solid var(--border);
}
.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  border-bottom: 3px solid transparent;
  background: none;
  color: var(--text-light);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: -2px;
}
.panel-tab:hover {
  color: var(--primary);
}
.panel-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.panel-tab .tab-count {
  /* 「124（全国 1929 个）」= 本地数 + 全国数两块；空间不够时整块落到第二行，绝不截断全国数 */
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 3px;
  max-width: 100%;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-light);
  background: #eef3f0;
  border-radius: 999px;
  padding: 1px 7px;
}
.panel-tab .tab-n,
.panel-tab .tab-sub {
  white-space: nowrap;
}
.panel-tab .tab-label {
  white-space: nowrap;
}
/* 窄屏：标签与计数分两行 —— 否则「观鸟点（全国 12353 个）」会把「该地鸟种」挤成竖排 */
@media (max-width: 480px) {
  .panel-tabs {
    gap: 6px;
  }
  .panel-tab {
    flex: 1 1 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    padding: 7px 10px;
    font-size: 0.86rem;
  }
  .panel-tab .tab-count {
    max-width: 100%;
    font-size: 0.66rem;
  }
}
.panel-tab.active .tab-count {
  background: var(--primary);
  color: #fff;
}
.hotspot-scope,
.hotspot-fallback {
  margin: 0 0 8px;
  font-size: 0.72rem;
}
/* 042：附近鸟点开关条 */
.nearby-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
}
.nearby-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #eaf4ef;
  color: var(--primary);
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.nearby-toggle:hover {
  background: #dceee4;
}
.nearby-toggle.on {
  background: var(--grad);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 10px 20px -12px rgba(45, 106, 79, 0.9);
}
.nearby-hint {
  font-size: 0.76rem;
}
.hotspots {
  margin-top: 4px;
}
.hotspot-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hotspot-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font-size: 0.82rem;
  cursor: pointer;
  text-align: left;
}
.hotspot-btn:hover {
  border-color: var(--primary-light);
}
.hotspot-btn[aria-expanded='true'] {
  border-color: var(--primary);
  background: #eaf4ef;
}
.hotspot-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.hotspot-stat {
  flex-shrink: 0;
  font-size: 0.7rem;
}
.hotspot-detail {
  margin: 6px 0 8px 12px;
  padding: 8px 10px;
  border-left: 2px solid var(--border);
  font-size: 0.78rem;
}
.hotspot-meta {
  margin: 0 0 6px;
}
.hotspot-sub {
  margin: 0 0 4px;
  font-weight: 700;
  color: var(--text-light);
  font-size: 0.74rem;
}
.hotspot-spp {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.hotspot-spp a {
  color: var(--primary);
}
.hotspot-source {
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
  border-radius: var(--radius-xs);
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

/* 移动端：单栏 + 抽屉（选择器已 Teleport 到 body，见模板） */
@media (max-width: 640px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
