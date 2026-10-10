<script setup lang="ts">
/**
 * 035 单轮成绩分享页（/s/:id）——公开只读，无需登录、无需本地数据。
 *
 * 数据来自 `GET /api/shares/:id`（载荷是题目快照 + 媒体链接 + 署名）。
 * 名字解析：优先按 speciesId 回查题库（跨语言一致，015 机制），失败回退载荷里的快照名。
 * 媒体：图用 thumbUrl 优先（小图快）；音频必须 `crossorigin` **先于 src**（iPhone 播放前提，见 docs/033）。
 * 隐私：撤回/不存在的链接 → 404 友好提示；页面 noindex（不鼓励搜索引擎收录个人成绩）。
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { CircleCheck, CircleX, Eye, Home, Leaf, Share2, Timer } from 'lucide-vue-next'
import {
  countShareView,
  fetchShare,
  markShareViewed,
  type ShareItem,
  type ShareView,
} from '@/core/shareRound'
import { loadBank, speciesNameById } from '@/core/bank'
import { currentLocale } from '@/i18n'
import { familyDisplay } from '@/i18n/data/family'

const route = useRoute()
const { t } = useI18n()

const share = ref<ShareView | null>(null)
const notFound = ref(false)
const loading = ref(true)

onMounted(async () => {
  const id = String(route.params.id ?? '')
  // 题库并行加载（用于跨语言名字解析；失败不阻塞——回退载荷里的快照名）
  const bankReady = loadBank().catch(() => null)
  try {
    share.value = await fetchShare(id)
    if (!share.value) notFound.value = true
    else {
      await bankReady
      // 浏览计数（2026-10-09）：同会话同一分享只计一次（避免刷新灌水）；失败静默
      if (markShareViewed(id)) void countShareView(id)
    }
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
})

/** 答案名：id 回查（当前语言）→ 快照名 */
const answerName = (it: ShareItem) =>
  speciesNameById(it.speciesId ?? undefined, currentLocale()) ?? it.answer
/** 错选名：超时/未答 → 占位；否则 id 回查 → 快照名 */
function chosenName(it: ShareItem): string {
  if (it.timedOut) return t('result.timedOut')
  if (!it.chosen) return t('result.notAnswered')
  return speciesNameById(it.chosenId ?? undefined, currentLocale()) ?? it.chosen
}
const familyOf = (fam?: string | null) => (fam ? familyDisplay(fam, currentLocale()) : '')

const dateText = computed(() => {
  if (!share.value) return ''
  try {
    return new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(share.value.at))
  } catch {
    return new Date(share.value.at).toLocaleString()
  }
})
const tierLabel = computed(() =>
  share.value ? t(`difficulty.l${share.value.tier}.label`) : '',
)
const modeLabel = computed(() =>
  share.value ? (share.value.mode === 'audio' ? t('nav.audioQuiz') : t('nav.imageQuiz')) : '',
)
</script>

<template>
  <section class="card share">
    <p v-if="loading" class="muted center">{{ t('share.loading') }}</p>

    <template v-else-if="notFound">
      <h2 class="nf-title">{{ t('share.notFoundTitle') }}</h2>
      <p class="muted">{{ t('share.notFoundBody') }}</p>
      <RouterLink class="btn btn-primary" to="/">{{ t('share.goHome') }}</RouterLink>
    </template>

    <template v-else-if="share">
      <header class="head">
        <div class="brand">UNiaoer</div>
        <p class="who">
          <Share2 class="ic" :size="15" />
          <span v-if="share.nickname">@{{ share.nickname }} · </span>{{ dateText }}
        </p>
        <p class="meta">
          {{ modeLabel }} · {{ tierLabel }}
          <span v-if="(share.views ?? 0) > 0" class="views" :title="t('share.viewsTitle')">
            · <Eye class="ic" :size="13" /> {{ t('share.views', { n: share.views ?? 0 }) }}
          </span>
        </p>
        <p class="score">
          <b>{{ share.correct }}</b><span>/{{ share.total }}</span>
          <em>{{ t('share.accuracy', { acc: share.accuracy }) }}</em>
        </p>
      </header>

      <ol class="items">
        <li v-for="(it, i) in share.payload.items" :key="i" :class="{ ok: it.correct }">
          <div class="line">
            <CircleCheck v-if="it.correct" class="mark ok" :size="16" />
            <CircleX v-else class="mark no" :size="16" />
            <span class="idx">{{ i + 1 }}.</span>
            <span class="ans">{{ answerName(it) }}</span>
            <span class="muted small">{{ it.sci }}<template v-if="it.family"> · {{ familyOf(it.family) }}</template></span>
          </div>
          <div v-if="!it.correct" class="muted small pick">
            <Timer v-if="it.timedOut" class="ic" :size="13" />
            {{ it.timedOut ? t('result.timedOut') : t('share.picked', { name: chosenName(it) }) }}
          </div>

          <!-- 素材：图用小图；音频必须以 crossorigin 先于 src 设置（iPhone 播放前提，docs/033） -->
          <div class="media">
            <img
              v-if="it.type === 'image' && it.mediaUrl"
              :src="it.thumbUrl || it.mediaUrl"
              :alt="answerName(it)"
              loading="lazy"
              decoding="async"
            />
            <audio v-else-if="it.type === 'audio' && it.mediaUrl" crossorigin="anonymous" :src="it.mediaUrl" controls preload="none"></audio>
          </div>

          <!-- 署名（AGENTS 铁律 5）：逐条不可省 -->
          <p class="credits muted small">
            <Leaf class="ic" :size="12" />
            <span>{{ it.source }}</span> · {{ it.author }} · <span>{{ it.license }}</span>
          </p>
        </li>
      </ol>

      <footer class="foot">
        <p class="muted small">{{ t('share.footnote') }}</p>
        <RouterLink class="btn btn-primary" to="/">
          <Home class="ic" :size="15" /> {{ t('share.cta') }}
        </RouterLink>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.share {
  max-width: 720px;
  margin: 0 auto;
}
.center {
  text-align: center;
  margin: 24px 0;
}
.nf-title {
  text-align: center;
  margin: 12px 0 6px;
}
.share > .btn {
  display: block;
  margin: 16px auto 6px;
  width: fit-content;
}
.head {
  text-align: center;
  border-bottom: 1px dashed var(--border);
  padding-bottom: 14px;
  margin-bottom: 14px;
}
.brand {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.5px;
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.82rem;
  color: var(--text-light);
  margin-top: 4px;
}
.meta {
  font-size: 0.78rem;
  color: var(--text-light);
}
.meta .views {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.meta .views .ic {
  vertical-align: -2px;
}
.score {
  margin-top: 8px;
  font-size: 1rem;
  color: var(--text);
}
.score b {
  font-size: 2rem;
  color: var(--primary);
}
.score span {
  font-size: 1rem;
  color: var(--text-light);
}
.score em {
  font-style: normal;
  margin-left: 10px;
  font-size: 0.82rem;
  color: var(--text-light);
}
.items {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.items > li {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fbfdfc;
}
.line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.mark.ok {
  color: var(--primary);
}
.mark.no {
  color: var(--wrong);
}
.idx {
  font-weight: 700;
  color: var(--text-light);
  font-size: 0.82rem;
}
.ans {
  font-weight: 600;
}
.pick {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
}
.media {
  margin-top: 8px;
}
.media img {
  max-width: 100%;
  max-height: 220px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.media audio {
  width: 100%;
  max-width: 420px;
}
.credits {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.credits .ic {
  color: var(--primary);
}
.foot {
  margin-top: 20px;
  text-align: center;
}
</style>
