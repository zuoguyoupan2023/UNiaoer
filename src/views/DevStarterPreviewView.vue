<script setup lang="ts">
/**
 * ⚠️ 临时预览页（2026-10-09，A3 新手池实测用）——**用完即删**。
 *
 * 用途：把 `STARTER_BIRD_IDS`（51 种）摊开给用户实测，一图一音 + 出现在哪些地区，
 * 便于人工增删。**不属于正式功能**：不进导航、不做 i18n（文案硬编码，已在 i18n 扫描白名单登记）。
 *
 * 删除清单（3 步）：
 *   1. 删本文件（src/views/DevStarterPreviewView.vue）
 *   2. 删 src/router/index.ts 里 path: '/dev/starter' 的那一段路由
 *   3. 删 scripts/i18n-scan.mjs 白名单里 DevStarterPreviewView.vue 的条目
 *
 * 数据全部取现成产物：manifest（图/音/名/常见度）+ province-commonness 分片（地区档位）+ region-provinces（省名）。
 */
import { computed, onMounted, ref } from 'vue'
import { cachedSpeciesAssets, loadBank, loadSpeciesAssets, speciesName, type BankSpecies } from '@/core/bank'
import { loadRegionCommonnessIndex, loadRegionCommonnessShard } from '@/core/provinceCommonness'
import { STARTER_BIRD_IDS } from '@/core/starterBirds'

const loading = ref(true)
const failed = ref('')
const species = ref<BankSpecies[]>([])
/** 省码 → 显示名 */
const provinceNames = ref<Record<string, string>>({})
/** 国码 → 省码[]（产物里的省级清单顺序） */
const provincesOf = ref<Record<string, string[]>>({})
/** `${cc}|${provinceCode}` → 该省新手鸟数 */
const provinceStarterCount = ref<Map<string, number>>(new Map())
/** 物种 id → 出现的省 [{cc, code, tier}] */
const placesBySpecies = ref<Map<string, { cc: string; code: string; tier: number }[]>>(new Map())
/** 物种 id → 国家级档位（降级层） */
const countryTierOf = ref<Map<string, number>>(new Map())
const openBird = ref<string | null>(null)
/** assets 分片到位时间戳（建响应依赖；分片是懒加载的） */
const mediaReady = ref(0)

const starterIds = [...STARTER_BIRD_IDS]

onMounted(async () => {
  try {
    const bank = await loadBank()
    const byId = new Map(bank.species.map((s) => [s.id, s]))
    species.value = starterIds.map((id) => byId.get(id)).filter((s): s is BankSpecies => !!s)

    const [provincesRaw, index] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/region-provinces.json`).then((r) => r.json()),
      loadRegionCommonnessIndex(),
    ])
    // 有省级档位的国家（取产物自述口径，避免前端再维护一份常量）
    const ccs = index?.scope?.countries ?? Object.keys(provincesRaw.byCountry ?? {})
    const shards = await Promise.all(
      ccs.map(async (cc: string) => ({
        cc,
        province: await loadRegionCommonnessShard(cc, 'province'),
        country: await loadRegionCommonnessShard(cc, 'country'),
      })),
    )

    const names: Record<string, string> = {}
    const provList: Record<string, string[]> = {}
    for (const [cc, divisions] of Object.entries(provincesRaw.byCountry ?? {})) {
      for (const [code, name] of Object.entries(divisions as Record<string, string>)) names[code] = name
      provList[cc] = Object.keys(divisions as Record<string, string>)
    }
    provinceNames.value = names
    provincesOf.value = provList

    const counts = new Map<string, number>()
    const places = new Map<string, { cc: string; code: string; tier: number }[]>()
    const cTier = new Map<string, number>()
    for (const { cc, province, country } of shards) {
      // 国家级降级层（省不可信时用）
      for (const id of starterIds) {
        const t = country?.tiers?.[id]
        if (Number.isInteger(t)) cTier.set(id, t as number)
      }
      for (const [code, map] of Object.entries(province?.tiersByCode ?? {})) {
        let starterHere = 0
        for (const id of starterIds) {
          const t = map[id]
          if (!Number.isInteger(t)) continue
          starterHere++
          if (!places.has(id)) places.set(id, [])
          places.get(id)!.push({ cc, code, tier: t as number })
        }
        counts.set(`${cc}|${code}`, starterHere)
      }
    }
    provinceStarterCount.value = counts
    placesBySpecies.value = places
    countryTierOf.value = cTier

    // core 层只带首图首音；完整 5+5 在 assets 分片里，按需拉（本页一次性全取，便于核对素材数）
    await Promise.all(starterIds.map((id) => loadSpeciesAssets(id).catch(() => null)))
    mediaReady.value = Date.now()
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

/** 每轮 10 题：本省新手鸟 ≥10 才启用福利池，否则回退常规 L1（与 questionEngine 一致） */
const MIN_TO_ACTIVATE = 10

const provinceRows = computed(() => {
  const rows: { cc: string; code: string; name: string; n: number; on: boolean }[] = []
  for (const [cc, codes] of Object.entries(provincesOf.value)) {
    for (const code of codes) {
      const n = provinceStarterCount.value.get(`${cc}|${code}`) ?? 0
      rows.push({ cc, code, name: provinceNames.value[code] ?? code, n, on: n >= MIN_TO_ACTIVATE })
    }
  }
  return rows.sort((a, b) => a.n - b.n || a.code.localeCompare(b.code))
})

const fallbackProvinces = computed(() => provinceRows.value.filter((r) => !r.on))

/**
 * 诊断：三种"看起来在池里、实际出不来或名不副实"的情况。实测时请重点看这块。
 *  ① 零省覆盖：该鸟在任何省/国档位表里都不存在 → 选地区后**永远不会被选中**
 *     （buildPool 会把表外物种剔除）；多是"概念合并"（与另一条目共享 taxonKey，
 *     档位表只能挂到一个 id 上）。
 *  ② 共享 taxonKey：AviList 把两者并作一种，档位/分布只能落其中一个条目。
 *  ③ 素材不足 5 图 5 音：与池的入选标准不符。
 */
const diagnostics = computed(() => {
  void mediaReady.value // 响应依赖：assets 分片到位后重算素材数
  const zero: { id: string; name: string }[] = []
  const dupKey: { id: string; name: string; others: string[] }[] = []
  const thin: { id: string; name: string; img: number; aud: number }[] = []
  const byKey = new Map<string, string[]>()
  const nameOf = new Map<string, string>()
  for (const sp of species.value) {
    nameOf.set(sp.id, speciesName(sp))
    if (!placesBySpecies.value.get(sp.id)?.length) zero.push({ id: sp.id, name: speciesName(sp) })
    const hit = cachedSpeciesAssets(sp.id) // 完整素材在分片；core 只有首图首音
    const imgs = hit?.images?.length ?? sp.images?.length ?? (sp.image ? 1 : 0)
    const auds = hit?.audios?.length ?? sp.audios?.length ?? (sp.audio ? 1 : 0)
    if (imgs < 5 || auds < 5) thin.push({ id: sp.id, name: speciesName(sp), img: imgs, aud: auds })
    const key = (sp as { taxonKey?: string }).taxonKey
    if (key) {
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(sp.id)
    }
  }
  for (const [, ids] of byKey) {
    if (ids.length < 2) continue
    // 一对只报一条（避免正反重复），列出其余成员
    dupKey.push({
      id: ids[0]!,
      name: nameOf.get(ids[0]!) ?? ids[0]!,
      others: ids.slice(1).map((x) => `${nameOf.get(x) ?? x}（${x}）`),
    })
  }
  return { zero, dupKey, thin }
})

const avgProvinces = computed(() => {
  if (!birdRows.value.length) return '0'
  const total = birdRows.value.reduce((s, r) => s + r.places.length, 0)
  return (total / birdRows.value.length).toFixed(0)
})
const birdRows = computed(() =>
  species.value.map((sp) => {
    const places = placesBySpecies.value.get(sp.id) ?? []
    const byCountry = new Map<string, { code: string; tier: number }[]>()
    for (const p of places) {
      if (!byCountry.has(p.cc)) byCountry.set(p.cc, [])
      byCountry.get(p.cc)!.push({ code: p.code, tier: p.tier })
    }
    return { sp, places, byCountry, countryCount: byCountry.size }
  }),
)

function media(sp: BankSpecies) {
  const img = sp.images?.[0] ?? sp.image
  const aud = sp.audios?.[0] ?? sp.audio
  return { img, aud }
}
</script>

<template>
  <section class="dev">
    <h2>新手池实测预览（临时页）</h2>
    <p class="lead">
      共 {{ species.length }} 种。规则：仅「档案首轮 + L1」生效；先与本省档位表求交，交集 ≥
      {{ MIN_TO_ACTIVATE }} 种才启用，否则回退常规 L1。下面「出现于」= 该鸟进入了哪些省/国的档位表。
    </p>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="failed" class="err">加载失败：{{ failed }}</p>

    <template v-else>
      <h3>〇、诊断（实测重点看这块）</h3>
      <div class="diag">
        <p v-if="diagnostics.zero.length" class="diag-bad">
          <b>零省覆盖 {{ diagnostics.zero.length }} 种</b>——选地区后<b>永远不会被选中</b>
          （档位表里没有它，buildPool 会剔除表外物种）：
          <span v-for="z in diagnostics.zero" :key="z.id" class="chip">{{ z.name }}<i>{{ z.id }}</i></span>
        </p>
        <p v-else class="diag-ok">零省覆盖：无（每一条都能在至少一个省/国里出现）</p>

        <p v-if="diagnostics.dupKey.length" class="diag-warn">
          <b>共享分类学 id {{ diagnostics.dupKey.length }} 对</b>——AviList 视为同一种，
          档位/分布只会落在其中一个条目上（另一个等于空壳）：
          <span v-for="d in diagnostics.dupKey" :key="d.id" class="chip">
            {{ d.name }} ↔ {{ d.others.join('、') }}
          </span>
        </p>
        <p v-else class="diag-ok">共享分类学 id：无</p>

        <p v-if="diagnostics.thin.length" class="diag-warn">
          <b>素材不足 5 图 5 音 {{ diagnostics.thin.length }} 种</b>
          （池的入选标准是核心库 5+5）：
          <span v-for="t in diagnostics.thin" :key="t.id" class="chip">{{ t.name }}<i>{{ t.img }}图{{ t.aud }}音</i></span>
        </p>
        <p v-else class="diag-ok">素材：全部 5 图 5 音 ✓</p>

        <p class="diag-info">
          省覆盖率：平均 {{ avgProvinces }} 个省；<b>回退省 {{ fallbackProvinces.length }} / {{ provinceRows.length }}</b>
          （新手鸟 &lt; {{ MIN_TO_ACTIVATE }} 种 → 首轮走常规 L1，不出错、只是没有"更多熟悉鸟"的加成）。
        </p>
      </div>

      <h3>一、按鸟看（{{ birdRows.length }}）</h3>
      <ul class="birds">
        <li v-for="row in birdRows" :key="row.sp.id" class="bird">
          <div class="head">
            <img v-if="media(row.sp).img" class="thumb" :src="media(row.sp).img!.thumbUrl || media(row.sp).img!.url" alt="" loading="lazy" />
            <div class="names">
              <b>{{ speciesName(row.sp) }}</b>
              <span class="sci">{{ row.sp.nameSci }}</span>
              <span class="muted small">{{ row.sp.family }} · {{ row.sp.id }}</span>
            </div>
            <div class="stats">
              <span class="pill">全局 {{ row.sp.commonness }} 档</span>
              <span class="pill">省 {{ row.places.length }}</span>
              <span class="pill">国 {{ row.countryCount }}</span>
              <span v-if="countryTierOf.get(row.sp.id)" class="pill muted-pill">
                国家层 {{ countryTierOf.get(row.sp.id) }} 档
              </span>
            </div>
          </div>
          <audio
            v-if="media(row.sp).aud"
            crossorigin="anonymous"
            :src="media(row.sp).aud!.url"
            controls
            preload="none"
          ></audio>
          <button class="more" type="button" @click="openBird = openBird === row.sp.id ? null : row.sp.id">
            {{ openBird === row.sp.id ? '收起' : `出现在哪些地方（${row.places.length} 省）` }}
          </button>
          <ul v-if="openBird === row.sp.id" class="places">
            <li v-for="[cc, list] in [...row.byCountry.entries()]" :key="cc">
              <b>{{ cc }}</b>
              <span v-for="p in list.slice().sort((a, b) => a.tier - b.tier)" :key="p.code" class="chip">
                {{ provinceNames[p.code] ?? p.code }}<i>{{ p.tier }}</i>
              </span>
            </li>
          </ul>
        </li>
      </ul>

      <h3>二、按省看（启用 / 回退）</h3>
      <p class="muted small">
        「回退」= 该省档位表里的新手鸟不足 {{ MIN_TO_ACTIVATE }} 种，首轮照旧走常规 L1（不是出错）。
        共 {{ provinceRows.length }} 省；回退 {{ fallbackProvinces.length }} 省。
      </p>
      <table class="tbl">
        <thead>
          <tr><th>省</th><th>新手鸟数</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in provinceRows" :key="r.code" :class="{ off: !r.on }">
            <td>{{ r.name }} <span class="muted small">{{ r.code }}</span></td>
            <td>{{ r.n }}</td>
            <td>{{ r.on ? '启用' : '回退' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.dev {
  font-size: 0.88rem;
}
.lead {
  color: var(--text-light);
  line-height: 1.7;
}
h3 {
  margin: 22px 0 10px;
}
.birds {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 10px;
}
.bird {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: #fff;
}
.head {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.thumb {
  width: 64px;
  height: 52px;
  object-fit: cover;
  border-radius: 8px;
  flex: 0 0 auto;
}
.names {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 150px;
  flex: 1;
}
.sci {
  font-style: italic;
  color: var(--text-light);
}
.stats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.pill {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--primary);
}
.muted-pill {
  background: #f2f4f3;
  color: var(--text-light);
}
.small {
  font-size: 0.74rem;
}
.muted {
  color: var(--text-light);
}
.err {
  color: var(--wrong);
}
audio {
  width: 100%;
  height: 32px;
  margin-top: 8px;
}
.more {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f7faf8;
  padding: 4px 10px;
  font-size: 0.76rem;
  cursor: pointer;
}
.places {
  list-style: none;
  padding: 8px 0 0;
  margin: 0;
  display: grid;
  gap: 6px;
  font-size: 0.76rem;
}
.chip {
  display: inline-block;
  margin: 2px 4px 0 0;
  padding: 1px 7px;
  border-radius: 6px;
  background: #f2f4f3;
}
.chip i {
  font-style: normal;
  color: var(--primary);
  font-weight: 700;
  margin-left: 3px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.tbl th,
.tbl td {
  border-bottom: 1px solid var(--border);
  padding: 5px 8px;
  text-align: left;
}
.tbl tr.off {
  color: #8a6d00;
  background: #fffdf3;
}
</style>
