<script setup lang="ts">
/**
 * `/duyin` 中文鸟名与读音（2026-10-18）。
 *
 * 数据是**构建期预计算**的 `public/data/duyin.json`（`npm run build:duyin`）：
 * 拼音由 `pinyin-pro` 在构建期算好，前端**不引拼音库** —— 否则会白撑首屏 bundle
 * （与 2026-10-17 onnxruntime 27 MiB 事故同类错误）。
 *
 * 版式（2026-10-18 定稿）：
 *  · **默认两行**：拼音在上（醒目引导行），中文名在下。
 *    拼音与名字**分两行而非并成一行**——一行时长拼音会把中文名挤到省略号。
 *  · **详情最多四行**：拼音 / 中文名 / 学名 / 英文名；英文界面下顺序为 英文名 / 学名 / 拼音 / 中文名。
 *  · **一行 8 个**（宽屏）→ 3 个（窄屏）→ 内容过长时自动降到 2 / 1 个：
 *    列数 = min(视口档位, 内容档位)，内容档位由当前结果里**最长的拼音+名字**决定，
 *    保证「名字很长时不折行、不塌版」，只是每行变少。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Search, X } from 'lucide-vue-next'

interface DuyinEntry {
  zh: string
  py: string
  pyNum: string
  light: number[]
  /** 读音待人工确认的音节下标（构建期不编读音，见 build-duyin-index 的 PENDING_READINGS） */
  pending: number[]
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
}

const { t, locale: appLocale } = useI18n()
const loading = ref(true)
const failed = ref(false)
const all = ref<DuyinEntry[]>([])
const q = ref('')
const toneNum = ref(false)
const onlyCN = ref(false)
const detail = ref(false)

/** 英文界面下详情顺序为 英文名 / 学名 / 拼音 / 中文名；中文界面为 拼音 / 中文名 / 学名 / 英文名 */
const isEn = computed(() => appLocale.value !== 'zh-CN')

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

/** 按拼音首字母分组 */
const groups = computed(() => {
  const map = new Map<string, DuyinEntry[]>()
  for (const e of filtered.value) {
    const k = (e.key || '#').charAt(0)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return [...map.entries()].sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0])))
})

const letters = computed(() => LETTERS.filter((l) => groups.value.some(([k]) => k === l)))
function jumpTo(letter: string) {
  q.value = letter
  document.getElementById(`duyin-${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 一条卡片要渲染的行（默认取前两行 = 「名称 + 拼音」；详情模式取全部）。
 * 中文界面：拼音 / 中文名 / 学名 / 英文名
 * 英文界面：英文名 / 学名 / 拼音 / 中文名
 */
interface DuyinLine {
  cls: 'py' | 'zh' | 'sci' | 'en'
  text: string
  to?: string
  rankCN?: number | null
  inCN?: boolean
}
function linesOf(e: DuyinEntry): DuyinLine[] {
  const py: DuyinLine = { cls: 'py', text: pyOf(e) }
  const zh: DuyinLine = { cls: 'zh', text: e.zh, rankCN: e.rankCN, inCN: e.inCN }
  const sci: DuyinLine = { cls: 'sci', text: e.sci, to: e.taxonKey ? `/species/${e.taxonKey}` : undefined }
  const en: DuyinLine = { cls: 'en', text: e.en || t('duyin.noEn') }
  const full: DuyinLine[] = isEn.value ? [en, sci, py, zh] : [py, zh, sci, en]
  return detail.value ? full : full.slice(0, 2)
}

/**
 * 拼音（声调符号 ⇄ 数字，轻声加 ′ 标记）。
 * `pending`（读音待确认）的音节显示 `?` —— **宁可显示问号，也不给一个可能错的读音**
 * （用户会照着念）。
 */
function pyOf(e: DuyinEntry): string {
  const parts = (toneNum.value ? e.pyNum || e.py : e.py).split(' ')
  return parts
    .map((s, i) => {
      if (e.pending?.includes(i)) return '?'
      return e.light.includes(i) ? `${s}′` : s
    })
    .join(' ')
    .trim()
}

/**
 * 列数：视口档位（8 → 6 → 4 → 3 → 2 → 1）与**内容档位**取小。
 * 内容档位按当前结果里最长的一条算（拼音 + 中文名字数）：
 *   ≤ 14 字 → 不限；≤ 20 → 4 列；≤ 26 → 3 列；更长 → 2 列。
 * 这样「名字特别长」时不会折行塌版，只是每行放的条数变少。
 */
const cols = computed(() => {
  const vp = colsByViewport()
  const list = filtered.value
  if (!list.length) return vp
  let widest = 0
  for (const e of list) {
    const len = (pyOf(e).length + e.zh.length + 1) | 0
    if (len > widest) widest = len
  }
  const byContent = widest <= 14 ? 8 : widest <= 20 ? 4 : widest <= 26 ? 3 : 2
  return Math.max(1, Math.min(vp, byContent))
})
function colsByViewport(): number {
  if (typeof window === 'undefined') return 4
  const w = window.innerWidth
  if (w >= 1400) return 8
  if (w >= 1100) return 6
  if (w >= 800) return 4
  if (w >= 520) return 3
  if (w >= 300) return 2
  return 1
}
const gridStyle = computed(() => ({ gridTemplateColumns: `repeat(${cols.value}, minmax(0, 1fr))` }))

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
        <input v-model="detail" type="checkbox" />
        <Info class="ic" :size="13" />
        <span>{{ t('duyin.detail') }}</span>
      </label>
      <label class="chk">
        <input v-model="onlyCN" type="checkbox" />
        <span>{{ t('duyin.onlyCN') }}</span>
      </label>
      <span class="count">{{ t('duyin.count', { n: filtered.length }) }}</span>
    </div>

    <nav v-if="letters.length" class="letters" :aria-label="t('duyin.search')">
      <button v-for="l in letters" :key="l" class="letter" type="button" @click="jumpTo(l)">
        {{ l.toUpperCase() }}
      </button>
    </nav>

    <p v-if="loading" class="muted empty" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="failed" class="err" role="alert">{{ t('duyin.unavailable') }}</p>
    <p v-else-if="!groups.length" class="muted empty">{{ t('duyin.empty') }}</p>

    <div v-else class="groups">
      <section v-for="[letter, list] in groups" :id="`duyin-${letter}`" :key="letter" class="group">
        <h3 class="letter-h">{{ letter === '#' ? t('duyin.other') : letter.toUpperCase() }}</h3>
        <ul class="list" :style="gridStyle">
          <li v-for="e in list" :key="e.taxonKey || e.sci + e.zh" class="item">
            <template v-for="(ln, i) in linesOf(e)" :key="i">
              <RouterLink v-if="ln.to" class="ln" :class="ln.cls" :to="ln.to">
                {{ ln.text }}
              </RouterLink>
              <span v-else class="ln" :class="ln.cls" :title="ln.cls === 'py' && lightTotal ? t('duyin.lightMark') : ''">
                {{ ln.text }}
                <template v-if="ln.cls === 'zh'">
                  <span v-if="ln.rankCN" class="rank">#{{ ln.rankCN }}</span>
                  <span v-if="ln.inCN" class="cn">{{ t('duyin.cnBadge') }}</span>
                </template>
              </span>
            </template>
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
  white-space: nowrap;
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
  background: #eaf4ef;
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
  /* 列数由 JS 给（视口档位 × 内容档位取小）；minmax(0,1fr) 让长名字不撑破栅格 */
  gap: 6px 12px;
}
.item {
  min-width: 0; /* 关键：允许格内收缩，长名字才不会把布局挤变形 */
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px;
  border-radius: var(--radius-xs);
  overflow-wrap: anywhere;
}
.item:hover {
  background: #f6f8f7;
}
/* 行基类 */
.ln {
  min-width: 0;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 第 1 行（中文界面）：拼音，醒目引导行 */
.py {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--primary-dark);
  font-variant-numeric: tabular-nums;
}
/* 第 2 行（中文界面）：中文名 */
.zh {
  font-size: 0.88rem;
  color: var(--text);
}
.rank {
  font-size: 0.68rem;
  color: var(--text-light);
  margin-left: 3px;
}
.cn {
  font-size: 0.62rem;
  padding: 0 3px;
  border-radius: var(--radius-xs);
  background: #eef1f0;
  color: var(--text-light);
  margin-left: 3px;
}
/* 详情第 3–4 行 */
.sci {
  font-size: 0.72rem;
  white-space: nowrap;
  font-style: italic;
  color: var(--text-light);
  text-decoration: none;
}
.sci:hover {
  text-decoration: underline;
}
.plain {
  color: var(--text-light);
}
.en {
  font-size: 0.72rem;
  color: var(--text-light);
}
</style>
