<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Award,
  BookOpen,
  CircleCheck,
  CircleX,
  Flame,
  HelpCircle,
  PartyPopper,
  Share2,
  Sparkles,
  Star,
  ThumbsUp,
  Trophy,
} from 'lucide-vue-next'
import { TIMEOUT, useQuizStore } from '@/stores/quiz'
import { useSettingsStore } from '@/stores/settings'
import { TIERS } from '@/core/difficulty'
import { persistRound } from '@/core/roundRecorder'
import { getClientId } from '@/core/anonymousId'
import { track } from '@/core/metrics'
import {
  buildShareDraft,
  createShare,
  fetchShare,
  markShareRevoked,
  rememberShare,
  revokeShare,
  shareOfRound,
  shareUrlOf,
  type ShareView,
} from '@/core/shareRound'
import { enqueueShare, queuedShareOfRound } from '@/core/shareQueue'
import { syncPendingShares } from '@/core/shareSync'
import type { RoundRecord } from '@/core/historyDb'
import { getActiveArchive, getStats, listRounds } from '@/core/historyDb'
import { evaluateTitles, TITLE_TRACKS, type TitleText } from '@/core/titles'
import { ALL_SPECIES_TOTAL, BADGES, type BadgeDef } from '@/core/badges'
import type { MediaAsset, Question } from '@/types'
import type { PosterData, PosterImage, PosterWrong } from '@/core/poster'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'
import {
  loadBank,
  speciesNameById,
  speciesNameByStoredName,
  speciesNoteById,
  speciesProfileById,
  loadSpeciesAssets,
  cachedSpeciesAssets,
} from '@/core/bank'
import AttributionLine from '@/components/AttributionLine.vue'
import BadgeIcon from '@/components/BadgeIcon.vue'
import SpeciesFacts from '@/components/SpeciesFacts.vue'
import PosterEditor from '@/components/PosterEditor.vue'
import SpeciesGallery from '@/components/SpeciesGallery.vue'

const router = useRouter()
const quiz = useQuizStore()
const { t } = useI18n()

const hasResult = computed(() => quiz.total > 0)
const modeLabel = computed(() => (quiz.mode === 'audio' ? t('nav.audioQuiz') : t('nav.imageQuiz')))
const tierLabel = computed(() => t(TIERS[quiz.tier].labelKey))
/** 科名「拉丁名+本地名」组合（015 #2） */
const familyOf = (fam: string) => familyDisplay(fam, currentLocale())
/** 题目答案名按当前语言解析（015 #1）：speciesId 回查题库，回退作答时存储名 */
const nameOf = (q: { media: { speciesId?: string }; answer: string }) =>
  speciesNameById(q.media.speciesId, currentLocale()) ?? q.answer
/** 错选名按当前语言解析：optionIds → 存储名反查（旧数据兜底）→ 原字符串 */
const choiceOf = (q: Question, chosen: string | null) => {
  if (chosen === TIMEOUT || chosen === null) {
    return chosen === TIMEOUT ? t('result.timedOut') : t('result.notAnswered')
  }
  const idx = q.options.indexOf(chosen)
  const id = idx >= 0 ? q.optionIds[idx] : undefined
  return (
    speciesNameById(id, currentLocale()) ??
    speciesNameByStoredName(chosen, currentLocale()) ??
    chosen
  )
}
const newBadges = ref<BadgeDef[]>([])
/** 新解锁称号的文本（key+params，渲染处 t()） */
const newTitleTexts = ref<TitleText[]>([])
const wornTitleText = ref<TitleText | null>(null)
const wornBadgeLabel = ref('')
const wornTitleIcon = ref('')
const wornBadgeIcon = ref('')
const settings = useSettingsStore()
const showPoster = ref(false)

// ── 035 成绩分享：创建 → 复制链接 → 撤回；二维码在创建成功后指向分享页 ──
/** 本轮落库记录（分享的数据源；persistRound 返回，未落库时 null） */
const roundRecord = ref<RoundRecord | null>(null)
/** 分享链接（创建成功后填充 → 海报二维码与复制按钮都用它） */
const shareUrl = ref('')
/** 已分享但被撤回 */
const shareRevoked = ref(false)
const shareBusy = ref(false)
/** 默认带上昵称（D-035-4）；勾选 = 隐藏 */
const hideNickname = ref(false)
const shareMsg = ref('')
const shareMsgKind = ref<'ok' | 'err'>('ok')
let shareMsgTimer: number | undefined

function flashShareMsg(text: string, kind: 'ok' | 'err' = 'ok') {
  shareMsg.value = text
  shareMsgKind.value = kind
  if (shareMsgTimer) clearTimeout(shareMsgTimer)
  shareMsgTimer = window.setTimeout(() => (shareMsg.value = ''), 4000)
}

/** 该轮历史里已分享的记录（用于进页面就显示"已分享 / 已撤回"） */
const existingShare = ref<{ shareId: string; token: string; revoked?: boolean } | null>(null)

/**
 * 创建本轮分享（不含 UI 状态收尾）。成功返回分享 URL；失败返回 null
 * （失败时的落盘/文案由调用方决定——手动创建会入队补传并提示）。
 */
async function createRoundShare(): Promise<string | null> {
  if (!roundRecord.value) return null
  const draft = buildShareDraft(roundRecord.value, {
    clientId: getClientId(),
    // 勾选「隐藏昵称」时提交 null（服务端不再写昵称快照）
    nickname: hideNickname.value ? null : archiveNickname.value || settings.nickname || null,
    locale: currentLocale(),
  })
  if ('error' in draft) return null
  try {
    const { id, token } = await createShare(draft)
    rememberShare({ roundId: roundRecord.value.id, shareId: id, token, at: Date.now() })
    existingShare.value = { shareId: id, token }
    shareRevoked.value = false
    shareUrl.value = shareUrlOf(id)
    return shareUrl.value
  } catch {
    // 035 离线补传（2026-10-09）：失败时把草稿落盘，之后可在设置页/本页一键补传
    enqueueShare(draft, roundRecord.value.id)
    queuedShare.value = true
    return null
  }
}

async function doShare() {
  if (shareBusy.value || !roundRecord.value) return
  shareBusy.value = true
  shareMsg.value = ''
  try {
    const url = await createRoundShare()
    flashShareMsg(url ? t('share.created') : t('share.queued'), url ? 'ok' : 'err')
  } finally {
    shareBusy.value = false
  }
}

/**
 * 海报弹层「包含测试内容」时调用（2026-10-09）：确保本轮存在分享链接并回传。
 * 已分享 → 直接复用（不重复创建）；未分享 → 就地创建（弹层的提醒已构成明确同意）；
 * 失败/该轮未落库 → null，海报二维码退回官网（绝不产生指向无效页面的码）。
 */
async function ensureShare(): Promise<string | null> {
  if (shareUrl.value) return shareUrl.value
  if (!roundRecord.value || shareBusy.value) return null
  shareBusy.value = true
  try {
    return await createRoundShare()
  } finally {
    shareBusy.value = false
  }
}

/** 本轮是否有待补传草稿（用于显示「重试上传」） */
const queuedShare = ref(false)

/** 补传（弱网恢复后手点；成功即恢复「已分享」状态） */
async function retryShare() {
  if (shareBusy.value || !roundRecord.value) return
  shareBusy.value = true
  try {
    const r = await syncPendingShares()
    if (r.ids.length) {
      const prior = shareOfRound(roundRecord.value.id)
      if (prior) {
        existingShare.value = { shareId: prior.shareId, token: prior.token }
        shareUrl.value = shareUrlOf(prior.shareId)
      }
      queuedShare.value = false
      flashShareMsg(t('share.retryDone', { n: r.synced }))
    } else if (r.failed) {
      flashShareMsg(t('share.retryFailed'), 'err')
    }
  } finally {
    shareBusy.value = false
  }
}

async function copyShareLink() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    flashShareMsg(t('share.copied'))
  } catch {
    flashShareMsg(t('share.copyFailed'), 'err')
  }
}

async function doRevoke() {
  const entry = existingShare.value
  if (!entry || shareBusy.value) return
  if (!window.confirm(t('share.revokeConfirm'))) return
  shareBusy.value = true
  try {
    await revokeShare(entry.shareId, entry.token)
    markShareRevoked(entry.shareId)
    shareRevoked.value = true
    shareUrl.value = ''
    flashShareMsg(t('share.revoked'))
  } catch {
    flashShareMsg(t('share.revokeFailed'), 'err')
  } finally {
    shareBusy.value = false
  }
}

/** 校验一条已存在的分享仍可访问（撤回后链接失效 → 更新界面状态） */
async function refreshExistingShare(shareId: string, token: string, revokedFlag?: boolean) {
  if (revokedFlag) {
    shareRevoked.value = true
    return
  }
  const view: ShareView | null = await fetchShare(shareId).catch(() => null)
  if (view) {
    shareUrl.value = shareUrlOf(shareId)
    existingShare.value = { shareId, token }
  } else {
    // 链接已失效（撤回/被清理）
    shareRevoked.value = true
    markShareRevoked(shareId)
  }
}
/** 活动档案的昵称快照（旧档海报署名不随身份改昵称而变，013 §3.3） */
const archiveNickname = ref('')
/** 答疑专栏入口（011 §9）：bank 就绪后按物种查说明 */
const bankReady = ref(false)
function faqIdOf(q: Question): string | null {
  if (!bankReady.value) return null
  const id = q.media.speciesId
  return id && speciesNoteById(id) ? id : null
}
/** 该题物种档案（C1；bank 就绪后可用） */
function profileOf(q: Question) {
  return bankReady.value ? speciesProfileById(q.media.speciesId) : undefined
}

const message = computed<{ icon: Component; text: string }>(() => {
  const p = quiz.accuracy
  if (p === 100) return { icon: Trophy, text: t('result.msg100') }
  if (p >= 80) return { icon: Star, text: t('result.msg80') }
  if (p >= 60) return { icon: ThumbsUp, text: t('result.msg60') }
  if (p >= 40) return { icon: Flame, text: t('result.msg40') }
  return { icon: BookOpen, text: t('result.msg0') }
})

/** 称号文本 → 字符串（海报画布/徽章 chips 用） */
const textOf = (x: TitleText) => t(x.key, x.params ?? {})

const posterData = computed<PosterData>(() => {
  const wrong: PosterWrong[] = quiz.questions
    .map((q, i) => ({ q, chosen: quiz.chosen[i] ?? null }))
    .filter(({ q, chosen }) => chosen !== q.answer)
    .map(({ q, chosen }) => ({
      answer: nameOf(q),
      chosen: chosen === TIMEOUT || chosen === null ? null : choiceOf(q, chosen),
      timedOut: chosen === TIMEOUT,
    }))
  return {
    modeLabel: quiz.mode === 'audio' ? t('mode.audioRound') : t('mode.imageRound'),
    tierLabel: tierLabel.value,
    correct: quiz.correctCount,
    total: quiz.total,
    accuracy: quiz.accuracy,
    date: new Intl.DateTimeFormat(currentLocale()).format(new Date()),
    round: quiz.sessionRound,
    overallAccuracy: quiz.overallAccuracy,
    wornTitle: wornTitleText.value ? textOf(wornTitleText.value) : undefined,
    wornTitleIcon: wornTitleIcon.value || undefined,
    wornBadge: wornBadgeLabel.value || undefined,
    wornBadgeIcon: wornBadgeIcon.value || undefined,
    nickname: archiveNickname.value || settings.nickname || undefined,
    wrong,
  }
})

const posterImages = computed<PosterImage[]>(() => {
  const seen = new Set<string>()
  const out: PosterImage[] = []
  quiz.questions.forEach((q, i) => {
    if (q.type !== 'image' || !q.media.url || seen.has(q.media.url)) return
    seen.add(q.media.url)
    // F6：答错题所用的图打标记，引导用户优先选它做背景；xl 供海报背景用原图（C2）
    out.push({
      url: q.media.url,
      thumbUrl: q.media.thumbUrl,
      xlUrl: q.media.xlUrl,
      answer: nameOf(q),
      sci: q.sci,
      wrong: quiz.chosen[i] !== q.answer,
    })
  })
  return out
})

/** 029 M1:分片就绪标记(触发画廊重渲染);值本身是时间戳,仅作依赖 */
const mediaReady = ref(0)
/** 每题画廊素材:题目自带(core 首图首音) + 分片补齐的完整素材,按 url 去重 */
function galleryPoolOf(q: Question): { images: MediaAsset[]; audios: MediaAsset[] } {
  void mediaReady.value // 建立响应依赖:分片到位后重算
  const hit = cachedSpeciesAssets(q.media.speciesId)
  const img = q.type === 'image' ? q.assets : q.crossAssets
  const aud = q.type === 'audio' ? q.assets : q.crossAssets
  const merge = (base: MediaAsset[] | undefined, extra: MediaAsset[] | undefined) => {
    const b = base ?? []
    if (!extra?.length) return b
    const seen = new Set(b.map((m) => m.url))
    return [...b, ...extra.filter((m) => !seen.has(m.url))]
  }
  return { images: merge(img, hit?.images), audios: merge(aud, hit?.audios) }
}

onMounted(async () => {
  if (!hasResult.value) {
    router.replace('/')
    return
  }
  void loadBank()
    .then(() => (bankReady.value = true))
    .catch(() => {})
  // 029 M1:core 只带首图首音;回顾画廊的完整素材按需加载(按桶合并,一轮题通常落在少数几个桶)
  void Promise.all(
    quiz.questions.map((q) => loadSpeciesAssets(q.media.speciesId).catch(() => null)),
  ).then(() => (mediaReady.value = Date.now()))
  try {
    archiveNickname.value = (await getActiveArchive()).nickname || ''
  } catch {
    /* IndexedDB 不可用：海报回退 settings.nickname */
  }
  const res = await persistRound(quiz)
  newBadges.value = res.badges
  newTitleTexts.value = res.newTitles.map((x) => x.text)
  roundRecord.value = res.record
  // 028 计量：一轮完成（仅在本轮真正落库时计一次——刷新结果页不会重复计数）
  if (res.record) track('quiz_complete', { mode: quiz.mode, tier: quiz.tier })
  // 035：该轮若已分享过，恢复"已分享/已撤回"状态与海报二维码
  if (res.record) {
    const prior = shareOfRound(res.record.id)
    if (prior) void refreshExistingShare(prior.shareId, prior.token, prior.revoked)
    // 035 离线补传：本轮若在队列里（上次创建失败），显示「重试上传」
    queuedShare.value = !!queuedShareOfRound(res.record.id)
  }
  // 佩戴称号/徽章 → 海报（R30/R31/R38：含独特图标）
  const [stats, rounds] = await Promise.all([getStats(), listRounds()])
  const wornTitle = evaluateTitles(stats, rounds).find((x) => x.trackId === settings.wornTitle)
  wornTitleText.value = wornTitle?.text ?? null
  wornTitleIcon.value = wornTitle ? (TITLE_TRACKS.find((x) => x.id === wornTitle.trackId)?.icon ?? '') : ''
  const wornBadgeDef = settings.wornBadge ? BADGES.find((b) => b.id === settings.wornBadge) : undefined
  wornBadgeLabel.value = wornBadgeDef ? t(wornBadgeDef.labelKey) : ''
  wornBadgeIcon.value = wornBadgeDef?.icon ?? ''
})

async function again() {
  await quiz.nextRound()
  router.push(quiz.mode === 'audio' ? '/quiz/audio' : '/quiz/image')
}
</script>

<template>
  <section v-if="hasResult" class="card result">
    <h2><PartyPopper class="ic" :size="22" /> {{ t('result.doneTitle') }}</h2>
    <p class="muted">{{ modeLabel }} · {{ tierLabel }}</p>
    <div class="score">
      <span class="num">{{ quiz.correctCount }}</span>
      <span class="den">/ {{ quiz.total }}</span>
    </div>
    <p class="muted">{{ t('result.accuracyLabel', { acc: quiz.accuracy }) }}</p>
    <p class="msg"><component :is="message.icon" class="ic" :size="18" /> {{ message.text }}</p>

    <div v-if="newTitleTexts.length" class="badges-new">
      <span class="muted"><Sparkles class="ic" :size="15" /> {{ t('result.newTitles') }}</span>
      <span v-for="(x, i) in newTitleTexts" :key="i" class="badge-chip">{{ textOf(x) }}</span>
    </div>

    <div v-if="newBadges.length" class="badges-new">
      <span class="muted"><Award class="ic" :size="15" /> {{ t('result.newBadges') }}</span>
      <span v-for="b in newBadges" :key="b.id" class="badge-chip">
        <BadgeIcon :name="b.icon" :size="15" /> {{ t(b.labelKey, { n: ALL_SPECIES_TOTAL }) }}
      </span>
    </div>

    <div class="actions">
      <button class="btn btn-primary" @click="again">{{ t('result.again') }}</button>
      <button class="btn btn-secondary" @click="showPoster = true">{{ t('result.makePoster') }}</button>
      <RouterLink class="btn btn-secondary" to="/">{{ t('quiz.backHome') }}</RouterLink>
    </div>

    <!-- 035 成绩分享：默认带昵称（可勾选隐藏）；创建后链接同时供海报二维码使用 -->
    <div v-if="roundRecord" class="share-block">
      <div class="share-head">
        <Share2 class="ic" :size="15" />
        <span>{{ t('share.title') }}</span>
      </div>
      <p class="muted small share-lead">{{ t('share.lead') }}</p>

      <template v-if="!shareUrl && !shareRevoked">
        <label class="share-opt">
          <input v-model="hideNickname" type="checkbox" />
          {{ t('share.hideNickname') }}
        </label>
        <button class="btn btn-secondary" :disabled="shareBusy" @click="doShare">
          {{ shareBusy ? t('share.creating') : t('share.create') }}
        </button>
        <!-- 035 离线补传：上次创建失败已入队 → 提供一键重试 -->
        <button v-if="queuedShare" class="btn btn-secondary" :disabled="shareBusy" @click="retryShare">
          {{ t('share.retryUpload') }}
        </button>
      </template>

      <template v-else-if="shareUrl">
        <div class="share-link">
          <input :value="shareUrl" readonly :aria-label="t('share.linkLabel')" @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn btn-secondary" type="button" @click="copyShareLink">
            {{ t('share.copy') }}
          </button>
        </div>
        <p class="muted small">{{ t('share.qrHint') }}</p>
        <button class="btn-link" type="button" :disabled="shareBusy" @click="doRevoke">
          {{ t('share.revoke') }}
        </button>
      </template>

      <template v-else>
        <p class="muted small">{{ t('share.revokedHint') }}</p>
        <button class="btn btn-secondary" :disabled="shareBusy" @click="doShare">
          {{ t('share.create') }}
        </button>
      </template>

      <p v-if="shareMsg" class="share-msg" :class="shareMsgKind" role="status">{{ shareMsg }}</p>
    </div>
  </section>

  <PosterEditor
    :open="showPoster"
    :data="posterData"
    :images="posterImages"
    :qr-url="shareUrl || undefined"
    :ensure-share="ensureShare"
    @close="showPoster = false"
  />

  <section v-if="hasResult" class="card review">
    <h3>{{ t('result.review') }}</h3>
    <ol>
      <li v-for="(q, i) in quiz.questions" :key="q.id" :class="{ ok: quiz.chosen[i] === q.answer }">
        <div class="line">
          <CircleCheck v-if="quiz.chosen[i] === q.answer" class="mark ok" :size="16" />
          <CircleX v-else class="mark no" :size="16" />
          <span class="ans">{{ nameOf(q) }}</span>
          <span class="muted">{{ q.sci }} · {{ familyOf(q.family) }}</span>
        </div>
        <div class="muted small">
          {{ t('result.yourChoice', { choice: choiceOf(q, quiz.chosen[i] ?? null) }) }}
        </div>
        <AttributionLine :media="q.media" />
        <!-- C3：回顾该鸟的其它图/音（可放大、可试听）；029 M1:core 只带首图首音,其余按需从 assets 分片补齐 -->
        <SpeciesGallery
          :images="galleryPoolOf(q).images"
          :audios="galleryPoolOf(q).audios"
          mode="browse"
          :label="t('result.viewSpeciesMedia')"
        />
        <!-- 答疑专栏入口（011 §9） -->
        <RouterLink v-if="faqIdOf(q)" class="faq-link" :to="`/faq/${faqIdOf(q)}`">
          <HelpCircle class="ic" :size="14" />
          {{ q.type === 'audio' ? t('faq.whyAudio') : t('faq.whyImage') }}
        </RouterLink>
        <!-- 物种档案（C1）：类群 / 居留型 / 分布 -->
        <SpeciesFacts
          v-if="profileOf(q)"
          class="species-facts"
          :profile="profileOf(q)"
          :species-id="q.media.speciesId"
          compact
        />
      </li>
    </ol>
  </section>
</template>

<style scoped>
.result {
  text-align: center;
}
.result h2 {
  font-size: 1.3rem;
}
.score {
  margin: 16px auto;
  width: 128px;
  height: 128px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 6px solid transparent;
  background:
    linear-gradient(#fff, #fff) padding-box,
    var(--grad) border-box;
  box-shadow: 0 18px 40px -20px rgba(45, 106, 79, 0.9);
}
.score .num {
  font-size: 2.2rem;
  font-weight: 800;
  color: var(--primary);
}
.score .den {
  font-size: 0.8rem;
  color: var(--text-light);
}
.msg {
  font-size: 1rem;
  font-weight: 700;
  margin: 14px 0 12px;
}
.badges-new {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  align-items: center;
  margin-bottom: 18px;
}
.badge-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--grad-gold);
  color: #4a3200;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: var(--radius);
}
.mark.ok {
  color: var(--correct);
}
.mark.no {
  color: var(--wrong);
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.actions .btn {
  flex: 0 0 auto;
}
/* 035 分享块：与 actions 分隔，弱化视觉（次级操作） */
.share-block {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.share-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--primary-dark, var(--primary));
}
.share-head .ic {
  color: var(--primary);
}
.share-lead {
  max-width: 460px;
  text-align: center;
  line-height: 1.6;
}
.share-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-light);
  cursor: pointer;
}
.share-link {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 460px;
}
.share-link input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.78rem;
  background: #fbfdfc;
}
.btn-link {
  border: none;
  background: none;
  color: var(--text-light);
  font-size: 0.76rem;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  padding: 2px 4px;
}
.btn-link:hover {
  color: var(--wrong);
}
.share-msg {
  font-size: 0.78rem;
  color: var(--primary);
}
.share-msg.err {
  color: var(--wrong);
}
.review h3 {
  margin-bottom: 12px;
}
.review ol {
  list-style: none;
}
.review li {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.review li:last-child {
  border-bottom: none;
}
.line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ans {
  font-weight: 700;
}
.small {
  font-size: 0.78rem;
}
/* 答疑专栏入口（011 §9） */
.faq-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f0f4f2;
  color: var(--text-light);
  font-size: 0.76rem;
  font-weight: 600;
  transition: all 0.18s ease;
}
.faq-link:hover {
  color: var(--primary);
  border-color: var(--primary-light);
  background: #eaf4ef;
  text-decoration: none;
}
.species-facts {
  margin-top: 8px;
}
</style>
