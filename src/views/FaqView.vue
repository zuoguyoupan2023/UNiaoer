<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, HelpCircle, Library } from 'lucide-vue-next'
import {
  loadBank,
  speciesName,
  speciesNoteText,
  type BankSpecies,
  type Manifest,
} from '@/core/bank'
import { currentLocale } from '@/i18n'

const { t } = useI18n()
const bank = ref<Manifest | null>(null)
const failed = ref(false)

interface ChangelogEntry {
  date: string
  titleZh: string
  titleEn: string
  bodyZh: string
  bodyEn: string
  speciesId?: string
}
const changelog = ref<ChangelogEntry[]>([])

onMounted(async () => {
  try {
    bank.value = await loadBank()
  } catch {
    failed.value = true
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/faq-changelog.json`)
    if (res.ok) {
      const data = (await res.json()) as { entries?: ChangelogEntry[] }
      changelog.value = (data.entries ?? []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))
    }
  } catch {
    /* 更新日志可选：缺失时忽略 */
  }
})

/** 更新日志按 locale 取文本（缺英文回退中文） */
function pick(zh: string, en: string): string {
  return currentLocale() === 'en' ? en || zh : zh || en
}

/** 有答疑说明的物种（保持 manifest 顺序） */
const entries = computed<BankSpecies[]>(
  () => bank.value?.species.filter((sp) => sp.notes) ?? [],
)
const nameOf = (sp: BankSpecies) => speciesName(sp, currentLocale())
const titleOf = (sp: BankSpecies) => speciesNoteText(sp.notes, currentLocale())?.title ?? ''
</script>

<template>
  <section class="card faq">
    <h2 class="faq-head"><HelpCircle class="ic" :size="22" /> {{ t('faq.title') }}</h2>
    <p class="muted lead">{{ t('faq.lead') }}</p>

    <p v-if="entries.length" class="count">
      <Library class="ic" :size="14" /> {{ t('faq.count', { n: entries.length }) }}
    </p>

    <ul v-if="entries.length" class="faq-list">
      <li v-for="sp in entries" :key="sp.id">
        <RouterLink class="faq-item" :to="`/faq/${sp.id}`">
          <img
            v-if="sp.images?.length"
            class="faq-thumb"
            :src="sp.images[0]!.thumbUrl || sp.images[0]!.url"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span class="faq-text">
            <span class="faq-name">{{ nameOf(sp) }}</span>
            <span class="faq-title">{{ titleOf(sp) }}</span>
          </span>
          <ChevronRight class="faq-go ic" :size="18" />
        </RouterLink>
      </li>
    </ul>

    <p v-else-if="failed" class="muted empty">{{ t('errors.unknown') }}</p>
    <p v-else class="muted empty">{{ t('faq.empty') }}</p>

    <!-- 更新日志（人工维护 data/faq-changelog.json）：按日期倒序 -->
    <section v-if="changelog.length" class="changelog">
      <h3 class="cl-title">{{ t('faq.changelogTitle') }}</h3>
      <ol class="cl-list">
        <li v-for="c in changelog" :key="c.date + c.titleZh" class="cl-item">
          <span class="cl-date">{{ c.date }}</span>
          <div class="cl-body">
            <p class="cl-head">
              {{ pick(c.titleZh, c.titleEn) }}
              <RouterLink v-if="c.speciesId" class="cl-link" :to="`/species/${c.speciesId}`">
                {{ t('faq.changelogSpecies') }}
              </RouterLink>
            </p>
            <p class="cl-text">{{ pick(c.bodyZh, c.bodyEn) }}</p>
          </div>
        </li>
      </ol>
    </section>

    <p class="faq-foot">
      <RouterLink class="btn btn-secondary" to="/">{{ t('faq.home') }}</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.faq {
  text-align: center;
}
.faq-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.faq-head .ic {
  color: var(--primary);
}
.lead {
  font-size: 0.85rem;
  margin-bottom: 14px;
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
.faq-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 640px;
  margin: 0 auto 18px;
}
.faq-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  text-align: left;
  transition: all 0.18s ease;
}
.faq-item:hover {
  border-color: var(--primary-light);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
}
.faq-thumb {
  width: 64px;
  height: 52px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
  background: #f0f4f2;
}
.faq-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.faq-name {
  font-weight: 700;
  font-size: 0.95rem;
}
.faq-title {
  font-size: 0.8rem;
  color: var(--text-light);
}
.faq-go {
  color: var(--text-light);
  flex-shrink: 0;
}
.empty {
  margin: 14px 0 18px;
}
.changelog {
  max-width: 640px;
  margin: 8px auto 18px;
  text-align: left;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
.cl-title {
  font-size: 1rem;
  color: var(--primary-dark);
  margin-bottom: 10px;
}
.cl-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cl-item {
  display: flex;
  gap: 10px;
}
.cl-date {
  flex-shrink: 0;
  width: 84px;
  font-size: 0.74rem;
  color: var(--text-light);
  padding-top: 2px;
}
.cl-body {
  min-width: 0;
  border-left: 2px solid var(--border);
  padding-left: 12px;
}
.cl-head {
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--text);
}
.cl-link {
  margin-left: 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary);
}
.cl-text {
  margin-top: 3px;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text-light);
}
.faq-foot {
  margin-top: 6px;
}
</style>
