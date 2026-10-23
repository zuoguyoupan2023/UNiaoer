<script setup lang="ts">
/**
 * 036（用户 2026-10-08 决策 D）：**省份热力条**——某物种在各省级区划的出现强度。
 *
 * 为什么不是地图：铁律 6 要求边界逐项复核；热力条信息量等价且零边界风险（见 docs/037）。
 * 数据：省级层分片（P1-6，2026-10-23）——只读该物种所在的前缀桶
 * `data/region-species/<前两位>.json`（实测最大 133KB / brotli 33KB），
 * 不再整包下载 3MB 的单文件；国家/省名与署名取自 `region-provinces/index.json`。
 *
 * 口径与诚实性（重要）：
 *   · 条形长度用 **平方根缩放**——原始记录数跨度极大（实测 1 ~ 1.3 亿），线性会让其余条形不可见；
 *   · 记录数受**观测努力**与**单一数据集**影响（实测：蒙古沙鸻占香港记录 94.7%），
 *     故本视图是"公开记录多少"的相对比较，**不是严格丰度**（docs/036 §1.3 实测）；
 *   · 只计能映射到 ISO 省名的记录（该国未归属省份的记录不在内）。
 *   · 无该物种省级数据时整块不显示（未覆盖的种暂无省级数据，见 docs/036 §1.2）。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MapPinned } from 'lucide-vue-next'
import {
  loadProvincesIndex,
  loadSpeciesProvinces,
  provincesOf,
  type ProvinceIndex,
} from '@/core/provinces'
import { regionLabel } from '@/core/region'
import { currentLocale } from '@/i18n'

const props = defineProps<{ speciesId: string }>()
const { t } = useI18n()

const index = ref<ProvinceIndex | null>(null)
const byCountry = ref<Record<string, Record<string, number>>>({})
const expanded = ref(false)

onMounted(async () => {
  const [idx, shard] = await Promise.all([
    loadProvincesIndex(),
    loadSpeciesProvinces(props.speciesId),
  ])
  index.value = idx
  byCountry.value = shard?.bySpecies?.[props.speciesId] ?? {}
})

/** 地区名：统一入口（铁律 6） */
function countryName(code: string): string {
  return regionLabel(code, t, currentLocale())
}

interface Row {
  key: string
  code: string
  country: string
  name: string
  count: number
}

/** 该物种有记录的省，按记录数降序 */
const rows = computed<Row[]>(() => {
  const d = index.value
  if (!d) return []
  const out: Row[] = []
  for (const [cc, counts] of Object.entries(byCountry.value)) {
    if (!counts) continue
    const names = new Map(provincesOf(d, cc, currentLocale()).map((p) => [p.code, p.name]))
    for (const [code, count] of Object.entries(counts)) {
      if (!count) continue
      out.push({
        key: `${cc}|${code}`,
        code,
        country: cc,
        name: names.get(code) ?? code,
        count,
      })
    }
  }
  return out.sort((a, b) => b.count - a.count)
})

const TOP_N = 8
const shown = computed(() => (expanded.value ? rows.value : rows.value.slice(0, TOP_N)))
const hasMore = computed(() => rows.value.length > TOP_N)

/**
 * 条形长度：**平方根缩放**（count/max 的平方根）。
 * 取舍：线性会在记录数跨度大时把小值压到看不见；纯 log10 又会让前几名几乎一样长
 * （实测麻雀：100,787 与 26,942 只差 15% 长度）。平方根介于两者之间——
 * 保留名次区分度，同时让小值仍可见。
 */
function barWidth(count: number): string {
  const max = Math.max(...rows.value.map((r) => r.count), 1)
  const w = Math.sqrt(count / max) * 100
  return `${Math.max(w, 4)}%`
}

const sourcesText = computed(() => (index.value?.sources ?? []).map((s) => s.name).join(' · '))
const fmt = (n: number) => n.toLocaleString('en-US')
</script>

<template>
  <section v-if="rows.length" class="prov">
    <h3 class="head">
      <MapPinned class="ic" :size="16" /> {{ t('species.provinces.title') }}
      <span class="muted small n">（{{ t('species.provinces.count', { n: rows.length }) }}）</span>
    </h3>

    <ul class="bars" role="list">
      <li v-for="r in shown" :key="r.key" class="bar-row" :title="`${r.name} · ${countryName(r.country)}: ${fmt(r.count)}`">
        <span class="label">
          <span class="pname">{{ r.name }}</span>
          <span class="muted cname">{{ countryName(r.country) }}</span>
        </span>
        <span class="track"><span class="fill" :style="{ width: barWidth(r.count) }"></span></span>
        <span class="num muted">{{ fmt(r.count) }}</span>
      </li>
    </ul>

    <button v-if="hasMore" class="btn btn-secondary more" type="button" @click="expanded = !expanded">
      {{ expanded ? t('species.provinces.collapse') : t('species.provinces.showAll', { n: rows.length }) }}
    </button>

    <p class="note muted small">
      {{ t('species.provinces.scaleNote') }}
      <template v-if="sourcesText">· {{ t('species.provinces.source', { sources: sourcesText }) }}</template>
    </p>
  </section>
</template>

<style scoped>
.prov {
  text-align: left;
  margin-top: 14px;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  margin-bottom: 8px;
}
.head .ic {
  color: var(--primary);
}
.head .n {
  font-weight: 400;
}
.bars {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(84px, 132px) 1fr auto;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
}
.label {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.pname {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cname {
  font-size: 0.68rem;
  flex-shrink: 0;
}
.track {
  height: 10px;
  background: #eef3f0;
  border-radius: var(--radius-xs);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-xs);
  background: linear-gradient(90deg, var(--primary-light), var(--primary));
}
.num {
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;
}
.more {
  margin-top: 8px;
  font-size: 0.76rem;
  padding: 4px 10px;
}
.note {
  margin-top: 8px;
  line-height: 1.6;
}
</style>
