<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Flag, ThumbsDown, ThumbsUp } from 'lucide-vue-next'
import { loadBank, speciesById, speciesName, type BankSpecies } from '@/core/bank'
import { listPublicReports, voteReport, type PublicReport } from '@/core/reportsApi'
import { getClientId } from '@/core/anonymousId'
import { currentLocale } from '@/i18n'

const route = useRoute()
const { t } = useI18n()
const loading = ref(true)
const failed = ref(false)
const total = ref(0)
const reports = ref<PublicReport[]>([])
const myVotes = ref<Record<string, number>>({})

const speciesFilter = computed(() => (route.query.species as string) || undefined)

onMounted(async () => {
  try {
    await loadBank().catch(() => null)
    const res = await listPublicReports({ species: speciesFilter.value, limit: 50 })
    reports.value = res.reports
    total.value = res.total
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
function thumbOf(r: PublicReport): string | undefined {
  const sp = speciesOf(r.species_id)
  const img = sp?.images?.[0] ?? sp?.image ?? null
  return img ? img.thumbUrl || img.url : undefined
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
    <RouterLink class="back" to="/">
      <ArrowLeft class="ic" :size="15" /> {{ t('reports.backHome') }}
    </RouterLink>
    <h2 class="head"><Flag class="ic" :size="22" /> {{ t('reports.title') }}</h2>
    <p class="muted lead">{{ t('reports.lead') }}</p>
    <p v-if="!loading && !failed" class="count">{{ t('reports.count', { n: total }) }}</p>

    <p v-if="loading" class="muted empty" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="failed" class="muted empty" role="alert">{{ t('reports.unavailable') }}</p>
    <p v-else-if="!reports.length" class="muted empty" role="status">{{ t('reports.empty') }}</p>

    <ul v-else class="list">
      <li v-for="r in reports" :key="r.id" class="item">
        <img v-if="thumbOf(r)" class="thumb" :src="thumbOf(r)" alt="" loading="lazy" />
        <div class="body">
          <div class="line1">
            <RouterLink v-if="r.species_id" class="name" :to="`/species/${r.species_id}`">
              {{ displayName(r) }}
            </RouterLink>
            <span v-else class="name">{{ displayName(r) }}</span>
            <span class="reason">{{ t(`report.reasons.${r.reason}`) }}</span>
            <span v-if="r.status === 'fixed'" class="status fixed">{{ t('reports.status.fixed') }}</span>
          </div>
          <p v-if="r.note" class="note">{{ r.note }}</p>
          <p v-if="r.suggested_answer" class="suggest">
            {{ t('reports.suggested', { name: r.suggested_answer }) }}
          </p>
          <p class="meta">{{ dateOf(r.created_at) }}</p>
        </div>
        <div class="votes">
          <button
            type="button"
            class="vote"
            :class="{ on: myVotes[r.id] === 1 }"
            :aria-pressed="myVotes[r.id] === 1"
            :aria-label="t('reports.upvoteCount', { n: r.up })"
            @click="vote(r, 1)"
          >
            <ThumbsUp :size="15" /> {{ r.up }}
          </button>
          <button
            type="button"
            class="vote down"
            :class="{ on: myVotes[r.id] === -1 }"
            :aria-pressed="myVotes[r.id] === -1"
            :aria-label="t('reports.downvoteCount', { n: r.down })"
            @click="vote(r, -1)"
          >
            <ThumbsDown :size="15" /> {{ r.down }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reports {
  text-align: center;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: var(--text-light);
  margin-bottom: 10px;
  align-self: flex-start;
}
.back:hover {
  color: var(--primary);
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
  border-radius: 10px;
  padding: 5px 12px;
  display: inline-block;
  margin-bottom: 14px;
}
.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 680px;
  margin: 0 auto;
  text-align: left;
}
.item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}
.thumb {
  width: 64px;
  height: 52px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
  background: #f0f4f2;
}
.body {
  flex: 1;
  min-width: 0;
}
.line1 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.name {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text);
}
.reason {
  font-size: 0.72rem;
  padding: 1px 8px;
  border-radius: 8px;
  background: #fdf3d8;
  color: #8a6d00;
}
.status.fixed {
  font-size: 0.72rem;
  padding: 1px 8px;
  border-radius: 8px;
  background: #eaf4ef;
  color: var(--primary);
}
.note {
  margin-top: 4px;
  font-size: 0.82rem;
  color: var(--text);
}
.suggest {
  margin-top: 2px;
  font-size: 0.78rem;
  color: var(--primary-dark);
}
.meta {
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--text-light);
}
.votes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.vote {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 2px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text);
  font-size: 0.78rem;
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
.empty {
  margin: 16px 0;
}
</style>
