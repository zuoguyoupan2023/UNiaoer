<script setup lang="ts">
/**
 * `/duyin` 中文鸟名与读音（2026-10-18）。
 *
 * 数据是**构建期预计算**的 `public/data/duyin.json`（`npm run build:duyin`）：
 * 拼音由 `pinyin-pro` 在构建期算好，前端**不引拼音库** —— 否则会白撑首屏 bundle
 * （与 2026-10-17 onnxruntime 27 MiB 事故同类错误）。
 *
 * 每条：中文名 + 带声调符号拼音 + 数字声调 + 轻声位置（哪个字）+ 学名/英文名 + 中国可见标记。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from 'lucide-vue-next'

interface DuyinEntry {
  zh: string
  py: string
  pyNum: string
  light: number[]
  key: string
  sci: string
  en: string | null
  family: string | null
  taxonKey: string | null
  rankCN: number | null
  inCN: boolean
}
interface DuyinFile {
  buckets: Record<string, DuyinEntry[]>
  counts?: { total?: number }
}

const { t } = useI18n()
const loading = ref(true)
const failed = ref(false)
const all = ref<DuyinEntry[]>([])
const q = ref('')
const toneNum = ref(false)
const onlyCN = ref(false)

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/duyin.json`)
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as DuyinFile
    all.value = Object.values(data.buckets || {}).flat() as DuyinEntry[]
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})

const needle = computed(() => q.value.trim().toLowerCase().replace(/\s+/g, ''))

const filtered = computed(() => {
  const n = needle.value
  return all.value.filter((e) => {
    if (onlyCN.value && !e.inCN) return false
    if (!n) return true
    return (
      e.zh.includes(n) ||
      (e.key && e.key.includes(n)) ||
      (e.py || '').toLowerCase().includes(n) ||
      (e.sci || '').toLowerCase().replace(/\s+/g, '').includes(n)
    )
  })
})

/** 按拼音首字母分组；空结果时给一段引导 */
const groups = computed(() => {
  const map = new Map<string, DuyinEntry[]>()
  for (const e of filtered.value) {
    const k = (e.key || '#').charAt(0)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return [...map.entries()].sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0])))
})

/** 字母索引条（只显示实际存在的字母） */
const letters = computed(() => LETTERS.filter((l) => groups.value.some(([k]) => k === l)))
function jumpTo(letter: string) {
  q.value = letter
  document.getElementById(`duyin-${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 轻声标记：把轻声音节包起来（数字声调模式下用 5 已能看出，这里只做视觉强调） */
function isLight(e: DuyinEntry, index: number): boolean {
  return e.light.includes(index)
}
function lightHtml(e: DuyinEntry): string {
  const parts = (toneNum.value ? e.pyNum || e.py : e.py).split(' ')
  const marks = parts.map((s, i) => (isLight(e, i) ? `${s}′` : s))
  return marks.join(' ')
}
const lightTotal = computed(() => all.value.filter((e) => e.light.length).length)
</script>

<template>
  <section class="card duyin">
    <h2 class="head">{{ t('duyin.title') }}</h2>
    <p class="muted lead">{{ t('duyin.lead') }}</p>

    <div class="toolbar">
      <label class="search">
        <Search class="ic" :size="15" />
        <input
          v-model="q"
          type="search"
          :aria-label="t('duyin.search')"
          :placeholder="t('duyin.searchPlaceholder')"
        />
        <button v-if="q" class="clear" type="button" :aria-label="t('common.close')" @click="q = ''">
          <X class="ic" :size="14" />
        </button>
      </label>
      <label class="chk">
        <input v-model="toneNum" type="checkbox" />
        <span>{{ toneNum ? t('duyin.toneNum') : t('duyin.toneSymbol') }}</span>
      </label>
      <label class="chk">
        <input v-model="onlyCN" type="checkbox" />
        <span>{{ t('duyin.onlyCN') }}</span>
      </label>
      <span class="count">{{ t('duyin.count', { n: filtered.length }) }}</span>
    </div>

    <nav v-if="letters.length" class="letters" :aria-label="t('duyin.search')">
      <button
        v-for="l in letters"
        :key="l"
        class="letter"
        type="button"
        @click="jumpTo(l)"
      >
        {{ l.toUpperCase() }}
      </button>
    </nav>

    <p v-if="loading" class="muted empty" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="failed" class="err" role="alert">{{ t('duyin.unavailable') }}</p>
    <p v-else-if="!groups.length" class="muted empty">{{ t('duyin.empty') }}</p>

    <div v-else class="groups">
      <section v-for="[letter, list] in groups" :id="`duyin-${letter}`" :key="letter" class="group">
        <h3 class="letter-h">{{ letter === '#' ? t('duyin.other') : letter.toUpperCase() }}</h3>
        <ul class="list">
          <li v-for="e in list" :key="e.taxonKey || e.sci + e.zh" class="item">
            <span class="zh">{{ e.zh }}</span>
            <span class="py" :title="lightTotal ? t('duyin.lightMark') : ''">{{ lightHtml(e) }}</span>
            <RouterLink v-if="e.taxonKey" class="sci" :to="`/species/${e.taxonKey}`">
              {{ e.sci }}
            </RouterLink>
            <span v-else class="sci plain">{{ e.sci }}</span>
            <span v-if="e.rankCN" class="rank">#{{ e.rankCN }}</span>
            <span v-if="e.inCN" class="cn" :aria-label="t('duyin.onlyCN')">{{ t('duyin.cnBadge') }}</span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.duyin {
  text-align: center;
}
.head {
  font-size: 1.3rem;
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 14px;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}
.search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 260px;
  max-width: 420px;
  padding: 6px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.search .ic {
  color: var(--text-light);
  flex: none;
}
.search input {
  flex: 1;
  border: 0;
  outline: none;
  font-family: inherit;
  font-size: 0.9rem;
  min-width: 0;
}
.clear {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--text-light);
  display: inline-flex;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: var(--text-light);
  cursor: pointer;
}
.count {
  font-size: 0.78rem;
  color: var(--text-light);
}
.letters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 14px;
  justify-content: center;
}
.letter {
  min-width: 26px;
  padding: 2px 5px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--primary);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.letter:hover {
  background: var(--primary-light, #eaf4ef);
}
.empty {
  margin: 16px 0;
}
.err {
  margin-top: 12px;
  color: var(--wrong);
  font-size: 0.82rem;
}
.groups {
  text-align: left;
}
.group {
  margin-bottom: 18px;
}
.letter-h {
  font-size: 0.9rem;
  color: var(--primary);
  border-bottom: 2px solid var(--border);
  padding-bottom: 3px;
  margin-bottom: 8px;
  scroll-margin-top: 12px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 4px 14px;
}
.item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.86rem;
  padding: 2px 0;
}
.zh {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.py {
  color: var(--primary-dark);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sci {
  font-size: 0.74rem;
  font-style: italic;
  color: var(--text-light);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sci:hover {
  text-decoration: underline;
}
.rank {
  font-size: 0.68rem;
  color: var(--text-light);
}
.cn {
  font-size: 0.62rem;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: #eef1f0;
  color: var(--text-light);
  flex: none;
}
</style>
