<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Flag, ThumbsDown, ThumbsUp } from 'lucide-vue-next'
import {
  loadBank,
  loadSpeciesAssets,
  speciesById,
  speciesName,
  type BankSpecies,
} from '@/core/bank'
import { listPublicReports, voteReport, type PublicReport } from '@/core/reportsApi'
import { getClientId } from '@/core/anonymousId'
import { currentLocale } from '@/i18n'
import AttributionLine from '@/components/AttributionLine.vue'
import type { MediaAsset } from '@/types'

const route = useRoute()
const { t } = useI18n()
const loading = ref(true)
const failed = ref(false)
const total = ref(0)
const reports = ref<PublicReport[]>([])
const myVotes = ref<Record<string, number>>({})
/** species_id → 完整素材池（029 分片；桶级去重/重试在 bank 内部），按 URL 找回署名素材用 */
const pools = reactive<Record<string, { images?: MediaAsset[]; audios?: MediaAsset[] } | null>>({})
/** 内联加载失败的素材（图 404/解码失败；音 src 出错）→ 回退为外链 */
const mediaFail = reactive(new Set<string>())

const speciesFilter = computed(() => (route.query.species as string) || undefined)

onMounted(async () => {
  try {
    await loadBank().catch(() => null)
    const res = await listPublicReports({ species: speciesFilter.value, limit: 50 })
    reports.value = res.reports
    total.value = res.total
    for (const r of reports.value) {
      const id = r.species_id
      if (!id || id in pools) continue
      void loadSpeciesAssets(id)
        .then((p) => (pools[id] = p ?? null))
        .catch(() => (pools[id] = null))
    }
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})

function speciesOf(id: string | null): BankSpecies | undefined {
  return id ? speciesById(id) : undefined
}
function displayName(r: PublicReport): string {
  const sp = speciesOf(r.species_id)
  return sp ? speciesName(sp, currentLocale()) : r.species_name || r.species_id || ''
}
function isAudio(r: PublicReport): boolean {
  return r.question_type === 'audio'
}
/**
 * 报错涉及的素材 → 带署名的 MediaAsset（铁律 5）。
 * 报错只存了 media_url；要内联展示必须找回落到该 URL 的池内素材拿署名，
 * 找不到（素材库已更新/分片加载失败）就不内联展示，只给外链——不展示无署名媒体。
 */
function matchedMedia(r: PublicReport): MediaAsset | undefined {
  const url = r.media_url
  if (!url) return undefined
  const sp = speciesOf(r.species_id)
  const pool = r.species_id ? pools[r.species_id] : null
  const wantAudio = isAudio(r)
  const cands: MediaAsset[] = []
  if (pool) cands.push(...(wantAudio ? (pool.audios ?? []) : (pool.images ?? [])))
  if (sp) {
    const core = wantAudio ? [sp.audio, ...(sp.audios ?? [])] : [sp.image, ...(sp.images ?? [])]
    for (const m of core) if (m) cands.push(m)
  }
  return (
    cands.find((m) => m.url === url) ??
    cands.find(
      (m) => m.thumbUrl === url || m.avifUrl === url || m.xlUrl === url || m.originalUrl === url,
    )
  )
}
function dateOf(at: number): string {
  try {
    return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' }).format(new Date(at))
  } catch {
    return new Date(at).toLocaleDateString()
  }
}

async function vote(r: PublicReport, value: 1 | -1) {
  try {
    const res = await voteReport(r.id, value, getClientId())
    r.up = res.up
    r.down = res.down
    myVotes.value = { ...myVotes.value, [r.id]: res.myVote }
  } catch {
    /* 投票失败（离线/限流）：忽略 */
  }
}
</script>

<template>
  <section class="card reports">
    <h2 class="head"><Flag class="ic" :size="22" /> {{ t('reports.title') }}</h2>
    <p class="muted lead">{{ t('reports.lead') }}</p>
    <p v-if="!loading && !failed" class="count">{{ t('reports.count', { n: total }) }}</p>

    <p v-if="loading" class="muted empty" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="failed" class="muted empty" role="alert">{{ t('reports.unavailable') }}</p>
    <p v-else-if="!reports.length" class="muted empty" role="status">{{ t('reports.empty') }}</p>

    <ul v-else class="list">
      <li v-for="r in reports" :key="r.id" class="item">
        <RouterLink v-if="r.species_id" class="name" :to="`/species/${r.species_id}`">
          {{ displayName(r) }}
        </RouterLink>
        <span v-else class="name">{{ displayName(r) }}</span>

        <!-- 做题时报错的那条素材（含署名行）；找不到署名素材则只给外链 -->
        <div v-if="r.media_url" class="media">
          <template v-if="matchedMedia(r) && !mediaFail.has(r.id)">
            <img
              v-if="!isAudio(r)"
              class="media-img"
              :src="r.media_url"
              loading="lazy"
              alt=""
              @error="mediaFail.add(r.id)"
            />
            <!-- crossorigin 必须先于 src 设置（Safari 只读设置 src 那一刻的值，docs/033） -->
            <audio
              v-else
              class="media-audio"
              crossorigin="anonymous"
              :src="r.media_url"
              controls
              preload="none"
              @error="mediaFail.add(r.id)"
            ></audio>
            <AttributionLine :media="matchedMedia(r)" />
          </template>
          <p v-else class="media-missing">
            {{ t('reports.mediaMissing') }}
            <a :href="r.media_url" target="_blank" rel="noopener noreferrer">
              {{ t('reports.openMedia') }}
            </a>
          </p>
        </div>

        <p class="sec-title">{{ t('reports.userReport') }}</p>
        <p class="type-row">
          <span class="reason">{{ t(`report.reasons.${r.reason}`) }}</span>
          <span v-if="r.status === 'fixed'" class="status fixed">
            {{ t('reports.status.fixed') }}
          </span>
        </p>
        <p v-if="r.note" class="note">{{ r.note }}</p>
        <p v-if="r.suggested_answer" class="suggest">
          {{ t('reports.suggested', { name: r.suggested_answer }) }}
        </p>

        <div class="vote-row">
          <span class="vote-q">{{ t('reports.voteQuestion') }}</span>
          <div class="vote-btns">
            <button
              type="button"
              class="vote"
              :class="{ on: myVotes[r.id] === 1 }"
              :aria-pressed="myVotes[r.id] === 1"
              :aria-label="t('reports.upvoteCount', { n: r.up })"
              @click="vote(r, 1)"
            >
              <ThumbsUp :size="14" /> {{ t('reports.agree') }} <b>{{ r.up }}</b>
            </button>
            <button
              type="button"
              class="vote down"
              :class="{ on: myVotes[r.id] === -1 }"
              :aria-pressed="myVotes[r.id] === -1"
              :aria-label="t('reports.downvoteCount', { n: r.down })"
              @click="vote(r, -1)"
            >
              <ThumbsDown :size="14" /> {{ t('reports.disagree') }} <b>{{ r.down }}</b>
            </button>
          </div>
        </div>

        <p class="meta">{{ dateOf(r.created_at) }}</p>
      </li>
    </ul>

    <p class="contact">{{ t('reports.contact') }}</p>
  </section>
</template>

<style scoped>
.reports {
  text-align: center;
}
.head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.head .ic {
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
.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 680px;
  margin: 0 auto;
  text-align: left;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.name {
  font-weight: 800;
  font-size: 1rem;
  color: var(--text);
}
a.name:hover {
  color: var(--primary);
}
.media {
  text-align: center;
}
.media-img {
  display: block;
  max-width: 100%;
  max-height: 260px;
  margin: 0 auto;
  object-fit: contain;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: #f5f8f6;
}
.media-audio {
  width: 100%;
  max-width: 420px;
}
.media :deep(.attribution) {
  text-align: center;
  margin-top: 6px;
  padding-top: 6px;
}
.media-missing {
  font-size: 0.78rem;
  color: var(--text-light);
  background: #f5f8f6;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  justify-content: center;
  align-items: baseline;
}
.media-missing a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.sec-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-light);
  margin-top: 2px;
}
.type-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.reason {
  font-size: 0.74rem;
  padding: 2px 9px;
  border-radius: var(--radius-xs);
  background: #fdf3d8;
  color: #8a6d00;
}
.status.fixed {
  font-size: 0.72rem;
  padding: 2px 9px;
  border-radius: var(--radius-xs);
  background: #eaf4ef;
  color: var(--primary);
}
.note {
  font-size: 0.85rem;
  color: var(--text);
}
.suggest {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--primary);
}
.vote-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
  margin-top: 2px;
}
.vote-q {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
}
.vote-btns {
  display: flex;
  gap: 8px;
}
.vote {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text);
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
}
.vote:hover {
  border-color: var(--primary-light);
}
.vote.on {
  border-color: var(--primary);
  background: #eaf4ef;
  color: var(--primary);
  font-weight: 700;
}
.vote.down.on {
  border-color: var(--wrong);
  background: #fdecee;
  color: var(--wrong);
}
.meta {
  font-size: 0.72rem;
  color: var(--text-light);
}
.contact {
  max-width: 680px;
  margin: 18px auto 0;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--text-light);
}
.empty {
  margin: 16px 0;
}
</style>
