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

onMounted(async () => {
  try {
    bank.value = await loadBank()
  } catch {
    failed.value = true
  }
})

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
.faq-foot {
  margin-top: 6px;
}
</style>
